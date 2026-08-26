import type { ActionPayload, ComponentDef, Envelope } from '../types';
import { CATALOG_COMPONENTS } from '../types';

const CATALOG = new Set<string>(CATALOG_COMPONENTS);

export interface SurfaceState {
  id: string;
  theme: { primaryColor?: string; agentDisplayName?: string; iconUrl?: string };
  components: Map<string, ComponentDef>;
  dataModel: any;
}

export interface Ctx {
  surface: SurfaceState;
  scope: string;
}

const unescape = (t: string) => t.replace(/~1/g, '/').replace(/~0/g, '~');

function ptrGet(obj: any, pointer?: string): any {
  if (!pointer || pointer === '/') return obj;
  let cur = obj;
  for (const tok of pointer.split('/').slice(1)) {
    if (cur == null) return undefined;
    cur = cur[unescape(tok)];
  }
  return cur;
}

function resolvePath(path: string | undefined, scope: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `${scope}/${path}`;
}

function toStr(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

type Fn = (args: Record<string, any>) => any;

const FUNCTIONS: Record<string, Fn> = {
  formatCurrency: (a) => {
    const n = Number(a.value);
    if (!Number.isFinite(n)) return '';
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: a.currency || 'INR', maximumFractionDigits: 0 }).format(n);
    } catch { return `\u20b9${n}`; }
  },
  formatNumber: (a) => (Number.isFinite(Number(a.value)) ? new Intl.NumberFormat('en-IN').format(Number(a.value)) : ''),
  formatString: (a) => a.value, // resolved separately via interpolate()
  formatDuration: (a) => {
    const mins = Number(a.value);
    if (!Number.isFinite(mins) || mins < 0) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  },
  pluralize: (a) => (Number(a.count) === 1 ? a.one ?? '' : a.other ?? ''),
  required: (a) => !(a.value === null || a.value === undefined || a.value === ''),
  and: (a) => (a.values || []).every(Boolean),
  or: (a) => (a.values || []).some(Boolean),
  not: (a) => !a.value,
};

export class A2UIStore {
  surfaces = new Map<string, SurfaceState>();
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.version;

  private touch() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  apply(e: Envelope) {
    if ('createSurface' in e) {
      const b = e.createSurface;
      this.surfaces.set(b.surfaceId, {
        id: b.surfaceId,
        theme: b.theme || {},
        components: new Map(),
        dataModel: {},
      });
      this.touch();
      return;
    }
    if ('deleteSurface' in e) {
      this.surfaces.delete(e.deleteSurface.surfaceId);
      this.touch();
      return;
    }
    if ('updateComponents' in e) {
      const s = this.surfaces.get(e.updateComponents.surfaceId);
      if (!s) return;
      for (const c of e.updateComponents.components) {
        if (!CATALOG.has(c.component)) continue; // renderer-side catalog enforcement too
        s.components.set(c.id, c);
      }
      this.touch();
      return;
    }
    if ('updateDataModel' in e) {
      const s = this.surfaces.get(e.updateDataModel.surfaceId);
      if (!s) return;
      const path = e.updateDataModel.path || '/';
      if (path === '/') {
        s.dataModel = e.updateDataModel.value ?? {};
      } else {
        setPath(s.dataModel, path, e.updateDataModel.value);
      }
      this.touch();
    }
  }

  resolve(spec: any, ctx: Ctx): any {
    if (spec === null || spec === undefined) return undefined;
    if (Array.isArray(spec)) return spec.map((s) => this.resolve(s, ctx));
    if (typeof spec !== 'object') return spec;

    if (typeof spec.path === 'string' && !('call' in spec)) {
      return ptrGet(ctx.surface.dataModel, resolvePath(spec.path, ctx.scope));
    }
    if (typeof spec.call === 'string') {
      if (spec.call === 'formatString') {
        return this.interpolate(String(spec.args?.value ?? ''), ctx);
      }
      const impl = FUNCTIONS[spec.call];
      if (!impl) return undefined;
      const args: Record<string, any> = {};
      for (const [k, v] of Object.entries(spec.args || {})) args[k] = this.resolve(v, ctx);
      return impl(args);
    }
    return spec;
  }

  text(spec: any, ctx: Ctx): string {
    return toStr(this.resolve(spec, ctx));
  }

  interpolate(str: string, ctx: Ctx): string {
    return str.replace(/\$\{([^}]+)\}/g, (_, expr) => {
      const path = String(expr).trim();
      return toStr(ptrGet(ctx.surface.dataModel, resolvePath(path, ctx.scope)));
    });
  }

  /** Client-only form state (date pickers, guest counts, etc.) — writes
   * straight into a surface's data model without a server round-trip, so a
   * Button's action context can read the latest value via a `path` at
   * click-time. Never sent to the server on its own. */
  setLocal(surfaceId: string, absPath: string, value: any) {
    const s = this.surfaces.get(surfaceId);
    if (!s) return;
    setPath(s.dataModel, absPath, value);
    this.touch();
  }

  dispatch(comp: ComponentDef, ctx: Ctx, surfaceId: string, onAction: (a: ActionPayload) => void) {
    const action = (comp as any).action;
    if (!action?.event) return;
    const context: Record<string, any> = {};
    for (const [k, v] of Object.entries(action.event.context || {})) context[k] = this.resolve(v, ctx);
    onAction({
      name: action.event.name,
      surfaceId,
      sourceComponentId: comp.id,
      timestamp: new Date().toISOString(),
      context,
    });
  }
}

function setPath(obj: any, pointer: string, value: any) {
  const toks = pointer.split('/').slice(1).map(unescape);
  let cur = obj;
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i];
    if (cur[t] == null || typeof cur[t] !== 'object') cur[t] = /^\d+$/.test(toks[i + 1]) ? [] : {};
    cur = cur[t];
  }
  const last = toks[toks.length - 1];
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

export { ptrGet, resolvePath, toStr };

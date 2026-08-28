/**
 * A2uiRuntime — a thin wrapper around `@a2ui/web_core`'s `MessageProcessor`
 * that the rest of the app talks to instead of the old hand-rolled
 * `A2UIStore`. One instance per chat turn.
 *
 * Responsibilities:
 *  - feed SSE envelopes into the processor, tolerating a bad envelope
 *  - re-check the component allowlist on the way in (the server validates
 *    every envelope too — orchestrator/trust.ts — this is defence in depth)
 *  - swallow a stray repeat `createSurface` for an existing surface (the
 *    processor throws on that; the server shouldn't send one, but replay
 *    and hostile streams both could)
 *  - keep a message log so a conversation can be replayed from localStorage
 *    (see `planner/persistence.ts`)
 *  - expose a `useSyncExternalStore`-friendly `subscribe` / `getSnapshot`
 *  - provide small read helpers for `App.tsx`'s business logic
 */
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { A2uiClientAction } from '@a2ui/web_core/v0_9';
import { catalog } from './catalog';

export type A2uiMessage = Record<string, any>;
export type ActionHandler = (action: A2uiClientAction) => void;

/** The rendered vocabulary — the single source of truth for the client-side
 * allowlist re-check, taken straight off the catalog so it can never drift. */
const ALLOWED_COMPONENTS = new Set(catalog.components.keys());

export class A2uiRuntime {
  readonly messages: A2uiMessage[] = [];
  private processor: MessageProcessor<any>;
  private listeners = new Set<() => void>();
  private version = 0;
  private handler?: ActionHandler;

  constructor(onAction?: ActionHandler) {
    this.handler = onAction;
    this.processor = new MessageProcessor([catalog as any], (a: A2uiClientAction) => this.handler?.(a));
    this.processor.onSurfaceCreated((surface) => {
      const bump = () => this.touch();
      surface.componentsModel.onCreated.subscribe(bump);
      surface.componentsModel.onDeleted.subscribe(bump);
      surface.dataModel.subscribe('/', bump);
      this.touch();
    });
    this.processor.onSurfaceDeleted(() => this.touch());
  }

  /** Feed one or more raw A2UI envelopes. */
  processMessages(messages: A2uiMessage[]) {
    for (const raw of messages) {
      const msg = sanitizeEnvelope(raw);
      if (!msg) continue;
      this.messages.push(msg);
      if ('createSurface' in msg && this.processor.model.getSurface(msg.createSurface.surfaceId)) {
        continue;
      }
      try {
        this.processor.processMessages([msg as any]);
      } catch (err) {
      }
    }
    this.touch();
  }

  /** The action handler lives in `App.tsx`'s per-turn component, which mounts
   * after this runtime is created — it wires itself up here via effect. */
  setActionHandler(fn: ActionHandler | undefined) {
    this.handler = fn;
  }

  getSurface(id: string): SurfaceModel<any> | undefined {
    return this.processor.model.getSurface(id);
  }

  get surfaces(): ReadonlyMap<string, SurfaceModel<any>> {
    return this.processor.model.surfacesMap;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.version;

  private touch() {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

/** Drops any component whose kind isn't in the catalog before it reaches the
 * processor — mirrors the old hand-rolled renderer's `CATALOG.has(...)` gate.
 * Returns null for a non-object; otherwise the same envelope, with an
 * `updateComponents` list trimmed to allowed kinds (a copy only when it
 * actually changed). */
function sanitizeEnvelope(msg: A2uiMessage): A2uiMessage | null {
  if (!msg || typeof msg !== 'object') return null;
  const uc = msg.updateComponents;
  if (uc && Array.isArray(uc.components)) {
    const kept = uc.components.filter((c: any) => {
      if (ALLOWED_COMPONENTS.has(c?.component)) return true;
      return false;
    });
    if (kept.length !== uc.components.length) {
      return { ...msg, updateComponents: { ...uc, components: kept } };
    }
  }
  return msg;
}

/* --------------------------- read helpers --------------------------- */

/** Value at a JSON pointer in a surface's data model (`undefined` if absent). */
export function surfaceData(surface: SurfaceModel<any> | undefined, pointer: string): any {
  if (!surface) return undefined;
  try {
    return surface.dataModel.get(pointer);
  } catch {
    return undefined;
  }
}

export function hasComponent(surface: SurfaceModel<any> | undefined, id: string): boolean {
  return !!surface?.componentsModel.get(id);
}

export function componentCount(surface: SurfaceModel<any> | undefined): number {
  if (!surface) return 0;
  let n = 0;
  for (const _ of surface.componentsModel.entries) n++;
  return n;
}

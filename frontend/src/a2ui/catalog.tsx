import React, { useState } from 'react';
import type { ActionPayload, ComponentDef } from '../types';
import { A2UIStore, ptrGet, resolvePath, type SurfaceState } from './store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

/** A2UI tone -> Fission Badge variant. */
const BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning'> = {
  brand: 'default', neutral: 'secondary', success: 'success', warning: 'warning',
};

interface RenderProps {
  store: A2UIStore;
  surface: SurfaceState;
  componentId: string;
  scope: string;
  onAction: (a: ActionPayload) => void;
}

const ICONS: Record<string, string> = {
  plane: '✈', bed: '🛏', wallet: '💰', check: '✅', map: '🗺',
};

/** Deterministic hue from a short label — used for the airline/hotel monogram
 * avatar so the same code always renders the same color, no data needed. */
function labelHue(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return h % 360;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function childList(store: A2UIStore, spec: any, surface: SurfaceState, scope: string): Array<{ id: string; scope: string }> {
  if (Array.isArray(spec)) return spec.map((id) => ({ id, scope }));
  if (spec && typeof spec === 'object' && spec.componentId) {
    const base = resolvePath(spec.path, scope);
    const arr = ptrGet(surface.dataModel, base);
    if (!Array.isArray(arr)) return [];
    return arr.map((_, i) => ({ id: spec.componentId, scope: `${base}/${i}` }));
  }
  return [];
}

export function Node({ store, surface, componentId, scope, onAction }: RenderProps): React.ReactElement | null {
  const comp = surface.components.get(componentId) as ComponentDef | undefined;
  if (!comp) return <div className="a2-pending" />;

  const ctx = { surface, scope };
  const kids = (spec: any) =>
    childList(store, spec, surface, scope).map((c) => (
      <Node key={`${c.id}|${c.scope}`} store={store} surface={surface} componentId={c.id} scope={c.scope} onAction={onAction} />
    ));

  switch (comp.component) {
    case 'Text': {
      const variant = comp.variant || 'body';
      const text = store.text(comp.text, ctx);
      if (!text) return null;
      return <div className={`a2-text a2-${variant}`}>{text}</div>;
    }
    case 'Image': {
      const url = store.text(comp.url, ctx);
      return <A2Image url={url} fit={comp.fit} />;
    }
    case 'Icon': {
      const label = comp.label ? store.text(comp.label, ctx) : '';
      if (label) {
        const hue = labelHue(label);
        return (
          <span
            className="a2-monogram"
            style={{ background: `hsl(${hue} 62% 92%)`, color: `hsl(${hue} 55% 32%)` }}
            aria-hidden
          >
            {label.slice(0, 2).toUpperCase()}
          </span>
        );
      }
      return <span className="a2-icon" aria-hidden>{ICONS[comp.name as string] ?? '⭐'}</span>;
    }
    case 'Badge': {
      const text = store.text(comp.text, ctx);
      if (!text) return null;
      const tone = (comp.tone ? store.text(comp.tone, ctx) : '') || 'neutral';
      return <Badge variant={BADGE_VARIANT[tone] || 'secondary'} className="whitespace-nowrap">{text}</Badge>;
    }
    case 'Divider':
      return <div className="a2-divider" />;
    case 'Row':
      return <div className="a2-row" style={rowColStyle(comp)}>{kids(comp.children)}</div>;
    case 'Column':
      return <div className="a2-column" style={rowColStyle(comp)}>{kids(comp.children)}</div>;
    case 'List':
      return <div className="a2-list">{kids(comp.children)}</div>;
    case 'Card':
      return (
        <div className="a2-card">
          {comp.child && <Node store={store} surface={surface} componentId={comp.child} scope={scope} onAction={onAction} />}
        </div>
      );
    case 'Tabs':
      return <TabsNode store={store} surface={surface} comp={comp} scope={scope} onAction={onAction} />;
    case 'TextField': {
      const path = resolvePath(comp.path, scope);
      const value = ptrGet(surface.dataModel, path) ?? '';
      const min = comp.min ? store.text(comp.min, ctx) : undefined;
      const max = comp.max ? store.text(comp.max, ctx) : undefined;
      return (
        <label className="a2-field">
          {comp.label && <span className="a2-field-label">{store.text(comp.label, ctx)}</span>}
          <input
            className="a2-field-input"
            type={comp.inputType || 'text'}
            min={min}
            max={max}
            placeholder={comp.placeholder ? store.text(comp.placeholder, ctx) : undefined}
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              store.setLocal(surface.id, path, v);
              // A check-in date pair: keep check-out (and its own min) at
              // least a day ahead whenever check-in moves past it, so the
              // native min= constraint can't be silently left stale.
              if (comp.inputType === 'date' && path.endsWith('/checkIn') && v) {
                const checkoutPath = `${path.slice(0, -'checkIn'.length)}checkOut`;
                const minPath = `${path.slice(0, -'checkIn'.length)}checkOutMin`;
                const nextMin = addDaysIso(v, 1);
                store.setLocal(surface.id, minPath, nextMin);
                const checkout = ptrGet(surface.dataModel, checkoutPath);
                if (!checkout || checkout <= v) store.setLocal(surface.id, checkoutPath, nextMin);
              }
            }}
          />
        </label>
      );
    }
    case 'ChoicePicker': {
      const path = resolvePath(comp.path, scope);
      const value = ptrGet(surface.dataModel, path);
      const options: any[] = comp.options || [];
      return (
        <div className="a2-field">
          {comp.label && <span className="a2-field-label">{store.text(comp.label, ctx)}</span>}
          <div className="a2-choicepicker">
            {options.map((opt) => (
              <button
                key={String(opt)}
                type="button"
                className={`a2-choice${value === opt ? ' a2-choice-active' : ''}`}
                onClick={() => store.setLocal(surface.id, path, opt)}
              >
                {String(opt)}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case 'Button': {
      const failingCheck = (comp.checks || []).find(
        (chk: any) => !store.resolve(chk.condition || { call: chk.call, args: chk.args }, ctx)
      );
      const btn = (
        <Button
          size="sm"
          variant={comp.variant === 'primary' ? 'default' : 'outline'}
          disabled={!!failingCheck}
          onClick={() => store.dispatch(comp, ctx, surface.id, onAction)}
        >
          {comp.child && <Node store={store} surface={surface} componentId={comp.child} scope={scope} onAction={onAction} />}
        </Button>
      );
      // A disabled <button> has pointer-events:none (see button.tsx), which
      // silently blocks a title= tooltip on the button itself — wrap it in a
      // span that carries the tooltip instead, so hovering the disabled area
      // still explains why it can't be clicked yet.
      if (failingCheck?.message) {
        return <span title={store.text(failingCheck.message, ctx)} style={{ display: 'inline-block' }}>{btn}</span>;
      }
      return btn;
    }
    default:
      return null;
  }
}

function A2Image({ url, fit }: { url: string; fit?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>(url ? 'loading' : 'error');
  // The url arrives async (a separate updateDataModel envelope after the
  // component tree), so it's often empty on first mount — re-derive the
  // state whenever it changes instead of freezing at the initial value.
  React.useEffect(() => setState(url ? 'loading' : 'error'), [url]);
  if (!url || state === 'error') {
    return (
      <div className="a2-img a2-img-fallback" aria-hidden>
        <span>{'🏙'}</span>
      </div>
    );
  }
  return (
    <div className="a2-img-wrap">
      {state === 'loading' && <div className="a2-img-shimmer" />}
      <img
        className="a2-img"
        style={fit ? { objectFit: fit as any } : undefined}
        src={url}
        alt=""
        loading="lazy"
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
      />
    </div>
  );
}

function TabsNode({ store, surface, comp, scope, onAction }: { store: A2UIStore; surface: SurfaceState; comp: ComponentDef; scope: string; onAction: (a: ActionPayload) => void }) {
  const tabs: Array<{ id: string; label: string }> = comp.tabs || [];
  const panels: Record<string, string> = comp.panels || {};
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <Tabs value={active} onValueChange={setActive}>
      <TabsList>
        {tabs.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id}>
          {panels[t.id] && <Node store={store} surface={surface} componentId={panels[t.id]} scope={scope} onAction={onAction} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function rowColStyle(comp: ComponentDef): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (comp.gap !== undefined) style.gap = comp.gap;
  if (comp.align) style.alignItems = comp.align === 'stretch' ? 'stretch' : comp.align === 'center' ? 'center' : comp.align === 'end' ? 'flex-end' : 'flex-start';
  if (comp.justify) style.justifyContent = comp.justify === 'between' ? 'space-between' : comp.justify === 'center' ? 'center' : comp.justify === 'end' ? 'flex-end' : 'flex-start';
  if (comp.wrap) style.flexWrap = 'wrap';
  if (comp.weight) style.flex = comp.weight;
  return style;
}

export function Surface({ store, surface, onAction, className }: { store: A2UIStore; surface: SurfaceState; onAction: (a: ActionPayload) => void; className?: string }) {
  if (!surface.components.has('root')) return null;
  return (
    <Card
      className={`shadow-md${className ? ` ${className}` : ''}`}
      style={{ borderTopWidth: 3, borderTopStyle: 'solid', borderTopColor: surface.theme.primaryColor || '#888' }}
    >
      <CardContent className="p-6">
        <Node store={store} surface={surface} componentId="root" scope="" onAction={onAction} />
      </CardContent>
    </Card>
  );
}

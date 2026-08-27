import React, { useState } from 'react';
import type { ActionPayload, ComponentDef } from '../types';
import { A2UIStore, ptrGet, resolvePath, type SurfaceState } from './store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PieChart } from '@/components/ui/pie-chart';
import { BarChart as RechartsBarChart } from '@/components/ui/bar-chart';
import { AreaChart as RechartsAreaChart } from '@/components/ui/area-chart';
import { RadarChart as RechartsRadarChart } from '@/components/ui/radar-chart';
import { RadialBarChart } from '@/components/ui/radial-bar-chart';

const inrTick = (v: number) => {
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L`;
  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `₹${Math.round(v)}`;
};
const inrFull = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

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
      return <A2Image url={url} fit={comp.fit} componentId={comp.id} />;
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
    case 'Bar': {
      // A simple horizontal progress/spend bar — the finance agent's
      // budget breakdowns and savings-goal trackers are the first things
      // in this app that need a data-viz primitive; everything before this
      // reused Text/Badge/Image, so this is a genuinely new catalog kind.
      const raw = store.resolve(comp.value, ctx);
      const pct = Math.max(0, Math.min(100, Number(raw) || 0));
      const tone = (comp.tone ? store.text(comp.tone, ctx) : '') || 'brand';
      const label = comp.label ? store.text(comp.label, ctx) : '';
      return (
        <div className="a2-bar">
          {label && <div className="a2-bar-label">{label}</div>}
          <div className="a2-bar-track">
            <div className={`a2-bar-fill a2-bar-${tone}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    case 'Pie': {
      // Category-breakdown donut for the finance portfolio/goals-analysis
      // cards — the Fission design system's PieChart (recharts-backed),
      // replacing the earlier hand-rolled conic-gradient version.
      const data: Array<{ label: string; value: number; amountLabel?: string }> = Array.isArray(comp.data) ? comp.data : [];
      if (!data.length) return null;
      return (
        <PieChart
          data={data}
          dataKey="value"
          nameKey="label"
          height={220}
          valueFormatter={inrFull}
        />
      );
    }
    case 'BarChart': {
      // Month-over-month comparison (e.g. "Expenses — last 6 months") for
      // the portfolio dashboard — the Fission design system's BarChart
      // (recharts-backed), replacing the earlier hand-rolled CSS columns.
      const data: Array<{ label: string; value: number; amountLabel?: string }> = Array.isArray(comp.data) ? comp.data : [];
      if (!data.length) return null;
      return (
        <RechartsBarChart
          data={data}
          index="label"
          categories={['value']}
          config={{ value: { label: 'Expenses' } }}
          height={220}
          showLegend={false}
          valueFormatter={inrTick}
        />
      );
    }
    case 'AreaChart': {
      // "Income vs Expenses" cash-flow trend — two overlaid series over
      // the last 6 months, the Fission design system's AreaChart.
      const data: Array<Record<string, unknown>> = Array.isArray(comp.data) ? comp.data : [];
      const categories: string[] = Array.isArray(comp.categories) ? comp.categories : [];
      const index: string = typeof comp.index === 'string' ? comp.index : 'label';
      const config = comp.config && typeof comp.config === 'object' ? comp.config : undefined;
      if (!data.length || !categories.length) return null;
      return (
        <RechartsAreaChart
          data={data}
          index={index}
          categories={categories}
          config={config}
          height={220}
          valueFormatter={inrTick}
        />
      );
    }
    case 'RadarChart': {
      // "Budget vs Actual" — % of each category's own budget limit spent
      // so far, one axis per category, all on the same 0-100(+) scale.
      const data: Array<Record<string, unknown>> = Array.isArray(comp.data) ? comp.data : [];
      const categories: string[] = Array.isArray(comp.categories) ? comp.categories : [];
      const index: string = typeof comp.index === 'string' ? comp.index : 'label';
      const config = comp.config && typeof comp.config === 'object' ? comp.config : undefined;
      if (!data.length || !categories.length) return null;
      return (
        <RechartsRadarChart
          data={data}
          index={index}
          categories={categories}
          config={config}
          height={260}
          valueFormatter={(v) => `${Math.round(v)}%`}
        />
      );
    }
    case 'Gauge': {
      // A single-ring radial gauge — "62% of this month's budget used" —
      // built from the design system's RadialBarChart with exactly one row.
      const label: string = typeof comp.label === 'string' ? comp.label : 'Used';
      const value = Math.max(0, Math.min(100, Number(store.resolve(comp.value, ctx)) || 0));
      return (
        <RadialBarChart
          data={[{ name: label, value }]}
          dataKey="value"
          nameKey="name"
          maxValue={100}
          height={200}
          valueFormatter={(v) => `${Math.round(v)}%`}
          showLegend={false}
          showTooltip={false}
        />
      );
    }
    case 'Divider':
      return <div className="a2-divider" />;
    case 'Row':
      return <div className={`a2-row${comp.panel ? ' a2-panel' : ''}${comp.grid ? ' a2-grid-row' : ''}`} data-cid={comp.id} style={rowColStyle(comp)}>{kids(comp.children)}</div>;
    case 'Column':
      return <div className={`a2-column${comp.panel ? ' a2-panel' : ''}`} data-cid={comp.id} style={rowColStyle(comp)}>{kids(comp.children)}</div>;
    case 'List':
      return <div className={`a2-list${comp.scroll ? ' a2-list-scroll' : ''}`}>{kids(comp.children)}</div>;
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

function A2Image({ url, fit, componentId }: { url: string; fit?: string; componentId?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>(url ? 'loading' : 'error');
  // The url arrives async (a separate updateDataModel envelope after the
  // component tree), so it's often empty on first mount — re-derive the
  // state whenever it changes instead of freezing at the initial value.
  React.useEffect(() => setState(url ? 'loading' : 'error'), [url]);
  if (!url || state === 'error') {
    return (
      <div className="a2-img a2-img-fallback" data-cid={componentId} aria-hidden>
        <span>{'🏙'}</span>
      </div>
    );
  }
  return (
    <div className="a2-img-wrap" data-cid={componentId}>
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
  const initial = comp.defaultTab && panels[comp.defaultTab] ? comp.defaultTab : tabs[0]?.id;
  const [active, setActive] = useState(initial);
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

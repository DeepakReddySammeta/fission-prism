/**
 * Voyage AI's A2UI component catalog — the same visual vocabulary the
 * hand-rolled renderer in the old `catalog.tsx` produced, re-expressed as
 * `@a2ui/react` component implementations so the a2ui engine (data binding,
 * templated child lists, action dispatch, `checks` validation, reactivity)
 * does the heavy lifting.
 *
 * Every arm here is a near-verbatim port of one `case` from the old
 * `Node()` switch; the only real change is that dynamic values arrive
 * pre-resolved on `props` instead of being pulled through `store.text()` /
 * `store.resolve()`.
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { ComponentContext } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PieChart } from '@/components/ui/pie-chart';
import { BarChart as RechartsBarChart } from '@/components/ui/bar-chart';
import { AreaChart as RechartsAreaChart } from '@/components/ui/area-chart';
import { RadarChart as RechartsRadarChart } from '@/components/ui/radar-chart';
import { RadialBarChart } from '@/components/ui/radial-bar-chart';

import {
  TextApi, ImageApi, IconApi, DividerApi, BadgeApi, BarApi, PieApi, BarChartApi,
  AreaChartApi, RadarChartApi, GaugeApi, RowApi, ColumnApi, ListApi, CardApi,
  TabsApi, DisclosureApi, ButtonApi, TextFieldApi, ChoicePickerApi, CheckBoxApi,
  SliderApi,
} from './apis';

/* ----------------------------- shared bits ----------------------------- */

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

type Props = Record<string, any>;
type BuildChild = (id: string, basePath?: string) => React.ReactNode;
interface RenderArgs { props: Props; buildChild: BuildChild; context: ComponentContext }

/** The binder resolves `children` to `Array<string | { id, basePath }>` —
 * bare ids for explicit lists, `{ id, basePath }` for templated ones. */
function Children({ list, buildChild }: { list: any; buildChild: BuildChild }) {
  if (!Array.isArray(list)) return null;
  return (
    <>
      {list.map((c: any, i: number) =>
        typeof c === 'string'
          ? <React.Fragment key={`${c}-${i}`}>{buildChild(c)}</React.Fragment>
          : <React.Fragment key={`${c.id}-${c.basePath}-${i}`}>{buildChild(c.id, c.basePath)}</React.Fragment>,
      )}
    </>
  );
}

function rowColStyle(p: Props): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (p.gap !== undefined) style.gap = p.gap;
  if (p.align) style.alignItems = p.align === 'stretch' ? 'stretch' : p.align === 'center' ? 'center' : p.align === 'end' ? 'flex-end' : 'flex-start';
  if (p.justify) style.justifyContent = p.justify === 'between' ? 'space-between' : p.justify === 'center' ? 'center' : p.justify === 'end' ? 'flex-end' : 'flex-start';
  if (p.wrap) style.flexWrap = 'wrap';
  if (p.weight) style.flex = p.weight;
  return style;
}

/** Absolute JSON-pointer for a (possibly relative) data path in `context`. */
function absPath(context: ComponentContext, p: string): string {
  if (!p) return '/';
  if (p.startsWith('/')) return p;
  const base = (context.dataContext.path || '/').replace(/\/$/, '');
  return `${base}/${p}`;
}

/** Reactive read of a bare-string data path (TextField / ChoicePicker keep a
 * `path` string rather than a `{ path }` dynamic binding). */
function useDataValue(context: ComponentContext, p?: string): any {
  const abs = p ? absPath(context, p) : undefined;
  return useSyncExternalStore(
    (cb) => {
      if (!abs) return () => {};
      const sub = context.dataContext.dataModel.subscribe(abs, cb);
      return () => sub.unsubscribe();
    },
    () => (abs ? context.dataContext.dataModel.get(abs) : undefined),
    () => (abs ? context.dataContext.dataModel.get(abs) : undefined),
  );
}

const impl = <A extends { name: string; schema: any }>(
  api: A,
  render: (a: RenderArgs) => React.ReactElement | null,
) => createComponentImplementation(api as any, render as any);

/* ------------------------------- content ------------------------------- */

const Text = impl(TextApi, ({ props }) => {
  const variant = props.variant || 'body';
  const text = props.text == null ? '' : String(props.text);
  if (!text) return null;
  return <div className={`a2-text a2-${variant}`}>{text}</div>;
});

function A2Image({ url, fit, componentId }: { url: string; fit?: string; componentId?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>(url ? 'loading' : 'error');
  useEffect(() => setState(url ? 'loading' : 'error'), [url]);
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

const Image = impl(ImageApi, ({ props, context }) => (
  <A2Image url={props.url ? String(props.url) : ''} fit={props.fit} componentId={context.componentModel.id} />
));

const Icon = impl(IconApi, ({ props }) => {
  const label = props.label ? String(props.label) : '';
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
  return <span className="a2-icon" aria-hidden>{ICONS[props.name as string] ?? '⭐'}</span>;
});

const Divider = impl(DividerApi, () => <div className="a2-divider" />);

const Badge_ = impl(BadgeApi, ({ props }) => {
  const text = props.text == null ? '' : String(props.text);
  if (!text) return null;
  const tone = (props.tone ? String(props.tone) : '') || 'neutral';
  return <Badge variant={BADGE_VARIANT[tone] || 'secondary'} className="whitespace-nowrap">{text}</Badge>;
});

/* ------------------------------ data viz ------------------------------ */

const Bar = impl(BarApi, ({ props }) => {
  const pct = Math.max(0, Math.min(100, Number(props.value) || 0));
  const tone = (props.tone ? String(props.tone) : '') || 'brand';
  const label = props.label ? String(props.label) : '';
  return (
    <div className="a2-bar">
      {label && <div className="a2-bar-label">{label}</div>}
      <div className="a2-bar-track">
        <div className={`a2-bar-fill a2-bar-${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
});

const Pie = impl(PieApi, ({ props }) => {
  const data: any[] = Array.isArray(props.data) ? props.data : [];
  if (!data.length) return null;
  return <PieChart data={data} dataKey="value" nameKey="label" height={220} valueFormatter={inrFull} />;
});

const BarChartC = impl(BarChartApi, ({ props }) => {
  const data: any[] = Array.isArray(props.data) ? props.data : [];
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
});

const AreaChartC = impl(AreaChartApi, ({ props }) => {
  const data: any[] = Array.isArray(props.data) ? props.data : [];
  const categories: string[] = Array.isArray(props.categories) ? props.categories : [];
  const index: string = typeof props.index === 'string' ? props.index : 'label';
  const config = props.config && typeof props.config === 'object' ? props.config : undefined;
  if (!data.length || !categories.length) return null;
  return (
    <RechartsAreaChart data={data} index={index} categories={categories} config={config} height={220} valueFormatter={inrTick} />
  );
});

const RadarChartC = impl(RadarChartApi, ({ props }) => {
  const data: any[] = Array.isArray(props.data) ? props.data : [];
  const categories: string[] = Array.isArray(props.categories) ? props.categories : [];
  const index: string = typeof props.index === 'string' ? props.index : 'label';
  const config = props.config && typeof props.config === 'object' ? props.config : undefined;
  if (!data.length || !categories.length) return null;
  return (
    <RechartsRadarChart data={data} index={index} categories={categories} config={config} height={260} valueFormatter={(v: number) => `${Math.round(v)}%`} />
  );
});

const Gauge = impl(GaugeApi, ({ props }) => {
  const label: string = typeof props.label === 'string' ? props.label : 'Used';
  const value = Math.max(0, Math.min(100, Number(props.value) || 0));
  return (
    <RadialBarChart
      data={[{ name: label, value }]}
      dataKey="value"
      nameKey="name"
      maxValue={100}
      height={200}
      valueFormatter={(v: number) => `${Math.round(v)}%`}
      showLegend={false}
      showTooltip={false}
    />
  );
});

/* ------------------------------- layout ------------------------------- */

const Row = impl(RowApi, ({ props, buildChild, context }) => (
  <div
    className={`a2-row${props.panel ? ' a2-panel' : ''}${props.grid ? ' a2-grid-row' : ''}`}
    data-cid={context.componentModel.id}
    style={rowColStyle(props)}
  >
    <Children list={props.children} buildChild={buildChild} />
  </div>
));

const Column = impl(ColumnApi, ({ props, buildChild, context }) => (
  <div
    className={`a2-column${props.panel ? ' a2-panel' : ''}`}
    data-cid={context.componentModel.id}
    style={rowColStyle(props)}
  >
    <Children list={props.children} buildChild={buildChild} />
  </div>
));

const List = impl(ListApi, ({ props, buildChild }) => (
  <div className={`a2-list${props.scroll ? ' a2-list-scroll' : ''}${props.layout === 'grid' ? ' a2-list-grid' : ''}`}>
    <Children list={props.children} buildChild={buildChild} />
  </div>
));

const Card = impl(CardApi, ({ props, buildChild }) => (
  <div className="a2-card">{props.child ? buildChild(props.child) : null}</div>
));

const TabsC = impl(TabsApi, ({ props, buildChild }) => {
  const tabs: Array<{ id: string; label: string }> = props.tabs || [];
  const panels: Record<string, string> = props.panels || {};
  const initial = props.defaultTab && panels[props.defaultTab] ? props.defaultTab : tabs[0]?.id;
  const [active, setActive] = useState(initial);
  return (
    <Tabs value={active} onValueChange={setActive}>
      <TabsList>
        {tabs.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id}>
          {panels[t.id] ? buildChild(panels[t.id]) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
});

const Disclosure = impl(DisclosureApi, ({ props, buildChild }) => {
  const [open, setOpen] = useState(false);
  const label = typeof props.label === 'string' ? props.label : 'Show more';
  if (open) return <>{props.child ? buildChild(props.child) : null}</>;
  return (
    <div className="a2-row">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{label}</Button>
    </div>
  );
});

/* ---------------------------- interactive ---------------------------- */

const TextField = impl(TextFieldApi, ({ props, context }) => {
  const path: string = props.path || '';
  const value = useDataValue(context, path) ?? '';
  return (
    <label className="a2-field">
      {props.label && <span className="a2-field-label">{String(props.label)}</span>}
      <input
        className="a2-field-input"
        type={props.inputType || 'text'}
        min={props.min != null ? String(props.min) : undefined}
        max={props.max != null ? String(props.max) : undefined}
        placeholder={props.placeholder ? String(props.placeholder) : undefined}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          context.dataContext.set(path, v);
          // Check-in / check-out date pair: keep check-out (and its own min)
          // at least a day ahead whenever check-in moves past it.
          if (props.inputType === 'date' && path.endsWith('/checkIn') && v) {
            const stem = path.slice(0, -'checkIn'.length);
            const nextMin = addDaysIso(v, 1);
            context.dataContext.set(`${stem}checkOutMin`, nextMin);
            const checkout = context.dataContext.dataModel.get(absPath(context, `${stem}checkOut`));
            if (!checkout || checkout <= v) context.dataContext.set(`${stem}checkOut`, nextMin);
          }
        }}
      />
    </label>
  );
});

const ChoicePicker = impl(ChoicePickerApi, ({ props, context }) => {
  const path: string = props.path || '';
  const value = useDataValue(context, path);
  const options: any[] = props.options || [];
  return (
    <div className="a2-field">
      {props.label && <span className="a2-field-label">{String(props.label)}</span>}
      <div className="a2-choicepicker">
        {options.map((opt) => (
          <button
            key={String(opt)}
            type="button"
            className={`a2-choice${value === opt ? ' a2-choice-active' : ''}`}
            onClick={() => context.dataContext.set(path, opt)}
          >
            {String(opt)}
          </button>
        ))}
      </div>
    </div>
  );
});

const ButtonC = impl(ButtonApi, ({ props, buildChild }) => {
  const message: string | undefined =
    props.isValid === false && Array.isArray(props.validationErrors) ? props.validationErrors[0] : undefined;
  const btn = (
    <Button
      size="sm"
      variant={props.variant === 'primary' ? 'default' : 'outline'}
      disabled={props.isValid === false}
      onClick={() => props.action?.()}
    >
      {props.child ? buildChild(props.child) : null}
    </Button>
  );
  // A disabled <button> has pointer-events:none, which swallows a title=
  // tooltip — wrap it so hovering the disabled area still explains why.
  if (message) {
    return <span title={message} style={{ display: 'inline-block' }}>{btn}</span>;
  }
  return btn;
});

const CheckBox = impl(CheckBoxApi, ({ props, context }) => {
  const path: string = props.path || '';
  const value = useDataValue(context, path);
  return (
    <label className="a2-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <input type="checkbox" checked={!!value} onChange={(e) => context.dataContext.set(path, e.target.checked)} />
      {props.label && <span className="a2-field-label">{String(props.label)}</span>}
    </label>
  );
});

const Slider = impl(SliderApi, ({ props, context }) => {
  const path: string = props.path || '';
  const value = useDataValue(context, path);
  return (
    <input
      type="range"
      min={props.min != null ? Number(props.min) : 0}
      max={props.max != null ? Number(props.max) : 100}
      value={Number(value) || 0}
      onChange={(e) => context.dataContext.set(path, Number(e.target.value))}
    />
  );
});

export const catalogComponents: ReactComponentImplementation[] = [
  Text, Image, Icon, Divider, Badge_, Bar, Pie, BarChartC, AreaChartC, RadarChartC, Gauge,
  Row, Column, List, Card, TabsC, Disclosure, ButtonC, TextField, ChoicePicker, CheckBox, Slider,
];

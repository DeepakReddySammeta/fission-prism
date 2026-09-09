/**
 * Prism's A2UI component catalog — the design system, exposed as the only
 * vocabulary a generated layout may use.
 *
 * The rule this file exists to enforce: *beauty lives in the components, not
 * in the arrangement*. Any reasonable composition of these must look right on
 * its own, because the layouts are generated (see `backend/src/orchestrator/
 * uiAgent.ts`) and nobody hand-tunes CSS for them afterwards. So every arm
 * below delegates to `@/components/ui/*` — the same shadcn/Fission primitives
 * the rest of the app uses — instead of styling a bare div.
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { ComponentContext } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card as UICard, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PieChart } from '@/components/ui/pie-chart';
import { BarChart as RechartsBarChart } from '@/components/ui/bar-chart';
import { AreaChart as RechartsAreaChart } from '@/components/ui/area-chart';
import { LineChart as RechartsLineChart } from '@/components/ui/line-chart';
import { RadarChart as RechartsRadarChart } from '@/components/ui/radar-chart';
import { RadialBarChart } from '@/components/ui/radial-bar-chart';

import {
  TextApi, ImageApi, IconApi, DividerApi, BadgeApi, MetricApi, BarApi, PieApi,
  BarChartApi, AreaChartApi, LineChartApi, RadarChartApi, GaugeApi, TableApi,
  RowApi, ColumnApi, ListApi, CardApi, TabsApi, DisclosureApi, ButtonApi,
  TextFieldApi, StepperApi, ChoicePickerApi, CheckBoxApi, SliderApi,
} from './apis';

/* ----------------------------- shared bits ----------------------------- */

const inrShort = (v: number) => {
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L`;
  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `₹${Math.round(v)}`;
};
const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const duration = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
};

/** Named formatters a generated layout can ask for by string — see `FORMATS`
 * in apis.ts. A layout can't ship a function, so it names one. */
const FORMATTERS: Record<string, (v: number) => string> = {
  inr, inrShort, percent: (v) => `${Math.round(v)}%`,
  number: (v) => Math.round(v).toLocaleString('en-IN'), duration,
};
const fmt = (name: unknown, fallback?: (v: number) => string) =>
  (typeof name === 'string' && FORMATTERS[name]) || fallback;

/** A2UI tone -> design-system Badge variant. */
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
  // `columns` turns any Row/Column/List into a grid — the one layout knob a
  // generated dashboard genuinely needs and flex alone can't express.
  if (p.columns) {
    style.display = 'grid';
    style.gridTemplateColumns = `repeat(${p.columns}, minmax(0, 1fr))`;
  }
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

const Metric = impl(MetricApi, ({ props }) => {
  const raw = props.value;
  const n = Number(raw);
  const formatter = fmt(props.format);
  const value = formatter && Number.isFinite(n) ? formatter(n) : raw == null ? '' : String(raw);
  const tone = props.tone === 'success' ? 'text-emerald-600' : props.tone === 'warning' ? 'text-amber-600' : 'text-muted-foreground';
  return (
    <div className="flex flex-col gap-1">
      {props.label != null && <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{String(props.label)}</span>}
      <span className="text-2xl font-semibold tabular-nums leading-tight">{value}</span>
      {props.delta != null && String(props.delta) !== '' && <span className={cn('text-xs', tone)}>{String(props.delta)}</span>}
    </div>
  );
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
  return (
    <PieChart
      data={data}
      dataKey={typeof props.dataKey === 'string' ? props.dataKey : 'value'}
      nameKey={typeof props.nameKey === 'string' ? props.nameKey : 'label'}
      donut={props.donut !== false}
      height={typeof props.height === 'number' ? props.height : 220}
      showLegend={props.showLegend !== false}
      valueFormatter={fmt(props.format, inr)}
    />
  );
});

/** data/index/categories/config/height/legend/format all come from the layout
 * — the shared shape behind BarChart, AreaChart, LineChart and RadarChart. */
function categoricalProps(props: Props, defaults: { height: number; format: (v: number) => string }) {
  const data: any[] = Array.isArray(props.data) ? props.data : [];
  const categories: string[] = Array.isArray(props.categories) ? props.categories : ['value'];
  return {
    ok: data.length > 0 && categories.length > 0,
    data,
    categories,
    index: typeof props.index === 'string' ? props.index : 'label',
    config: props.config && typeof props.config === 'object' ? props.config : undefined,
    height: typeof props.height === 'number' ? props.height : defaults.height,
    showLegend: props.showLegend !== false,
    valueFormatter: fmt(props.format, defaults.format),
  };
}

const BarChartC = impl(BarChartApi, ({ props }) => {
  const { ok, ...p } = categoricalProps(props, { height: 220, format: inrShort });
  return ok ? <RechartsBarChart {...p} /> : null;
});

const AreaChartC = impl(AreaChartApi, ({ props }) => {
  const { ok, ...p } = categoricalProps(props, { height: 220, format: inrShort });
  return ok ? <RechartsAreaChart {...p} /> : null;
});

const LineChartC = impl(LineChartApi, ({ props }) => {
  const { ok, ...p } = categoricalProps(props, { height: 220, format: inrShort });
  return ok ? <RechartsLineChart {...p} /> : null;
});

const RadarChartC = impl(RadarChartApi, ({ props }) => {
  const { ok, ...p } = categoricalProps(props, { height: 260, format: (v: number) => `${Math.round(v)}%` });
  return ok ? <RechartsRadarChart {...p} /> : null;
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
      height={typeof props.height === 'number' ? props.height : 200}
      valueFormatter={(v: number) => `${Math.round(v)}%`}
      showLegend={false}
      showTooltip={false}
    />
  );
});

const TableC = impl(TableApi, ({ props }) => {
  const rows: any[] = Array.isArray(props.rows) ? props.rows : [];
  const columns: any[] = Array.isArray(props.columns) ? props.columns : [];
  if (!rows.length || !columns.length) return null;
  const cell = (row: any, col: any) => {
    const raw = row?.[col.key];
    const formatter = fmt(col.format);
    const n = Number(raw);
    return formatter && Number.isFinite(n) ? formatter(n) : raw == null ? '' : String(raw);
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.key} className={c.align === 'right' ? 'text-right' : undefined}>{c.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={row?.id ?? i}>
            {columns.map((c) => (
              <TableCell key={c.key} className={cn('tabular-nums', c.align === 'right' && 'text-right')}>{cell(row, c)}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
  <div
    className={`a2-list${props.scroll ? ' a2-list-scroll' : ''}${props.layout === 'grid' && !props.columns ? ' a2-list-grid' : ''}`}
    style={props.columns ? { display: 'grid', gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` } : undefined}
  >
    <Children list={props.children} buildChild={buildChild} />
  </div>
));

const Card = impl(CardApi, ({ props, buildChild }) => {
  const title = props.title == null ? '' : String(props.title);
  const description = props.description == null ? '' : String(props.description);
  const body = props.child ? buildChild(props.child) : null;
  // No title/description means the layout is handling its own heading inside
  // the body (what every hand-written surface did) — don't force a header on it.
  if (!title && !description) return <UICard className="a2-card">{body}</UICard>;
  return (
    <UICard className="a2-card">
      <CardHeader>
        {title && <CardTitle>{title}</CardTitle>}
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </UICard>
  );
});

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
      <Button variant="default" size="sm" className="a2-disclosure-btn" onClick={() => setOpen(true)}>{label}</Button>
    </div>
  );
});

/* ---------------------------- interactive ---------------------------- */

/** Label + control, the one wrapper every bound input shares. */
function Field({ label, children, row }: { label?: unknown; children: React.ReactNode; row?: boolean }) {
  const text = label == null ? '' : String(label);
  return (
    <div className={cn('flex gap-1.5', row ? 'flex-row items-center' : 'flex-col', 'min-w-0')}>
      {text && <Label className="text-xs text-muted-foreground">{text}</Label>}
      {children}
    </div>
  );
}

const TextField = impl(TextFieldApi, ({ props, context }) => {
  const path: string = props.path || '';
  const value = useDataValue(context, path) ?? '';
  return (
    <Field label={props.label}>
      <Input
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
    </Field>
  );
});

const Stepper = impl(StepperApi, ({ props, context }) => {
  const path: string = props.path || '';
  const raw = useDataValue(context, path);
  const min = props.min != null ? Number(props.min) : 0;
  const max = props.max != null ? Number(props.max) : 99;
  const step = props.step != null ? Number(props.step) : 1;
  const value = Number.isFinite(Number(raw)) ? Number(raw) : min;
  const nudge = (by: number) => context.dataContext.set(path, Math.max(min, Math.min(max, value + by)));
  return (
    <Field label={props.label}>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={value <= min} onClick={() => nudge(-step)} aria-label="Decrease">–</Button>
        <span className="min-w-6 text-center text-sm font-medium tabular-nums">{value}</span>
        <Button type="button" variant="outline" size="sm" disabled={value >= max} onClick={() => nudge(step)} aria-label="Increase">+</Button>
      </div>
    </Field>
  );
});

const ChoicePicker = impl(ChoicePickerApi, ({ props, context }) => {
  const path: string = props.path || '';
  const value = useDataValue(context, path);
  const options: any[] = Array.isArray(props.options) ? props.options : [];
  return (
    <Field label={props.label}>
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
    </Field>
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
    <Field label={props.label} row>
      <input type="checkbox" checked={!!value} onChange={(e) => context.dataContext.set(path, e.target.checked)} />
    </Field>
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
  Text, Image, Icon, Divider, Badge_, Metric, Bar, Pie, BarChartC, AreaChartC,
  LineChartC, RadarChartC, Gauge, TableC,
  Row, Column, List, Card, TabsC, Disclosure,
  ButtonC, TextField, Stepper, ChoicePicker, CheckBox, Slider,
];

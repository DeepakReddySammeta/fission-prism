/**
 * Zod schemas for Prism's A2UI catalog components.
 *
 * The a2ui generic binder (`@a2ui/web_core`) reads these schemas structurally
 * to decide how to treat each prop:
 *   - a union that contains `{ path }` (and not `{ componentId }`) -> DYNAMIC
 *     (auto-resolved from the data model, plus a `set<Prop>` setter injected)
 *   - a union that contains `{ componentId, path }`             -> STRUCTURAL
 *     (a templated child list)
 *   - a union that contains `{ event }`                         -> ACTION
 *   - a prop literally named `checks`                           -> CHECKABLE
 *     (evaluated reactively into `isValid` / `validationErrors`)
 *   - anything else                                             -> STATIC
 *
 * Every prop a component actually honours is declared here, with a `.describe()`
 * that is the LLM's only documentation for it — `spec.ts` turns this file into
 * the catalog spec that goes in the UI-generation prompt. An undeclared prop is
 * an invisible prop: schemas stay `.passthrough()` so it would still render, but
 * no generated layout will ever use it.
 */
import { z } from 'zod';
import { CommonSchemas } from '@a2ui/web_core/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';

/** literal | { path } | { call, args } — detected as DYNAMIC. */
const DYN = CommonSchemas.DynamicString;
/** Same, but also accepts numbers/booleans/arrays — for chart data and rows. */
const DYNV = CommonSchemas.DynamicValue;
/** Numeric flavour of the above. */
const DYNN = CommonSchemas.DynamicNumber;
/** string[] | { componentId, path } — detected as STRUCTURAL. */
const CHILDREN = CommonSchemas.ChildList;
/** { event: { name, context } } | { call, args } — detected as ACTION. */
const ACTION = CommonSchemas.Action;
/** Rules array — the binder keys off the property name, not the shape. */
const CHECKS = z.array(z.any()).optional();

/**
 * Named number formatters. A generated layout cannot ship a function, so it
 * names one instead and the component looks it up (see `FORMATTERS` in
 * components.tsx). Keep this list and that map in step.
 */
export const FORMATS = ['inr', 'inrShort', 'percent', 'number', 'duration'] as const;
const FORMAT = z.enum(FORMATS).optional()
  .describe('Names a number formatter. inr = ₹1,23,456 · inrShort = ₹1.2L · percent · number · duration (from minutes).');

const api = (name: string, shape: z.ZodRawShape, doc?: string): ComponentApi => ({
  name,
  schema: z.object(shape).passthrough().describe(doc ?? ''),
});

/* ------------------------------- content ------------------------------- */

export const TextApi = api('Text', {
  text: DYN.optional().describe('The string to render.'),
  variant: z.enum(['h1', 'h2', 'h3', 'body', 'caption', 'mono']).optional()
    .describe('Typographic role. h2 titles a card, caption is secondary/muted, mono is for codes and figures.'),
}, 'A run of text. The workhorse — headings, labels, values, captions all use it.');

export const ImageApi = api('Image', {
  url: DYN.optional().describe('Absolute image URL. Falls back to a placeholder when empty or broken.'),
  fit: z.enum(['cover', 'contain']).optional().describe('CSS object-fit. Defaults to cover.'),
  height: z.number().optional().describe('Pixels. Overrides the default thumbnail height — use it for a photo that should read larger, e.g. a profile picture. Width follows the parent: put the Image in a Column with align "stretch" for it to fill full-bleed, or beside other content in a Row for it to size naturally.'),
}, 'A photo with built-in loading shimmer and error fallback.');

export const IconApi = api('Icon', {
  label: DYN.optional().describe('Short text (airline/hotel/person) rendered as a colour-coded monogram avatar.'),
  name: z.enum(['plane', 'bed', 'wallet', 'check', 'map']).optional().describe('Named glyph, used when `label` is absent.'),
}, 'A monogram avatar (with `label`) or a small named glyph (with `name`).');

export const DividerApi = api('Divider', {}, 'A horizontal rule separating sections inside a card.');

export const BadgeApi = api('Badge', {
  text: DYN.optional().describe('Short label. Badges are for status and tags, never for sentences.'),
  tone: DYN.optional().describe('Semantic colour: brand | neutral | success | warning. Defaults to neutral. Bindable, so a row can colour its own badge from the data.'),
}, 'A compact status pill.');

export const MetricApi = api('Metric', {
  label: DYN.optional().describe('What the number measures, e.g. "Monthly income".'),
  value: DYNV.optional().describe('The number itself. Bind it rather than pre-formatting it.'),
  delta: DYN.optional().describe('Optional change line, e.g. "+12% vs last month".'),
  tone: z.enum(['neutral', 'success', 'warning']).optional().describe('Colours the delta.'),
  format: FORMAT.describe(`How to render the value. One of: ${FORMATS.join(', ')}.`),
}, 'A single headline figure with its label — the tile to reach for in a dashboard stat row.');

/* ------------------------------ data viz ------------------------------ */

export const BarApi = api('Bar', {
  value: DYNN.optional().describe('Percentage filled, 0-100.'),
  tone: DYN.optional().describe('Fill colour: brand | neutral | success | warning. Use warning when a limit is exceeded. Bindable, so a row can colour its own bar from the data.'),
  label: DYN.optional().describe('Caption above the track.'),
}, 'A single inline progress bar. For a set of categories prefer BarChart.');

export const PieApi = api('Pie', {
  data: DYNV.optional().describe('Array of rows.'),
  dataKey: z.string().optional().describe('Row field holding the numeric value. Defaults to "value".'),
  nameKey: z.string().optional().describe('Row field holding the slice label. Defaults to "label".'),
  donut: z.boolean().optional().describe('Ring rather than solid pie. Defaults to true.'),
  format: FORMAT,
  height: z.number().optional().describe('Pixels. Defaults to 220.'),
  showLegend: z.boolean().optional().describe('Defaults to true.'),
}, 'A donut/pie chart for part-to-whole splits. Best under about 7 slices.');

const categorical = {
  data: DYNV.optional().describe('Array of rows, one per point on the x-axis.'),
  index: z.string().optional().describe('Row field for the x-axis. Defaults to "label".'),
  categories: DYNV.optional().describe('Row fields to plot as series, e.g. ["income","expenses"].'),
  config: z.record(z.any()).optional().describe('Per-series display overrides, e.g. { income: { label: "Income" } }.'),
  format: FORMAT,
  height: z.number().optional().describe('Pixels. Defaults to 220.'),
  showLegend: z.boolean().optional().describe('Defaults to true; turn off for a single series.'),
};

export const BarChartApi = api('BarChart', categorical, 'A bar chart comparing categories.');
export const AreaChartApi = api('AreaChart', categorical, 'An area chart for a value over time.');
export const LineChartApi = api('LineChart', categorical, 'A line chart for a trend over time.');
export const RadarChartApi = api('RadarChart', categorical, 'A radar chart comparing several axes at once.');

export const GaugeApi = api('Gauge', {
  value: DYNN.optional().describe('0-100.'),
  label: DYN.optional().describe('What is being filled, e.g. "Used".'),
  height: z.number().optional().describe('Pixels. Defaults to 200.'),
}, 'A radial gauge for a single percentage, e.g. budget utilisation.');

export const TableApi = api('Table', {
  columns: z.array(z.object({
    key: z.string().describe('Row field to read.'),
    label: z.string().describe('Column header.'),
    align: z.enum(['left', 'right']).optional().describe('Right-align numbers.'),
    format: FORMAT,
  })).optional().describe('Column definitions, left to right.'),
  rows: DYNV.optional().describe('Array of row objects. Bind this to a data path.'),
}, 'A real data table. Prefer it over stacks of Rows whenever the content is genuinely tabular — several records sharing the same fields.');

/* ------------------------------- layout ------------------------------- */

const box = {
  children: CHILDREN.optional().describe('Child component ids, or { componentId, path } to template one child per row of an array.'),
  gap: z.number().optional().describe('Pixels between children.'),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional().describe('Cross-axis alignment.'),
  justify: z.enum(['start', 'center', 'end', 'between']).optional().describe('Main-axis distribution.'),
  wrap: z.boolean().optional().describe('Let children flow onto more than one line.'),
  weight: z.number().optional().describe('Flex grow inside a parent Row/Column.'),
  panel: z.boolean().optional().describe('Renders as an inset bordered panel — a section within a card.'),
  columns: z.number().optional().describe('Lay children out as an N-column grid instead of a flex line.'),
};

export const RowApi = api('Row', box, 'A horizontal group. The default for putting a label and a value on one line.');
export const ColumnApi = api('Column', box, 'A vertical stack. The default container inside a Card.');

export const ListApi = api('List', {
  children: CHILDREN.optional(),
  layout: z.enum(['stack', 'grid']).optional().describe('Defaults to stack.'),
  columns: z.number().optional().describe('Column count when layout is grid.'),
  scroll: z.boolean().optional().describe('Caps height and scrolls instead of growing.'),
}, 'A repeated collection — bind `children` to `{ componentId, path }` to render one entry per row.');

export const CardApi = api('Card', {
  child: z.string().optional().describe('The single root child, almost always a Column.'),
  title: DYN.optional().describe('Optional card header title.'),
  description: DYN.optional().describe('Optional sub-line under the title.'),
}, 'The outermost surface. Every generated layout starts with exactly one Card whose id is "root".');

export const TabsApi = api('Tabs', {
  tabs: z.array(z.object({ id: z.string(), label: z.string() })).optional().describe('Tab order, left to right.'),
  panels: z.record(z.string()).optional().describe('Map of tab id -> child component id.'),
  defaultTab: z.string().optional().describe('Tab id open on first render. Defaults to the first tab.'),
}, 'Tabbed panels. Use only when content genuinely splits into alternatives the user picks between.');

export const DisclosureApi = api('Disclosure', {
  label: DYN.optional().describe('Button text shown while collapsed.'),
  child: z.string().optional().describe('Component id revealed when expanded.'),
}, 'Collapsed-by-default content behind a "show more" button.');

/* ---------------------------- interactive ---------------------------- */

export const ButtonApi = api('Button', {
  child: z.string().optional().describe('Component id of the label, normally a Text.'),
  variant: z.enum(['primary', 'outline']).optional().describe('primary is the one real commit action on a screen; outline (the default) is everything else.'),
  action: ACTION.optional().describe('{ event: { name, context } } dispatched on click.'),
  checks: CHECKS.describe('Validation rules; the button disables and explains itself while any fail.'),
}, 'A button. The only way a generated layout sends anything back to the server.');

export const TextFieldApi = api('TextField', {
  label: DYN.optional(),
  path: z.string().optional().describe('Absolute data-model path this field reads and writes.'),
  inputType: z.enum(['text', 'number', 'date', 'email', 'tel']).optional().describe('Native input type. Defaults to text.'),
  placeholder: DYN.optional(),
  min: DYN.optional(),
  max: DYN.optional(),
}, 'A labelled text input bound to the data model.');

export const StepperApi = api('Stepper', {
  label: DYN.optional(),
  path: z.string().optional().describe('Absolute data-model path this stepper reads and writes.'),
  min: z.number().optional().describe('Lower bound. Defaults to 0.'),
  max: z.number().optional().describe('Upper bound. Defaults to 99.'),
  step: z.number().optional().describe('Increment per press. Defaults to 1.'),
}, 'A -/+ number stepper. The right control for small counts like travellers or rooms.');

export const ChoicePickerApi = api('ChoicePicker', {
  label: DYN.optional().describe('What is being chosen.'),
  path: z.string().optional().describe('Absolute data-model path this picker reads and writes.'),
  options: DYNV.optional().describe('Array of choices.'),
}, 'A one-of-N picker rendered as a segmented control.');

export const CheckBoxApi = api('CheckBox', {
  label: DYN.optional().describe('Text beside the box.'),
  path: z.string().optional().describe('Absolute data-model path this toggle reads and writes.'),
}, 'A single boolean toggle.');

export const SliderApi = api('Slider', {
  path: z.string().optional().describe('Absolute data-model path this slider reads and writes.'),
  min: z.number().optional().describe('Defaults to 0.'),
  max: z.number().optional().describe('Defaults to 100.'),
}, 'A range input for a coarse numeric value.');

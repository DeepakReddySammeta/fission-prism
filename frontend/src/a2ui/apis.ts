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
 * Every schema is `.passthrough()` so the many presentational props the
 * backend sends (`gap`, `align`, `justify`, `wrap`, `weight`, `panel`, `grid`,
 * `layout`, `scroll`, `variant`, `tone`, `data`, `categories`, ...) survive
 * `schema.safeParse()` and reach the component untouched. The backend's
 * envelope builders (`backend/src/orchestrator/envelopes.ts`) are the source
 * of truth for what each component actually receives.
 */
import { z } from 'zod';
import { CommonSchemas } from '@a2ui/web_core/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';

/** literal | { path } | { call, args } — detected as DYNAMIC. */
const DYN = CommonSchemas.DynamicString;
/** string[] | { componentId, path } — detected as STRUCTURAL. */
const CHILDREN = CommonSchemas.ChildList;
/** { event: { name, context } } | { call, args } — detected as ACTION. */
const ACTION = CommonSchemas.Action;
/** Rules array — the binder keys off the property name, not the shape. */
const CHECKS = z.array(z.any()).optional();

const api = (name: string, shape: z.ZodRawShape): ComponentApi => ({
  name,
  schema: z.object(shape).passthrough(),
});

export const TextApi = api('Text', { text: DYN.optional() });
export const ImageApi = api('Image', { url: DYN.optional() });
export const IconApi = api('Icon', { label: DYN.optional() });
export const DividerApi = api('Divider', {});
export const BadgeApi = api('Badge', { text: DYN.optional(), tone: DYN.optional() });
export const BarApi = api('Bar', { value: DYN.optional(), tone: DYN.optional(), label: DYN.optional() });
export const PieApi = api('Pie', {});
export const BarChartApi = api('BarChart', {});
export const AreaChartApi = api('AreaChart', {});
export const RadarChartApi = api('RadarChart', {});
export const GaugeApi = api('Gauge', { value: DYN.optional() });
export const RowApi = api('Row', { children: CHILDREN.optional() });
export const ColumnApi = api('Column', { children: CHILDREN.optional() });
export const ListApi = api('List', { children: CHILDREN.optional() });
export const CardApi = api('Card', { child: z.string().optional() });
export const TabsApi = api('Tabs', {});
export const DisclosureApi = api('Disclosure', { label: DYN.optional(), child: z.string().optional() });
export const ButtonApi = api('Button', {
  child: z.string().optional(),
  action: ACTION.optional(),
  checks: CHECKS,
});
export const TextFieldApi = api('TextField', {
  label: DYN.optional(),
  min: DYN.optional(),
  max: DYN.optional(),
});
export const ChoicePickerApi = api('ChoicePicker', { label: DYN.optional() });
export const CheckBoxApi = api('CheckBox', { label: DYN.optional() });
export const SliderApi = api('Slider', {});

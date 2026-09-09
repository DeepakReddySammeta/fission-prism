/**
 * Generates every surface's component tree with the LLM. envelopes.ts keeps
 * only data assembly (formatting, computed fields) — no surface hand-writes
 * its own layout; that's this file's job alone, composing from the generic
 * catalog in catalog-spec.json.
 *
 * The split that makes this safe: the model composes *layout only*. Data stays
 * where the deterministic agents put it — the model never sees a chance to
 * invent a fare or a doctor's name, it only says "put the price here, bound to
 * /flights/price". A generation that fails validation renders one generic
 * "couldn't generate" notice (unavailableLayout below) — never a hand-written,
 * per-surface screen.
 *
 * Layouts are cached by (goal + data shape), not by request: the same kind of
 * answer reuses the same generated layout, so a chat turn pays no LLM latency
 * for its UI and repeat runs stay visually stable. A genuinely new shape of
 * answer is what triggers a fresh generation.
 */
import { generateJSON } from '../llm';
import { A2UI_VERSION, CATALOG_ID } from '../types';
import type { ComponentDef, Envelope } from '../types';
import catalogSpec from './catalog-spec.json';

interface PropSpec { name: string; type: string; required: boolean; doc?: string }
interface ComponentSpec { name: string; doc?: string; props: PropSpec[] }
interface FunctionSpec { name: string; returnType: string; args: string[] }

const SPEC = (catalogSpec as any).components as ComponentSpec[];
const FUNCTIONS = (catalogSpec as any).functions as FunctionSpec[];
const KNOWN = new Set(SPEC.map((c) => c.name));
const PROPS_OF = new Map(SPEC.map((c) => [c.name, new Set(c.props.map((p) => p.name))]));

/* ------------------------------- prompt ------------------------------- */

/**
 * The catalog, as compactly as it can be stated without losing anything the
 * model needs. Components sharing an identical prop list (the four categorical
 * charts, which differ only in mark) are folded into one entry — the prompt
 * competes with the output for the same tokens-per-minute budget, so a
 * duplicated block is paid for twice: once to send, once in output room lost.
 */
function renderCatalog(): string {
  const bySignature = new Map<string, { names: string[]; docs: string[]; props: PropSpec[] }>();
  for (const c of SPEC) {
    const sig = JSON.stringify(c.props);
    const group = bySignature.get(sig);
    if (group) { group.names.push(c.name); group.docs.push(c.doc ?? ''); }
    else bySignature.set(sig, { names: [c.name], docs: [c.doc ?? ''], props: c.props });
  }
  return [...bySignature.values()].map((g) => {
    const props = g.props.map((p) => `  ${p.name}: ${p.type}${p.doc ? ` — ${p.doc}` : ''}`).join('\n');
    const head = g.names.length === 1
      ? `${g.names[0]}${g.docs[0] ? ` — ${g.docs[0]}` : ''}`
      : `${g.names.join(' | ')} — same props, different mark. ${g.docs.map((d, i) => `${g.names[i]}: ${d}`).join(' ')}`;
    return `${head}\n${props}`;
  }).join('\n\n');
}

function renderFunctions(): string {
  return FUNCTIONS.map((f) => `  ${f.name}(${f.args.join(', ')}) -> ${f.returnType}`).join('\n');
}

const INSTRUCTIONS = `You lay out one screen of a travel/health/finance assistant, using ONLY the component catalog below. You return layout, never data.

CATALOG
${renderCatalog()}

FUNCTIONS
Any prop that accepts { path } also accepts { "call": "<name>", "args": { ... } }, whose args may themselves be bindings. Use these to format raw numbers for display — a price bound straight into a Text renders as 8432, not ₹8,432.
${renderFunctions()}
  e.g. { "call": "formatCurrency", "args": { "value": { "path": "price" }, "currency": "INR" } }
  e.g. { "call": "formatDuration", "args": { "value": { "path": "durationMins" } } }
The "checks" prop on Button takes [{ "condition": { "call": "required", "args": { "value": { "path": "/x" } } }, "message": "..." }].

RULES
1. Return JSON: { "components": [ { "id": "...", "component": "...", ...props } ] }.
2. Exactly one component has id "root" and component "Card". Everything else hangs off it.
3. Every id is unique, and every id you reference (children, child, panels) must be defined in the same array. No orphans: everything must be reachable from "root".
4. NEVER inline a data value. Show data by binding it to the prop that displays it: { "id": "price", "component": "Text", "text": { "path": "/flights/0/price" } }. A bare "path" is NOT a prop on display components — { "component": "Text", "path": "price" } renders nothing. Only use props listed for that component in the catalog above; any other prop is silently ignored. Text you invent yourself is only for labels, headings and captions.
5. For a collection, template it: give the List/Column a children of { "componentId": "<row component id>", "path": "/theArray" }, and inside that row component reference fields by RELATIVE path, e.g. { "path": "airline" }. Define the row component once. The row id you name in "componentId" is that component's ONLY parent — do not also list it in any other component's "children" array, and do not skip setting "children" this way and just define the row floating with nothing pointing at it (that is an orphan, and the whole screen is rejected). Worked example, a list of cards each showing a name and a price:
{ "id": "root", "component": "Card", "child": "list" },
{ "id": "list", "component": "List", "children": { "componentId": "row", "path": "/items" } },
{ "id": "row", "component": "Column", "gap": 8, "children": ["rowName", "rowPrice"] },
{ "id": "rowName", "component": "Text", "variant": "h3", "text": { "path": "name" } },
{ "id": "rowPrice", "component": "Text", "text": { "call": "formatCurrency", "args": { "value": { "path": "price" }, "currency": "INR" } } }
6. Use the data model given below. Only bind paths that actually exist in it. Paths are "/"-separated, never dot-separated: a nested field is { "path": "hospital/name" }, NOT "hospital.name".
7. Format every raw number you display: currency through formatCurrency, minute counts through formatDuration, or a component's own "format" prop where it has one. Never put a bare number on screen.
8. Prefer the specific component over a generic one: Metric for a headline figure, Table for genuinely tabular records, a chart for a series, Badge for status. Do not build a table out of Rows, and do not build a metric out of two Texts.
9. Buttons carry actions as { "event": { "name": "...", "context": { ... } } }. Only use action names the goal explicitly lists.

DESIGN
- One clear heading at the top (Text variant h2).
- Group related facts; use Row for label/value on one line, Column to stack, columns:N for a grid of tiles.
- Keep it dense but breathable: gap 8-16. Do not nest more than about 4 levels deep.
- Every screen should read top-to-bottom as: what this is → the content → the action, if any.`;

/* ---------------------------- data inspection ---------------------------- */

/** A compact type skeleton of the data model — keys and types, one sample row
 * for arrays, values truncated. This is both what the prompt shows the model
 * and what the layout cache is keyed on, so two answers with the same shape
 * share a layout and a genuinely new shape gets a fresh one. */
function shapeOf(value: any, depth = 0): any {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1)] : [];
  if (typeof value === 'object') {
    if (depth > 4) return '{…}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v, depth + 1)]));
  }
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return value;
}

function get(data: any, path: string): { found: boolean; value: any } {
  const parts = path.split('/').filter(Boolean);
  let cur = data;
  for (const part of parts) {
    if (cur === null || cur === undefined) return { found: false, value: undefined };
    // A relative path into a templated row lands on the array itself here;
    // step through element 0, which is what every row of it looks like.
    if (Array.isArray(cur) && !/^\d+$/.test(part)) cur = cur[0];
    if (cur === null || cur === undefined || !(part in Object(cur))) return { found: false, value: undefined };
    cur = cur[part];
  }
  return { found: true, value: cur };
}

/* ------------------------------ validation ------------------------------ */

/** Collects every { path } binding inside one component's props. */
function bindingsIn(node: any, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => bindingsIn(n, out)); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'path' && typeof v === 'string') out.push(v);
    else bindingsIn(v, out);
  }
  return out;
}

/** Child ids this component points at, plus any templated array path. */
function childrenOf(c: ComponentDef): { ids: string[]; template?: { id: string; path: string } } {
  const ids: string[] = [];
  let template: { id: string; path: string } | undefined;
  const kids = (c as any).children;
  if (Array.isArray(kids)) ids.push(...kids.filter((k): k is string => typeof k === 'string'));
  else if (kids && typeof kids === 'object' && typeof kids.componentId === 'string') {
    template = { id: kids.componentId, path: String(kids.path ?? '') };
    ids.push(kids.componentId);
  }
  if (typeof (c as any).child === 'string') ids.push((c as any).child);
  const panels = (c as any).panels;
  if (panels && typeof panels === 'object') ids.push(...Object.values(panels).filter((v): v is string => typeof v === 'string'));
  return { ids, template };
}

export interface ValidationResult { ok: boolean; errors: string[] }

/**
 * Everything that must hold for a generated layout to be worth rendering.
 * Deliberately strict: a silent half-broken screen is worse than falling back
 * to the hand-written one, and each error here is a scoreable failure mode for
 * the accuracy report.
 */
export function validateLayout(components: any, data: any): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(components) || components.length === 0) {
    return { ok: false, errors: ['components is not a non-empty array'] };
  }

  const byId = new Map<string, ComponentDef>();
  for (const c of components) {
    if (!c || typeof c.id !== 'string' || typeof c.component !== 'string') {
      errors.push(`malformed component: ${JSON.stringify(c).slice(0, 80)}`);
      continue;
    }
    if (byId.has(c.id)) errors.push(`duplicate id "${c.id}"`);
    if (!KNOWN.has(c.component)) errors.push(`unknown component "${c.component}" (id ${c.id})`);
    // Schemas are passthrough, so an undeclared prop renders as nothing at all
    // rather than erroring — which is how `{ component: "Text", path: "name" }`
    // (instead of `text: { path: "name" }`) produces a silently empty screen.
    // Catching it here is the difference between a caught failure and a blank.
    const allowed = PROPS_OF.get(c.component);
    if (allowed) {
      for (const prop of Object.keys(c)) {
        if (prop !== 'id' && prop !== 'component' && !allowed.has(prop)) {
          errors.push(`"${c.component}" has no prop "${prop}" (id ${c.id})`);
        }
      }
    }
    byId.set(c.id, c);
  }

  const root = byId.get('root');
  if (!root) errors.push('no component with id "root"');
  else if (root.component !== 'Card') errors.push(`root must be a Card, got ${root.component}`);

  // Walk from root: proves reachability, and carries the data context down so
  // relative paths inside a templated row are checked against that row.
  const seen = new Set<string>();
  const walk = (id: string, base: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const c = byId.get(id);
    if (!c) return;
    for (const p of bindingsIn({ ...c, children: undefined })) {
      const abs = p.startsWith('/') ? p : `${base}/${p}`.replace(/\/+/g, '/');
      if (!get(data, abs).found) errors.push(`unresolved binding "${p}" on ${c.component} "${id}"`);
    }
    const { ids, template } = childrenOf(c);
    for (const kid of ids) {
      if (!byId.has(kid)) { errors.push(`"${id}" references missing component "${kid}"`); continue; }
      const kidBase = template && template.id === kid ? template.path : base;
      if (template && template.id === kid && !get(data, template.path).found) {
        errors.push(`templated list "${id}" binds missing array "${template.path}"`);
      }
      walk(kid, kidBase);
    }
  };
  if (root) walk('root', '');

  for (const id of byId.keys()) {
    if (!seen.has(id)) errors.push(`orphan component "${id}" is unreachable from root`);
  }

  return { ok: errors.length === 0, errors };
}

/* ------------------------------ generation ------------------------------ */

export interface LayoutRequest {
  /** What this screen is for, in a sentence, plus any action names it may use. */
  goal: string;
  /** The data model this surface will be given — bindings are checked against it. */
  data: Record<string, any>;
}

const layoutCache = new Map<string, ComponentDef[]>();

export function layoutCacheKey(req: LayoutRequest): string {
  return `${req.goal}::${JSON.stringify(shapeOf(req.data))}`;
}

/**
 * Returns a validated component tree, or null to tell the caller to use its
 * hand-written builder. Never throws.
 */
export async function generateLayout(req: LayoutRequest): Promise<ComponentDef[] | null> {
  const key = layoutCacheKey(req);
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const basePrompt = [
    `GOAL\n${req.goal}`,
    `DATA MODEL (shape — bind against these paths)\n${JSON.stringify(shapeOf(req.data), null, 2)}`,
  ].join('\n\n');

  // One retry on a bad generation (malformed JSON, or a valid tree that fails
  // validation) — there is no hand-written screen to fall back to anymore, so
  // a single flaky response shouldn't cost the traveler the whole surface. A
  // genuine outage (provider down, no credentials) fails identically both
  // times and still degrades to unavailableLayout after this. The attempt
  // marker keeps generateJSON's own cache (keyed on the exact prompt text)
  // from just replaying attempt 1's bad output on attempt 2.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userContent = attempt === 1 ? basePrompt : `${basePrompt}\n\n(retry ${attempt})`;
    const result = await generateJSON<{ components: ComponentDef[] }>(INSTRUCTIONS, userContent, 30_000);
    if (!result?.components) continue;

    const { ok, errors } = validateLayout(result.components, req.data);
    if (!ok) {
      console.warn(`[uiAgent] rejected layout for "${req.goal.slice(0, 40)}" (attempt ${attempt}): ${errors.slice(0, 3).join('; ')}`);
      continue;
    }
    layoutCache.set(key, result.components);
    return result.components;
  }
  return null;
}

/** Exposed for the accuracy harness, which scores raw generations. */
export const _internals = { INSTRUCTIONS, shapeOf, renderCatalog };

/* --------------------------- server integration --------------------------- */

/** The data model a surface's envelopes write, assembled the way the client
 * will see it — so bindings are validated against the real paths. */
function dataModelOf(envelopes: Envelope[]): Record<string, any> {
  const model: Record<string, any> = {};
  for (const env of envelopes) {
    if (!('updateDataModel' in env)) continue;
    const parts = String(env.updateDataModel.path ?? '').split('/').filter(Boolean);
    const value = env.updateDataModel.value;
    if (!parts.length) { Object.assign(model, value); continue; }
    let cur = model;
    for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {});
    cur[parts[parts.length - 1]] = value;
  }
  return model;
}

/**
 * One catalog-only "couldn't generate" state — the single thing this file is
 * allowed to hand-write, because it's infrastructure (a network/LLM failure
 * notice), not a per-surface design. Every surface shows the exact same one.
 */
function unavailableLayout(): ComponentDef[] {
  return [
    { id: 'root', component: 'Card', child: 'msg' },
    { id: 'msg', component: 'Text', variant: 'body', text: "Couldn't generate this screen right now — please try again." },
  ];
}

/**
 * The one call site a surface needs: give it a `dataSource` that assembles
 * data (via the surface's existing envelope builder, for the scaffolding
 * envelopes and data model it already knows how to produce) and a `goal`
 * describing purpose and available actions. When the LLM returns a valid
 * layout it replaces the hand-written one; on any generation failure it
 * falls back to the original hand-written components rather than rendering
 * an error notice, so the app stays usable when the LLM is disabled or
 * unreachable.
 *
 * `goal` must not describe the arrangement: doing that is just hand-writing
 * the layout again in prose, and it would make the whole exercise unfalsifiable.
 */
export async function buildSurface(key: string, goal: string, dataSource: () => Envelope[]): Promise<Envelope[]> {
  const envelopes = dataSource();
  const data = dataModelOf(envelopes);
  const generated = await generateLayout({ goal: `${key}: ${goal}`, data });

  if (generated) {
    console.log(`[uiAgent] ${key}: rendering generated layout (${generated.length} components)`);
    return envelopes.map((env) =>
      'updateComponents' in env
        ? { ...env, updateComponents: { ...env.updateComponents, components: generated } }
        : env,
    );
  }

  // Fall back to the hand-written layout the dataSource already produced.
  console.log(`[uiAgent] ${key}: generation unavailable, keeping hand-written layout`);
  return envelopes;
}

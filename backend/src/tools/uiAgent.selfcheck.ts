/**
 * Self-check for validateLayout — the gate that decides whether a generated
 * layout reaches a user or falls back to the hand-written one. Every case here
 * is a failure mode actually observed from a model, not a hypothetical.
 *
 * Run: npx tsx src/tools/uiAgent.selfcheck.ts
 */
import assert from 'node:assert';
import { validateLayout, layoutCacheKey, _internals } from '../orchestrator/uiAgent';

const data = { flights: [{ id: 'F1', airline: 'Air India', price: 4200 }], total: 3 };

const ok = (components: any[], msg: string) => {
  const r = validateLayout(components, data);
  assert.ok(r.ok, `${msg} — expected valid, got: ${r.errors.join('; ')}`);
};
const bad = (components: any[], match: RegExp, msg: string) => {
  const r = validateLayout(components, data);
  assert.ok(!r.ok, `${msg} — expected invalid, but it passed`);
  assert.ok(r.errors.some((e) => match.test(e)), `${msg} — errors did not match ${match}: ${r.errors.join('; ')}`);
};

const list = [
  { id: 'root', component: 'Card', child: 'body' },
  { id: 'body', component: 'Column', children: ['head', 'rows'] },
  { id: 'head', component: 'Text', variant: 'h2', text: 'Flights' },
  { id: 'rows', component: 'List', children: { componentId: 'row', path: '/flights' } },
  { id: 'row', component: 'Row', children: ['airline'] },
  { id: 'airline', component: 'Text', text: { path: 'airline' } },
];

ok(list, 'a templated list with relative bindings');
ok(
  [...list, { id: 'price', component: 'Text', text: { call: 'formatCurrency', args: { value: { path: 'price' } } } }]
    .map((c) => (c.id === 'row' ? { ...c, children: ['airline', 'price'] } : c)),
  'a binding nested inside a function call',
);

bad([{ id: 'body', component: 'Column' }], /no component with id "root"/, 'missing root');
bad([{ id: 'root', component: 'Column' }], /root must be a Card/, 'root that is not a Card');
bad(
  [{ id: 'root', component: 'Card', child: 'x' }, { id: 'x', component: 'Sparkline' }],
  /unknown component "Sparkline"/, 'a component outside the catalog',
);
bad(
  [{ id: 'root', component: 'Card', child: 'x' }, { id: 'x', component: 'Text', path: 'airline' }],
  /has no prop "path"/, 'a bare path prop, which renders as nothing at all',
);
bad(
  [{ id: 'root', component: 'Card', child: 'nope' }],
  /references missing component "nope"/, 'a dangling child reference',
);
bad(
  [...list, { id: 'stray', component: 'Text', text: 'unreferenced' }],
  /orphan component "stray"/, 'a component nothing points at',
);
bad(
  [{ id: 'root', component: 'Card', child: 'x' }, { id: 'x', component: 'Text', text: { path: '/nope' } }],
  /unresolved binding "\/nope"/, 'a binding to a path the data model does not have',
);
bad(
  [{ id: 'root', component: 'Card', child: 'x' }, { id: 'x', component: 'List', children: { componentId: 'y', path: '/missing' } },
   { id: 'y', component: 'Text', text: 'hi' }],
  /binds missing array "\/missing"/, 'a templated list over an array that is not there',
);
bad(
  [{ id: 'root', component: 'Card', child: 'a' }, { id: 'a', component: 'Text', text: 'x' }, { id: 'a', component: 'Text', text: 'y' }],
  /duplicate id "a"/, 'two components sharing an id',
);

// Observed from the model twice: it reaches for `format` on a Text because
// every other component that shows a number has it. The catalog now declares
// it, and this is what fails if a spec regeneration ever drops it again.
ok(
  [{ id: 'root', component: 'Card', child: 'h' },
   { id: 'h', component: 'Text', variant: 'h2', format: 'inr', text: { path: '/total' } }],
  'a Text with a named number format',
);

/* ------------ quality warnings: renders fine, just badly composed ------------ */

const warn = (components: any[], match: RegExp, msg: string, d: any = data) => {
  const r = validateLayout(components, d);
  assert.ok(r.ok, `${msg} — should still be valid, got: ${r.errors.join('; ')}`);
  assert.ok(r.warnings.some((w) => match.test(w)), `${msg} — warnings did not match ${match}: ${r.warnings.join('; ')}`);
};
const clean = (components: any[], msg: string) => {
  const r = validateLayout(components, data);
  assert.ok(r.ok, `${msg} — expected valid, got: ${r.errors.join('; ')}`);
  assert.deepStrictEqual(r.warnings, [], `${msg} — expected no warnings, got: ${r.warnings.join('; ')}`);
};

// A warning must never make a layout unrenderable — that is the whole point
// of keeping the two lists apart.
warn(list, /no Metric, no|no Metric, Badge/, 'numbers shown with nothing lifting them');

clean(
  list.map((c) => (c.id === 'row' ? { ...c, children: ['airline', 'tag'] } : c))
    .concat([{ id: 'tag', component: 'Badge', text: { path: 'airline' } }] as any),
  'a Badge in the row is enough emphasis',
);

warn(
  [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['a', 'b', 'c', 'd', 'e', 'f'] },
    ...['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, component: 'Text', text: 'x' })),
  ],
  /stacks 6 ungrouped children/, 'a flat wall of siblings',
);

warn(
  [{ id: 'root', component: 'Card', child: 'x' }, { id: 'x', component: 'Text', text: 'hi' }],
  /no heading tier/, 'a screen with no h2',
);

warn(
  [{ id: 'root', component: 'Card', child: 'h' }, { id: 'h', component: 'Text', variant: 'h2', text: 'Hotels' }],
  /photo URL that no Image/, 'an unused photo URL',
  { hotel: { name: 'Sunset Bay', imageUrl: 'https://example.com/a.jpg' } },
);

/* --------------- cache key: shape, never the values in it --------------- */

const goal = 'flights: show the options';
const keyOf = (d: any) => layoutCacheKey({ goal, data: d });

assert.strictEqual(
  keyOf({ flights: [{ airline: 'IndiGo', price: 4200 }, { airline: 'Vistara', price: 5100 }] }),
  keyOf({ flights: [{ airline: 'Akasa Air', price: 9900 }, { airline: 'Air India', price: 3100 }] }),
  'same shape with different values must share one cached layout',
);
assert.notStrictEqual(
  keyOf({ flights: [{ airline: 'IndiGo', price: 4200 }] }),
  keyOf({ flights: Array.from({ length: 12 }, () => ({ airline: 'IndiGo', price: 4200 })) }),
  '1 row and 12 rows want different layouts, so they must not share a key',
);
assert.notStrictEqual(
  keyOf({ flights: [{ airline: 'IndiGo', price: 4200 }] }),
  keyOf({ flights: [{ airline: 'IndiGo', price: 4200, stops: 0 }] }),
  'an extra field is a different shape',
);

/* ---------------- array sizes: what the prompt reasons over ---------------- */

assert.deepStrictEqual(
  _internals.arraySizes({ flights: [{ id: 'a' }, { id: 'b' }], total: 2 }),
  ['/flights: 2 rows'],
  'array sizes list every array with its row count',
);
assert.deepStrictEqual(_internals.arraySizes({ hotels: [] }), ['/hotels: 0 rows'], 'an empty array is still reported');

console.log('uiAgent selfcheck: all cases passed');

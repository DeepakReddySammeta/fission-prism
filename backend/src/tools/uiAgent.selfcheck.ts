/**
 * Self-check for validateLayout — the gate that decides whether a generated
 * layout reaches a user or falls back to the hand-written one. Every case here
 * is a failure mode actually observed from a model, not a hypothetical.
 *
 * Run: npx tsx src/tools/uiAgent.selfcheck.ts
 */
import assert from 'node:assert';
import { validateLayout } from '../orchestrator/uiAgent';

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

console.log('uiAgent selfcheck: all cases passed');

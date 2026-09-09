/**
 * Guards the catalog spec against the layouts that actually ship.
 *
 * The failure this exists to prevent: narrowing a prop's schema to a fixed set
 * of values (`tone: z.enum([...])`) when a real surface binds it per-row
 * (`tone: { path: 'stopsTone' }`). The schema then rejects the binding, the
 * component fails to build, and the whole surface silently renders as a
 * never-resolving skeleton — no error anywhere, in the browser or the log.
 *
 * Two invariants, both learned the hard way:
 *   1. Every prop a golden binds dynamically must stay bindable in the spec.
 *   2. Every literal value a golden sends must satisfy that prop's enum.
 * Narrowing a prop's schema for better LLM docs is exactly how both get broken.
 *
 * Run: npx tsx src/tools/catalogGuard.ts   (npm run catalog:guard)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import catalogSpec from '../orchestrator/catalog-spec.json';

const GOLDENS = join(__dirname, '../../goldens');
const spec = (catalogSpec as any).components as Array<{ name: string; props: Array<{ name: string; type: string }> }>;

const typeOf = new Map<string, string>();
for (const c of spec) for (const p of c.props) typeOf.set(`${c.name}.${p.name}`, p.type);

const bindable = (type: string) => type.includes('{ path }') || type.includes('componentId') || type.includes('event');

/** The allowed set for a declared enum type like `"a" | "b"`, else null. */
function enumValues(type: string): Set<string> | null {
  if (bindable(type) || !type.includes('"')) return null;
  const values = type.match(/"([^"]+)"/g)?.map((v) => v.slice(1, -1)) ?? [];
  return values.length ? new Set(values) : null;
}

const problems: string[] = [];
const unknown: string[] = [];

for (const file of readdirSync(GOLDENS).filter((f) => f.endsWith('.json'))) {
  const envelopes = JSON.parse(readFileSync(join(GOLDENS, file), 'utf8'));
  for (const env of envelopes) {
    for (const c of env.updateComponents?.components ?? []) {
      for (const [prop, value] of Object.entries(c)) {
        if (prop === 'id' || prop === 'component') continue;
        const key = `${c.component}.${prop}`;
        const type = typeOf.get(key);
        if (type === undefined) { unknown.push(`${file}: ${key}`); continue; }
        const isBinding = value !== null && typeof value === 'object' && !Array.isArray(value)
          && ('path' in value || 'call' in value);
        if (isBinding && !bindable(type)) {
          problems.push(`${file}: ${key} is bound dynamically but declared as ${type}`);
          continue;
        }
        const allowed = enumValues(type);
        if (!isBinding && allowed && typeof value === 'string' && !allowed.has(value)) {
          problems.push(`${file}: ${key} sends "${value}" but the enum allows ${[...allowed].map((v) => `"${v}"`).join(' | ')}`);
        }
      }
    }
  }
}

if (unknown.length) {
  console.warn(`Props used by a golden but absent from the catalog spec (${unknown.length}):`);
  for (const u of [...new Set(unknown)]) console.warn(`  ${u}`);
}
if (problems.length) {
  console.error(`\nBROKEN — ${problems.length} prop(s) whose schema would reject the value a real surface sends:`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exit(1);
}
console.log('catalog guard: every bound prop is bindable, every literal value is in range');

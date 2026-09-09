/**
 * Writes the generated catalog spec to the backend, which reads it when
 * building the UI-generation prompt. Run after touching `src/a2ui/apis.ts`:
 *   npm run catalog:spec
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogSpec, functionSpec } from '../src/a2ui/spec';

const out = join(dirname(fileURLToPath(import.meta.url)), '../../backend/src/orchestrator/catalog-spec.json');
writeFileSync(out, `${JSON.stringify({ components: catalogSpec, functions: functionSpec }, null, 2)}\n`);
console.log(`wrote ${catalogSpec.length} components + ${functionSpec.length} functions -> ${out}`);

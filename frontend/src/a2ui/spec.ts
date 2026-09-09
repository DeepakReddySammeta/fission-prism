/**
 * Turns the catalog's zod schemas into the machine-readable spec that goes in
 * the UI-generation prompt (`backend/src/orchestrator/uiAgent.ts`).
 *
 * Generated, never hand-written: the prompt and the runtime therefore cannot
 * drift apart. Add a prop to `apis.ts` with a `.describe()` and the LLM knows
 * about it on the next `npm run catalog:spec`; forget the `.describe()` and it
 * shows up undocumented, which is the nudge to go write one.
 */
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import * as APIS from './apis';
import { catalogFunctions } from './functions';

export interface PropSpec {
  name: string;
  type: string;
  required: boolean;
  doc?: string;
}
export interface ComponentSpec {
  name: string;
  doc?: string;
  props: PropSpec[];
}
export interface FunctionSpec {
  name: string;
  returnType: string;
  args: string[];
}

/** Does this union arm look like `{ <key>: ... }`? Used to tell the a2ui
 * binder's magic union shapes (data binding, child list, action) apart. */
function armHasKey(arm: z.ZodTypeAny, key: string): boolean {
  const def: any = (arm as any)?._def;
  if (def?.typeName !== 'ZodObject') return false;
  return key in (typeof def.shape === 'function' ? def.shape() : def.shape ?? {});
}

function unionType(def: any): string {
  const arms: z.ZodTypeAny[] = def.options ?? [];
  if (arms.some((a) => armHasKey(a, 'componentId'))) return 'string[] | { componentId, path }';
  if (arms.some((a) => armHasKey(a, 'event'))) return '{ event: { name, context } }';
  if (arms.some((a) => armHasKey(a, 'path'))) {
    // Bindable. Report what a literal may be, since that's the choice the
    // layout actually makes each time it uses the prop.
    const literals = arms
      .map((a) => (a as any)._def?.typeName)
      .filter((t) => t && t !== 'ZodObject')
      .map((t: string) => t.replace('Zod', '').toLowerCase());
    const lit = literals.length ? literals.join(' | ') : 'value';
    return `${lit} | { path }`;
  }
  return 'union';
}

function typeName(schema: z.ZodTypeAny): string {
  const def: any = (schema as any)._def;
  switch (def?.typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
      return typeName(def.innerType);
    case 'ZodString': return 'string';
    case 'ZodNumber': return 'number';
    case 'ZodBoolean': return 'boolean';
    case 'ZodEnum': return def.values.map((v: string) => JSON.stringify(v)).join(' | ');
    case 'ZodArray': return `${typeName(def.type)}[]`;
    case 'ZodRecord': return 'object';
    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      return `{ ${Object.keys(shape).join(', ')} }`;
    }
    case 'ZodUnion': return unionType(def);
    case 'ZodAny': return 'any';
    default: return def?.typeName?.replace('Zod', '').toLowerCase() ?? 'any';
  }
}

function describe(schema: z.ZodTypeAny): string | undefined {
  const def: any = (schema as any)._def;
  return def?.description
    ?? (def?.typeName === 'ZodOptional' || def?.typeName === 'ZodDefault'
      ? describe(def.innerType)
      : undefined);
}

function specFor(api: ComponentApi): ComponentSpec {
  const schema: any = api.schema;
  const shape = typeof schema._def.shape === 'function' ? schema._def.shape() : schema._def.shape ?? {};
  return {
    name: api.name,
    doc: schema._def.description || undefined,
    props: Object.entries(shape).map(([name, s]) => ({
      name,
      type: typeName(s as z.ZodTypeAny),
      required: (s as any)?._def?.typeName !== 'ZodOptional',
      doc: describe(s as z.ZodTypeAny),
    })),
  };
}

/** Every exported `*Api` in apis.ts, in declaration order. */
export const catalogSpec: ComponentSpec[] = Object.entries(APIS)
  .filter(([name, v]) => name.endsWith('Api') && v && typeof v === 'object' && 'schema' in (v as object))
  .map(([, api]) => specFor(api as ComponentApi));

/** The logic functions a layout may call as { call, args } — formatting and
 * validation. Emitted from the same implementations the runtime registers, so
 * the prompt can never offer a function the client cannot execute. */
export const functionSpec: FunctionSpec[] = catalogFunctions.map((f: any) => {
  const schema = f.schema ?? f.api?.schema;
  const shape = schema?._def?.shape;
  const resolved = typeof shape === 'function' ? shape() : shape ?? {};
  return {
    name: f.name ?? f.api?.name,
    returnType: f.returnType ?? f.api?.returnType ?? 'string',
    args: Object.keys(resolved),
  };
});

import type { Envelope } from '../types';
import { CATALOG_COMPONENTS, CATALOG_FUNCTIONS } from '../types';

const catalogSet = new Set<string>(CATALOG_COMPONENTS);
const functionSet = new Set<string>(CATALOG_FUNCTIONS as readonly string[]);

/**
 * Even though envelopes in this app are built by our own server code (not raw
 * LLM output), every envelope still passes through here before reaching the
 * client. This is what makes the orchestrator a real boundary rather than a
 * naming convention: if an agent's envelope-building code is ever swapped for
 * something that emits raw LLM JSON directly, this keeps working unchanged.
 */
export function validateEnvelope(e: Envelope): { ok: boolean; reason?: string } {
  const kind = Object.keys(e).find((k) => k !== 'version');
  if (!kind) return { ok: false, reason: 'empty envelope' };

  if (kind === 'updateComponents') {
    const comps = (e as any).updateComponents.components;
    for (const c of comps) {
      if (!catalogSet.has(c.component)) {
        return { ok: false, reason: `off-catalog component: ${c.component}` };
      }
      const bad = findBadFunctionCalls(c);
      if (bad) return { ok: false, reason: `off-catalog function: ${bad}` };
    }
  }
  return { ok: true };
}

function findBadFunctionCalls(node: any): string | null {
  if (Array.isArray(node)) {
    for (const n of node) { const r = findBadFunctionCalls(n); if (r) return r; }
    return null;
  }
  if (node && typeof node === 'object') {
    if (typeof node.call === 'string' && !functionSet.has(node.call)) return node.call;
    for (const v of Object.values(node)) { const r = findBadFunctionCalls(v); if (r) return r; }
  }
  return null;
}

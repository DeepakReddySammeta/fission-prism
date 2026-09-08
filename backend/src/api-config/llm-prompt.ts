import type { ApiConfig } from './types';

/**
 * Build the LLM prompt from the config's llmView section.
 * Substitutes {schemaDescription} and {designInstructions} placeholders
 * in the promptTemplate. No actual data values are ever included.
 *
 * Throws if the config has no llmView section.
 */
export function buildLlmPrompt(config: ApiConfig): string {
  const { llmView } = config;
  if (!llmView) {
    throw new Error('Config has no llmView section — cannot build LLM prompt');
  }
  return llmView.promptTemplate
    .replace(/\{schemaDescription\}/g, llmView.schemaDescription.trim())
    .replace(/\{designInstructions\}/g, llmView.designInstructions.trim());
}

/**
 * Build a deterministic hash from the LLM view schema.
 * Used as a cache key so identical schemas reuse cached LLM templates.
 * The hash is based on schema + instructions, NOT on query or data —
 * this guarantees privacy (no data ever touches the LLM prompt).
 *
 * Throws if the config has no llmView section.
 */
export function buildSchemaHash(config: ApiConfig): string {
  const { llmView } = config;
  if (!llmView) {
    throw new Error('Config has no llmView section — cannot build schema hash');
  }
  const key = `${llmView.schemaDescription}|${llmView.designInstructions}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return String(h);
}

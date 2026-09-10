/** The one call shape every provider backend implements. It returns raw model
 * text (expected to be a single JSON object) plus token counts for logging;
 * `../llm` owns parsing, caching and the mock-fallback contract. */
export interface LlmCompletion {
  text: string | null;
  promptTokens?: number;
  completionTokens?: number;
}

/** Per-call overrides. `model` lets one caller (the router) run on a
 * different model than the rest — separate rate-limit bucket, different
 * size/speed tradeoff. `temperature` lets a classification call ask for
 * less variance than a content-generation one. */
export interface CompleteOptions {
  model?: string;
  temperature?: number;
  /** Cap on generated tokens. Providers bill the *reserved* cap against a
   * per-minute quota, so a caller with a small answer (the router returns one
   * short object) should say so rather than reserve a layout-sized budget. */
  maxTokens?: number;
}

export type CompleteFn = (
  instructions: string,
  userContent: string,
  timeoutMs: number,
  options?: CompleteOptions,
) => Promise<LlmCompletion>;

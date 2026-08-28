/** The one call shape every provider backend implements. It returns raw model
 * text (expected to be a single JSON object) plus token counts for logging;
 * `../llm` owns parsing, caching and the mock-fallback contract. */
export interface LlmCompletion {
  text: string | null;
  promptTokens?: number;
  completionTokens?: number;
}

export type CompleteFn = (
  instructions: string,
  userContent: string,
  timeoutMs: number,
) => Promise<LlmCompletion>;

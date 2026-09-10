import Groq from 'groq-sdk';
import { GROQ_API_KEY, LLM_MAX_TOKENS } from '../config';
import type { CompleteFn } from './types';

/** Groq backend: a fast, non-reasoning chat-completions model with native
 * JSON-object response mode. Selected when LLM_PROVIDER=groq (the default). */
export function createGroqBackend(model: string): CompleteFn {
  // No retries, same reasoning as the Bedrock backend: every caller already
  // falls back to mock data on failure, so a retry only delays that. It
  // matters more here than there — the SDK honours a 429's Retry-After, and
  // that wait is not covered by the per-attempt `timeout` below, so a
  // rate-limited call could hang for minutes past its deadline with the
  // chat's progress indicator still spinning.
  const client = new Groq({ apiKey: GROQ_API_KEY, maxRetries: 0 });

  return async function complete(instructions, userContent, timeoutMs, options) {
    const completion = await client.chat.completions.create(
      {
        model: options?.model || model,
        temperature: options?.temperature ?? 0.4,
        // A safety bound on runaway generation; the Bedrock path has always
        // had one and this path had none. See LLM_MAX_TOKENS.
        max_completion_tokens: options?.maxTokens ?? LLM_MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${instructions}\nRespond with ONLY a single JSON object, no prose, no markdown fences.`,
          },
          { role: 'user', content: userContent },
        ],
      },
      { timeout: timeoutMs },
    );

    return {
      text: completion.choices[0]?.message?.content ?? null,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
    };
  };
}

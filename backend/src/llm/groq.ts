import Groq from 'groq-sdk';
import { GROQ_API_KEY } from '../config';
import type { CompleteFn } from './types';

/** Groq backend: a fast, non-reasoning chat-completions model with native
 * JSON-object response mode. Selected when LLM_PROVIDER=groq (the default). */
export function createGroqBackend(model: string): CompleteFn {
  const client = new Groq({ apiKey: GROQ_API_KEY });

  return async function complete(instructions, userContent, timeoutMs) {
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.4,
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

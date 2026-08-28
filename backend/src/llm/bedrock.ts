import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION } from '../config';
import type { CompleteFn } from './types';

/** Strips a ```json … ``` (or bare ``` … ```) fence if the model wrapped its
 * answer in one. Groq's JSON mode never does this; Claude on Bedrock
 * occasionally will, so normalise before the shared JSON.parse. */
function unfence(text: string): string {
  const fenced = text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * AWS Bedrock backend, talking to a Claude model via the Anthropic Messages
 * API shape (`converse`-equivalent). Selected when LLM_PROVIDER=bedrock.
 *
 * Thinking is disabled so responses come back at chat speed — the agents only
 * ever want a compact JSON object, and a live demo can't wait on reasoning.
 * `temperature` is intentionally omitted: Claude Sonnet 5 rejects sampling
 * params with a 400.
 */
export function createBedrockBackend(model: string): CompleteFn {
  // No retries: every caller already falls back to mock data on failure, so a
  // retry just multiplies the wall-clock time before that fallback kicks in
  // (a 15s timeout became ~46s with the SDK's default 2 retries).
  //
  // Static keys are passed only when both are set. Otherwise the SDK falls
  // back to the ambient AWS credential chain — an EC2 instance role, an ECS
  // task role, SSO, or ~/.aws — which is how this runs on AWS
  // (AWS_USE_IAM_ROLE=true) with no long-lived keys in the environment.
  const client =
    AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
      ? new AnthropicBedrock({
          awsRegion: AWS_REGION,
          awsAccessKey: AWS_ACCESS_KEY_ID,
          awsSecretKey: AWS_SECRET_ACCESS_KEY,
          awsSessionToken: AWS_SESSION_TOKEN || null,
          maxRetries: 0,
        })
      : new AnthropicBedrock({ awsRegion: AWS_REGION, maxRetries: 0 });

  return async function complete(instructions, userContent, timeoutMs) {
    const message = await client.messages.create(
      {
        model,
        max_tokens: 8192,
        thinking: { type: 'disabled' },
        system: `${instructions}\nRespond with ONLY a single JSON object, no prose, no markdown fences.`,
        messages: [{ role: 'user', content: userContent }],
      },
      { timeout: timeoutMs },
    );

    const text = message.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    return {
      text: text ? unfence(text) : null,
      promptTokens: message.usage?.input_tokens,
      completionTokens: message.usage?.output_tokens,
    };
  };
}

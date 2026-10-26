import type { ZodType } from 'zod';
import type { ChatMessage, LlmClient } from './types';

/** Pulls the first JSON object or array out of a reply that may include prose or code fences. */
export function extractJson(text: string): unknown {
  // Reasoning models may prefix their answer with <think>...</think>.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('Reply was not JSON');
  }
}

export interface CompleteJsonOptions {
  retries?: number;
  temperature?: number;
  maxTokens?: number;
  /** Stops waiting for the model (for example when the listener cancels). */
  signal?: AbortSignal;
}

/**
 * Asks for JSON, validates it against `schema`, and on failure re-prompts with the validation
 * error so the model can correct itself. Throws after the retry budget is spent.
 */
export async function completeJson<T>(
  llm: LlmClient,
  messages: ChatMessage[],
  schema: ZodType<T>,
  options: CompleteJsonOptions = {},
): Promise<{ data: T; attempts: number; usage: { promptTokens: number; completionTokens: number } }> {
  const retries = options.retries ?? 2;
  const convo = [...messages];
  const usage = { promptTokens: 0, completionTokens: 0 };
  let lastError = '';
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    options.signal?.throwIfAborted();
    const res = await llm.chat(convo, {
      json: true,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    });
    usage.promptTokens += res.usage.promptTokens;
    usage.completionTokens += res.usage.completionTokens;
    try {
      const parsed = schema.safeParse(extractJson(res.content));
      if (parsed.success) return { data: parsed.data, attempts: attempt, usage };
      lastError = parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    convo.push({ role: 'assistant', content: res.content.slice(0, 4000) });
    convo.push({
      role: 'user',
      content: `Your previous reply did not match the required format (${lastError}). Reply again with only the corrected JSON object.`,
    });
  }
  throw new Error(`Model output did not match the required format after ${retries + 1} attempts: ${lastError}`);
}

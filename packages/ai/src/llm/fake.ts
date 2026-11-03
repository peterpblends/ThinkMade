import type { ChatMessage, LlmClient } from './types';

/** Deterministic stand-in for tests and offline demos. Never used in production. */
export function createFakeLlm(respond: (messages: ChatMessage[]) => string, model = 'fake'): LlmClient {
  return {
    provider: 'fake',
    model,
    async chat(messages, options) {
      const content = respond(messages);
      // Streams word by word, as a real model does.
      if (options?.onToken) for (const piece of content.match(/\S+\s*|\s+/g) ?? []) options.onToken(piece);
      return { content, usage: { promptTokens: 0, completionTokens: 0 } };
    },
  };
}

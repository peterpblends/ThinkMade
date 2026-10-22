import type { ChatMessage, LlmClient } from './types';

/** Deterministic stand-in for tests and offline demos. Never used in production. */
export function createFakeLlm(respond: (messages: ChatMessage[]) => string, model = 'fake'): LlmClient {
  return {
    provider: 'fake',
    model,
    async chat(messages) {
      const content = respond(messages);
      return { content, usage: { promptTokens: 0, completionTokens: 0 } };
    },
  };
}

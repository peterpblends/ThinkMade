export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

/** Multimodal content (OpenAI format) for vision-capable models. */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatOptions {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  usage: { promptTokens: number; completionTokens: number };
}

export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  /** Prompt plus output tokens one request may use, when the provider caps it. */
  readonly requestTokenLimit?: number;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export function textOf(content: ChatMessage['content']): string {
  return typeof content === 'string' ? content : content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n');
}

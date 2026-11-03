import type { SttEngine } from './types';

export function createOpenAiCompatibleStt(cfg: {
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  fetch?: typeof fetch;
  name?: string;
}): SttEngine {
  const doFetch = cfg.fetch ?? fetch;
  return {
    name: cfg.name ?? 'openai-compatible',
    async transcribe(audio, meta) {
      const form = new FormData();
      form.set('model', cfg.model);
      form.set('response_format', 'json');
      if (meta.language) form.set('language', meta.language);
      if (meta.prompt) form.set('prompt', meta.prompt.slice(0, 600));
      form.set('temperature', '0');
      form.set('file', new File([new Uint8Array(audio)], meta.filename, { type: meta.contentType }));
      const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(meta.timeoutMs ?? 120_000),
      });
      if (!res.ok) throw new Error(`Transcription failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { text?: string };
      return { text: (data.text ?? '').trim() };
    },
  };
}

export function createFakeStt(text = 'How can I become a better leader?'): SttEngine {
  return { name: 'fake', async transcribe() { return { text }; } };
}

/** Builds the configured speech-to-text engine, or null when none is configured. */
export function createStt(env: Record<string, string | undefined> = process.env): SttEngine | null {
  if (env.NODE_ENV !== 'production' && (env.STT_PROVIDER === 'fake' || (env.NODE_ENV === 'test' && !env.STT_PROVIDER))) return createFakeStt();
  if (env.GROQ_API_KEY) {
    return createOpenAiCompatibleStt({
      name: 'groq-whisper',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      model: env.STT_MODEL ?? 'whisper-large-v3-turbo',
    });
  }
  return null;
}

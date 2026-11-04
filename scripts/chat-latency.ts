/**
 * Measures how quickly each fast chat model starts answering a coach-sized request (time to first word, and to
 * the end of the first sentence), with each model's per-minute token allowance, plus how long Whisper takes on
 * a short clip. Used to pick the quickest chain for live conversations. Run by the Models workflow.
 *   npx tsx scripts/chat-latency.ts
 */
const groq = process.env.GROQ_API_KEY;
const gemini = process.env.GEMINI_API_KEY;

// About the size of a spoken coach turn: instructions, episode context and a little history.
const filler = 'The episode explains opportunity cost: every choice gives up the next best alternative, and naming that alternative makes trade-offs visible. ';
const system = `You are a warm, sharp thinking coach in a live spoken conversation. Reply in one to three short sentences.\n\nContext:\n${filler.repeat(70)}`;
const messages = [
  { role: 'system', content: system },
  { role: 'user', content: 'I keep saying yes to every project at work. How do I decide what to drop?' },
];

type Candidate = { provider: 'groq' | 'gemini'; model: string; params?: Record<string, unknown> };
const candidates: Candidate[] = [
  { provider: 'groq', model: 'openai/gpt-oss-20b', params: { reasoning_effort: 'low' } },
  { provider: 'groq', model: 'openai/gpt-oss-120b', params: { reasoning_effort: 'low' } },
  { provider: 'groq', model: 'llama-3.1-8b-instant' },
  { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { provider: 'groq', model: 'meta-llama/llama-4-maverick-17b-128e-instruct' },
  { provider: 'groq', model: 'qwen/qwen3-32b', params: { reasoning_effort: 'none' } },
  { provider: 'groq', model: 'moonshotai/kimi-k2-instruct-0905' },
  { provider: 'gemini', model: 'gemini-flash-lite-latest', params: { reasoning_effort: 'none' } },
  { provider: 'gemini', model: 'gemini-flash-latest', params: { reasoning_effort: 'none' } },
  { provider: 'gemini', model: 'gemini-2.5-flash-lite', params: { reasoning_effort: 'none' } },
];

async function measure(c: Candidate) {
  const key = c.provider === 'groq' ? groq : gemini;
  if (!key) return `${c.model}: no key`;
  const url = c.provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: c.model, messages, max_tokens: 300, temperature: 0.7, stream: true, ...c.params }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => e as Error);
  if (res instanceof Error) return `${c.model}: ${res.message}`;
  const limit = `tpm=${res.headers.get('x-ratelimit-limit-tokens') ?? '?'} rpd=${res.headers.get('x-ratelimit-limit-requests') ?? '?'}`;
  if (!res.ok || !res.body) return `${c.model}: HTTP ${res.status} ${(await res.text()).slice(0, 160)} (${limit})`;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  let first = 0;
  let sentence = 0;
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try {
        const piece = JSON.parse(line.slice(5)).choices?.[0]?.delta?.content;
        if (piece) {
          text += piece;
          first ||= performance.now() - t0;
          if (!sentence && /[.!?]\s/.test(text)) sentence = performance.now() - t0;
        }
      } catch {
        /* keep-alive */
      }
    }
  }
  const total = performance.now() - t0;
  return `${c.provider}/${c.model}: first word ${Math.round(first)} ms, first sentence ${Math.round(sentence || total)} ms, whole ${Math.round(total)} ms (${limit}) — "${text.trim().slice(0, 70)}"`;
}

console.info('## Time to first words (median of 3)');
for (const c of candidates) {
  const runs: string[] = [];
  for (let i = 0; i < 3; i++) runs.push(await measure(c));
  for (const r of runs) console.info(`- ${r}`);
}

// Whisper on a 4-second clip of silence-and-tone (timing only).
if (groq) {
  const rate = 16000;
  const n = rate * 4;
  const wav = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, s: string) => [...s].forEach((ch, i) => wav.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); w(36, 'data'); wav.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 3000), true);
  for (const model of ['whisper-large-v3-turbo', 'whisper-large-v3']) {
    for (let i = 0; i < 2; i++) {
      const form = new FormData();
      form.set('model', model);
      form.set('file', new File([wav.buffer], 'turn.wav', { type: 'audio/wav' }));
      const t0 = performance.now();
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${groq}` }, body: form });
      console.info(`- ${model}: ${res.status} in ${Math.round(performance.now() - t0)} ms`);
    }
  }
}

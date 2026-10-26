/**
 * Lists the language models each configured provider offers this account right now, so fallback chains can be
 * built from names that exist. Run with the provider keys in the environment (the Models workflow does this).
 *   npx tsx scripts/list-models.ts
 */
type Lister = { name: string; key: string | undefined; url: string; pick: (body: unknown) => string[] };

const ids = (body: unknown): string[] => {
  const data = (body as { data?: Array<{ id?: string }> })?.data ?? (Array.isArray(body) ? (body as Array<{ id?: string }>) : []);
  return data.map((m) => m.id ?? '').filter(Boolean);
};

const providers: Lister[] = [
  { name: 'groq', key: process.env.GROQ_API_KEY, url: 'https://api.groq.com/openai/v1/models', pick: ids },
  { name: 'gemini', key: process.env.GEMINI_API_KEY, url: 'https://generativelanguage.googleapis.com/v1beta/openai/models', pick: ids },
  // Only OpenRouter's free models: they need no credit.
  { name: 'openrouter (free)', key: process.env.OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1/models', pick: (b) => ids(b).filter((id) => id.endsWith(':free')) },
];

// GitHub Models: list the catalog, then send one tiny request to prove the token can use it.
const gh = process.env.GITHUB_MODELS_TOKEN;
if (gh) {
  const headers = { authorization: `Bearer ${gh}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10', 'content-type': 'application/json' };
  try {
    const res = await fetch('https://models.github.ai/catalog/models', { headers, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    let list: string[] = [];
    try {
      list = ids(JSON.parse(text)).sort();
    } catch {
      console.info(`\n## github catalog: ${res.status} ${text.slice(0, 200)}`);
    }
    if (list.length) {
      console.info(`\n## github: ${list.length} models`);
      for (const id of list) console.info(`- ${id}`);
    }
  } catch (err) {
    console.info(`\n## github catalog: ${err instanceof Error ? err.message : String(err)}`);
  }
  const probes = [
    ['https://models.github.ai/inference', 'openai/gpt-4.1-mini'],
    ['https://models.github.ai/inference', 'deepseek/deepseek-v3-0324'],
    ['https://models.inference.ai.azure.com', 'gpt-4o-mini'],
    ['https://models.inference.ai.azure.com', 'gpt-4.1-mini'],
  ];
  for (const [base, model] of probes) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the word ready.' }], max_tokens: 10 }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      const limit = ['x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-limit-tokens'].map((h) => `${h}=${res.headers.get(h) ?? '-'}`).join(' ');
      console.info(`github probe ${base} ${model}: ${res.status} ${res.headers.get('content-type')} ${limit} ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
    } catch (err) {
      console.info(`github probe ${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

for (const p of providers) {
  if (!p.key) {
    console.info(`\n## ${p.name}: no key set`);
    continue;
  }
  try {
    const res = await fetch(p.url, { headers: { authorization: `Bearer ${p.key}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.info(`\n## ${p.name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const list = p.pick(await res.json()).sort();
    console.info(`\n## ${p.name}: ${list.length} models`);
    for (const id of list) console.info(`- ${id}`);
  } catch (err) {
    console.info(`\n## ${p.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

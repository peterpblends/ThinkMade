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

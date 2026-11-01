import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { textOf, type ChatMessage } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { runNextJob } from './index';
import { modelKey, rankForVariety } from './model-variety';
import { fakeResponder } from './testing/fake-responder';
import { makeWorld } from './testing/fixtures';

const c = (slug: string, name: string, score: number) => ({ slug, name, score });

describe('rankForVariety', () => {
  it('treats near-synonyms as one model', () => {
    expect(modelKey('Inversion Thinking')).toBe(modelKey('The Inversion Principle'));
    expect(modelKey("Hanlon's Razor")).toBe(modelKey('hanlons razor'));
    const out = rankForVariety([c('inversion', 'Inversion', 0.9), c('inversion-thinking', 'Inversion Thinking', 0.8), c('attachment-styles', 'Attachment Styles', 0.7)], { overused: [] });
    expect(out.map((m) => m.slug)).toEqual(['attachment-styles', 'inversion']);
  });

  it('puts topic-specific models ahead of generic and overused ones', () => {
    const out = rankForVariety(
      [
        c('first-principles', 'First Principles Thinking', 0.99),
        c('second-order-thinking', 'Second-Order Thinking', 0.97),
        c('attachment-styles', 'Attachment Styles', 0.9),
        c('love-languages', 'The Five Love Languages', 0.85),
        c('four-horsemen', 'The Four Horsemen', 0.8),
        c('bids-for-connection', 'Bids for Connection', 0.75),
      ],
      { overused: ['bids-for-connection'] },
    );
    expect(out.map((m) => m.slug)).toEqual(['attachment-styles', 'love-languages', 'four-horsemen', 'first-principles', 'second-order-thinking', 'bids-for-connection']);
  });

  it('keeps common models (as spares, or when nothing more specific was offered)', () => {
    const out = rankForVariety([c('inversion', 'Inversion', 0.9), c('opportunity-cost', 'Opportunity Cost', 0.8), c('incentives', 'Incentives', 0.7)], { overused: [] });
    expect(out.map((m) => m.slug)).toEqual(['inversion', 'opportunity-cost', 'incentives']);
  });

  it('never sets aside models the person asked to go deeper on', () => {
    const out = rankForVariety([c('inversion', 'Inversion', 0.9), c('opportunity-cost', 'Opportunity Cost', 0.8), c('grit', 'Grit', 0.5)], { overused: [], keep: new Set(['inversion', 'opportunity-cost']) });
    expect(out.map((m) => m.slug)).toEqual(['inversion', 'opportunity-cost', 'grit']);
  });
});

describe('choosing mental models for a series', () => {
  let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
  afterEach(async () => {
    await world?.handle.close();
    world = undefined;
  });

  it("draws on the topic's own books, sets aside the usual generic models, and drops models without a verified book", async () => {
    const seen: Record<string, unknown> = {};
    const DATING = [
      ['first-principles', 'First Principles Thinking', 0.99, 'Thinking in Bets', 'Annie Duke'],
      ['attachment-styles', 'Attachment Styles', 0.95, 'Attached', 'Amir Levine'],
      ['invented-model', 'An Unverifiable Model', 0.93, 'Totally Invented Title', 'Nobody Real'],
      ['love-languages', 'The Five Love Languages', 0.9, 'The 5 Love Languages', 'Gary Chapman'],
      ['four-horsemen', 'The Four Horsemen', 0.85, 'The Seven Principles for Making Marriage Work', 'John Gottman'],
      ['inversion', 'Inversion', 0.8, 'Poor Charlie’s Almanack', 'Charles T. Munger'],
    ] as const;
    world = await makeWorld((messages: ChatMessage[]) => {
      const stage = textOf(messages.find((m) => m.role === 'system')?.content ?? '').match(/^STAGE: (\w+)/)?.[1];
      const text = textOf(messages.find((m) => m.role === 'user')?.content ?? '');
      const input = JSON.parse(text.slice(text.indexOf('INPUT:') + 6)) as Record<string, unknown>;
      if (stage) seen[stage] = input;
      if (stage === 'select_models') {
        return JSON.stringify({ models: DATING.map(([slug, name, score, title, author]) => ({ slug, name, score, summary: `${name}, as its book teaches it.`, category: 'relationships', relevance: 'Fits dating as a teen.', sourceBook: { title, author } })) });
      }
      if (stage === 'research') {
        const models = input.models as Array<{ slug: string; sourceBook?: { title: string; author: string } }>;
        // Only the source book: the invented one fails verification, so that model has no book.
        return JSON.stringify({ models: models.map((m) => ({ slug: m.slug, books: m.sourceBook ? [{ title: m.sourceBook.title, author: m.sourceBook.author, why: 'Where the model comes from.' }] : [], related: [] })) });
      }
      return fakeResponder(messages);
    });
    const job = await world.enqueue('How should a Christian teen think about dating?', { episodes: 3 });
    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');

    // Asked for more candidates than episodes, with the person's own question.
    expect(seen.select_models).toMatchObject({ count: 9, question: 'How should a Christian teen think about dating?' });
    // Research is asked to confirm each model's source book.
    expect((seen.research as { models: Array<{ sourceBook?: unknown }> }).models[0]!.sourceBook).toBeTruthy();

    const primaries = await world.db
      .select({ slug: schema.mentalModel.slug })
      .from(schema.episodeMentalModel)
      .innerJoin(schema.mentalModel, eq(schema.mentalModel.id, schema.episodeMentalModel.mentalModelId))
      .where(eq(schema.episodeMentalModel.role, 'primary'));
    expect(primaries.map((p) => p.slug).sort()).toEqual(['attachment-styles', 'four-horsemen', 'love-languages']);
  });
});

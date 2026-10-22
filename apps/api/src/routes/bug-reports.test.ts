import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createTestContext } from '../test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('bug reports (not yet implemented)', () => {
  it('answers honestly with 501 instead of pretending to save', async () => {
    ctx = await createTestContext();
    const res = await createApp(ctx).request('/api/bug-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Something broke' }),
    });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'not_implemented', feature: 'bug_reports' });
  });
});

import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailable, unavailableResponse } from './unavailable';

describe('database outages', () => {
  it("recognises Neon's quota refusal and dropped connections, even wrapped", () => {
    expect(
      isDatabaseUnavailable(
        new Error(
          'Your account or project has exceeded the quota. Upgrade your plan to increase limits.',
        ),
      ),
    ).toBe(true);
    expect(
      isDatabaseUnavailable(
        new Error('query failed', { cause: new Error('Connection terminated unexpectedly') }),
      ),
    ).toBe(true);
    expect(
      isDatabaseUnavailable(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })),
    ).toBe(true);
  });

  it('leaves ordinary errors alone', () => {
    expect(isDatabaseUnavailable(new Error('duplicate key value violates unique constraint'))).toBe(
      false,
    );
    expect(isDatabaseUnavailable(undefined)).toBe(false);
  });

  it('answers 503 with a message the app can show', async () => {
    const res = unavailableResponse();
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('300');
    expect(await res.json()).toMatchObject({
      error: 'service_unavailable',
      message: expect.stringContaining('briefly unavailable'),
    });
  });
});

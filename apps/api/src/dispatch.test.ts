import { describe, expect, it } from 'vitest';
import { dispatchWorker } from './create-context';

describe('dispatchWorker', () => {
  it('asks GitHub to start a worker run, at most once a minute, and only when configured', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const env = { WORKER_DISPATCH_REPO: 'owner/repo', WORKER_DISPATCH_TOKEN: 'tok' };

    expect(await dispatchWorker({}, fetchFn, 1_000_000)).toBe(false);
    expect(await dispatchWorker(env, fetchFn, 2_000_000)).toBe(true);
    expect(await dispatchWorker(env, fetchFn, 2_030_000)).toBe(false); // throttled
    expect(await dispatchWorker(env, fetchFn, 2_061_000)).toBe(true);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://api.github.com/repos/owner/repo/dispatches');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ event_type: 'thinkmade-jobs' });
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer tok');
  });

  it('never throws when GitHub refuses', async () => {
    const refuse = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    expect(await dispatchWorker({ WORKER_DISPATCH_REPO: 'o/r', WORKER_DISPATCH_TOKEN: 't' }, refuse, 9_000_000)).toBe(false);
  });
});

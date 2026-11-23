import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageUnavailableError, type ImageGenerator } from '@thinkmade/ai';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function setup(images: ImageGenerator | null) {
  ctx = await createTestContext({ images });
  const app = createApp(ctx);
  const cookie = await signUpVerified(app, ctx, { email: 'pic@example.com' });
  const json = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
  return { app, json, cookie };
}

describe('coaching pictures', () => {
  it('draws a picture once, keeps it, and serves it only to signed-in listeners', async () => {
    const generate = vi.fn(async () => ({ bytes: PNG, mimeType: 'image/png' }));
    const { app, json, cookie } = await setup({ generate });
    const ask = () => app.request('/api/coach/images', { method: 'POST', headers: json, body: JSON.stringify({ prompt: 'Orders waiting at one small oven' }) });
    const first = (await (await ask()).json()) as { url: string };
    expect(first.url).toMatch(/^\/api\/coach\/images\/[a-f0-9]{40}$/);
    expect(((await (await ask()).json()) as { url: string }).url).toBe(first.url);
    expect(generate).toHaveBeenCalledTimes(1);
    const img = await app.request(first.url, { headers: { cookie } });
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await img.arrayBuffer())).toEqual(PNG);
    expect((await app.request(first.url)).status).toBe(401);
  });

  it('says pictures are unavailable when there is no image model or allowance', async () => {
    const none = await setup(null);
    const res = await none.app.request('/api/coach/images', { method: 'POST', headers: none.json, body: JSON.stringify({ prompt: 'A lighthouse in fog' }) });
    expect(res.status).toBe(503);
    await ctx!.close();
    const free = await setup({ generate: async () => Promise.reject(new ImageUnavailableError('limit 0')) });
    const r2 = await free.app.request('/api/coach/images', { method: 'POST', headers: free.json, body: JSON.stringify({ prompt: 'A lighthouse in fog' }) });
    expect(r2.status).toBe(503);
    expect(await r2.json()).toMatchObject({ error: 'image_unavailable' });
  });
});

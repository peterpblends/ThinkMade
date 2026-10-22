import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);

async function setup() {
  ctx = await createTestContext();
  const app = createApp(ctx);
  const cookie = await signUpVerified(app, ctx, { email: 'up@example.com' });
  const upload = (bytes: Buffer, type: string, name = 'photo.png', c = cookie) => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(bytes)], name, { type }));
    return app.request('/api/uploads', { method: 'POST', headers: { cookie: c, origin: ctx!.env.APP_URL }, body: form });
  };
  return { app, cookie, upload };
}

describe('uploads', () => {
  it('stores a real image privately with a retention date', async () => {
    const { upload } = await setup();
    const res = await upload(PNG, 'image/png');
    expect(res.status).toBe(201);
    const { id, kind } = (await res.json()) as { id: string; kind: string };
    expect(kind).toBe('image');
    const [row] = await ctx!.db.select().from(schema.mediaUpload).where(eq(schema.mediaUpload.id, id));
    expect(row).toMatchObject({ status: 'uploaded', contentType: 'image/png' });
    expect(row!.objectKey).toMatch(/^uploads\//);
    expect(row!.retentionExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
  });

  it('rejects a file whose contents are not an image or video, whatever it claims to be', async () => {
    const { upload } = await setup();
    const res = await upload(Buffer.from('<script>alert(1)</script>'.padEnd(64)), 'image/png', 'evil.png');
    expect(res.status).toBe(415);
  });

  it('rejects images over the admin size limit', async () => {
    const { upload } = await setup();
    await ctx!.settings.update({ media: { maxImageBytes: 100 } }, { id: (await ctx!.db.select().from(schema.user))[0]!.id });
    expect((await upload(PNG, 'image/png')).status).toBe(413);
  });

  it("refuses to attach someone else's upload to a podcast", async () => {
    const { app, upload } = await setup();
    const { id } = (await (await upload(PNG, 'image/png')).json()) as { id: string };
    const other = await signUpVerified(app, ctx!, { email: 'other@example.com' });
    const res = await app.request('/api/generations', {
      method: 'POST',
      headers: { cookie: other, 'content-type': 'application/json', origin: ctx!.env.APP_URL },
      body: JSON.stringify({ topic: 'Steal', mediaUploadIds: [id] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_media' });
  });

  it('lets a photo speak for itself when no text is given', async () => {
    const { app, upload, cookie } = await setup();
    const { id } = (await (await upload(PNG, 'image/png')).json()) as { id: string };
    const res = await app.request('/api/generations', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: ctx!.env.APP_URL },
      body: JSON.stringify({ topic: '', mediaUploadIds: [id] }),
    });
    expect(res.status).toBe(202);
  });

  it('enforces the per-request image limit', async () => {
    const { app, upload, cookie } = await setup();
    await ctx!.settings.update({ media: { maxImages: 1 } }, { id: (await ctx!.db.select().from(schema.user))[0]!.id });
    const a = ((await (await upload(PNG, 'image/png')).json()) as { id: string }).id;
    const b = ((await (await upload(PNG, 'image/png')).json()) as { id: string }).id;
    const res = await app.request('/api/generations', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: ctx!.env.APP_URL },
      body: JSON.stringify({ topic: 'Two photos', mediaUploadIds: [a, b] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'too_many_images' });
  });

  it('deletes an upload and its stored file for the owner only', async () => {
    const { app, upload, cookie } = await setup();
    const { id } = (await (await upload(PNG, 'image/png')).json()) as { id: string };
    const [row] = await ctx!.db.select().from(schema.mediaUpload).where(eq(schema.mediaUpload.id, id));
    const other = await signUpVerified(app, ctx!, { email: 'nope@example.com' });
    expect((await app.request(`/api/uploads/${id}`, { method: 'DELETE', headers: { cookie: other, origin: ctx!.env.APP_URL } })).status).toBe(404);
    expect((await app.request(`/api/uploads/${id}`, { method: 'DELETE', headers: { cookie, origin: ctx!.env.APP_URL } })).status).toBe(200);
    expect(await ctx!.storage.head(row!.objectKey)).toBeNull();
  });

  it('deleting the account removes stored uploads too', async () => {
    const { app, upload, cookie } = await setup();
    const { id } = (await (await upload(PNG, 'image/png')).json()) as { id: string };
    const [row] = await ctx!.db.select().from(schema.mediaUpload).where(eq(schema.mediaUpload.id, id));
    const res = await app.request('/api/auth/delete-user', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: ctx!.env.APP_URL },
      body: JSON.stringify({ password: 'correct-horse-battery' }),
    });
    expect(res.status).toBe(200);
    expect(await ctx!.storage.head(row!.objectKey)).toBeNull();
  });
});

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createContext } from './create-context';

const ctx = await createContext();
const app = createApp(ctx);
serve({ fetch: app.fetch, port: ctx.env.PORT }, (info) => {
  console.info(`[api] ThinkMade API on http://localhost:${info.port} (db: ${ctx.dbKind})`);
});

import { createDb, runMigrations, type Db } from '@thinkmade/db';
import { consoleEmailSender, memoryEmailSender, type EmailSender } from '@thinkmade/ai';
import { createAuth, type Auth } from './auth';
import { loadEnv, type Env } from './env';
import { createSettingsService, type SettingsService } from './settings/settings-service';

export interface AppContext {
  db: Db;
  dbKind: 'pg' | 'pglite';
  auth: Auth;
  env: Env;
  email: EmailSender;
  settings: SettingsService;
  now: () => Date;
}

export interface CreateContextOptions {
  env?: Env;
  email?: EmailSender;
  pgliteDir?: string;
  /**
   * Apply pending migrations at startup. Defaults to true. Serverless production sets this to false
   * and runs `npm run db:migrate` as a deploy step instead.
   */
  migrate?: boolean;
}

/** Builds the database, runs migrations and wires auth. One context per process or serverless instance. */
export async function createContext(
  options: CreateContextOptions = {},
): Promise<AppContext & { close(): Promise<void> }> {
  const env = options.env ?? loadEnv();
  const handle = await createDb({
    databaseUrl: env.DATABASE_URL,
    pgliteDir: options.pgliteDir ?? env.PGLITE_DIR,
  });
  if (options.migrate ?? true) await runMigrations(handle);
  const email = options.email ?? (env.NODE_ENV === 'test' ? memoryEmailSender() : consoleEmailSender());
  const auth = createAuth({ db: handle.db, env, email });
  const settings = createSettingsService(handle.db);
  await settings.seedDefaults();
  return {
    db: handle.db,
    dbKind: handle.kind,
    auth,
    env,
    email,
    settings,
    now: () => new Date(),
    close: () => handle.close(),
  };
}

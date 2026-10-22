import { createDb, runMigrations, type Db } from '@thinkmade/db';
import { consoleEmailSender, type EmailSender } from '@thinkmade/ai';
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
  await runMigrations(handle);
  const email = options.email ?? consoleEmailSender();
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

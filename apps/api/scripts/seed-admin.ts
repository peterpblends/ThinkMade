/**
 * Promote an account to administrator:
 *   npm run seed:admin -- you@example.com
 * Locally, stop `npm run dev` first: the embedded database allows one process at a time.
 * Against production, set DATABASE_URL to the Neon connection string.
 */
import { createDb } from '@thinkmade/db';
import { promoteToAdmin } from '../src/admin/promote';
import { loadEnv } from '../src/env';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run seed:admin -- you@example.com');
  process.exit(1);
}
const env = loadEnv();
const handle = await createDb({ databaseUrl: env.DATABASE_URL, pgliteDir: env.PGLITE_DIR });
try {
  await promoteToAdmin(handle.db, email);
  console.info(`[admin] ${email} is now an administrator. Turn on two-step verification in Settings to open the admin tools.`);
} catch (err) {
  console.error(`[admin] ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await handle.close();
}

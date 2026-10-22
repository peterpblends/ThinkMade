import { eq } from 'drizzle-orm';
import { schema, type Db } from '@thinkmade/db';

/**
 * Gives an existing, verified account the admin role. Used to bootstrap the first administrator
 * from the command line; later admins can be managed from the dashboard.
 * Admin routes still require two-step verification before they open.
 */
export async function promoteToAdmin(db: Db, email: string): Promise<void> {
  const [u] = await db
    .select({ id: schema.user.id, role: schema.user.role, emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.email, email.trim().toLowerCase()));
  if (!u) throw new Error(`No user with email ${email}. Sign up first.`);
  if (!u.emailVerified) throw new Error(`${email} is not verified yet. Click the link in the verification email first.`);
  const roles = new Set((u.role ?? 'user').split(',').map((r) => r.trim()).filter(Boolean));
  roles.delete('user'); // admin is a superset of user
  roles.add('admin');
  const role = [...roles].join(',');
  await db.update(schema.user).set({ role }).where(eq(schema.user.id, u.id));
  await db.insert(schema.auditLog).values({
    actorId: null,
    action: 'user.promote_admin',
    targetType: 'user',
    targetId: u.id,
    before: { role: u.role },
    after: { role },
    ip: 'cli',
  });
}

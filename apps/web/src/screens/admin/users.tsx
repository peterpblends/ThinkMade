import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authClient } from '../../lib/auth-client';
import { Button, Card, Notice, PageHeader } from '../../components/ui';
import { useState } from 'react';

interface AdminUser { id: string; email: string; name: string; role?: string | null; banned?: boolean | null; emailVerified: boolean; createdAt: string | Date }

export function AdminUsers() {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const { data, error } = await authClient.admin.listUsers({ query: { limit: 200, sortBy: 'createdAt', sortDirection: 'desc' } });
      if (error) throw new Error(error.message);
      return (data?.users ?? []) as AdminUser[];
    },
  });
  const act = async (fn: () => Promise<{ error: { message?: string | undefined } | null }>) => {
    setErr(null);
    const r = await fn();
    if (r.error) setErr(r.error.message ?? 'That change was not allowed.');
    await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="People" subtitle="Admins must turn on two-step verification before admin tools open for them." />
      {err && <Notice tone="error" role="alert">{err}</Notice>}
      <ul className="flex flex-col gap-2">
        {list.data?.map((u) => {
          const isAdmin = (u.role ?? '').split(',').includes('admin');
          return (
            <li key={u.id}>
              <Card className="flex flex-col gap-2">
                <p className="font-semibold">{u.name} <span className="font-normal text-muted">· {u.email}</span></p>
                <p className="text-xs text-muted">{isAdmin ? 'Admin' : 'Listener'}{u.banned ? ' · Suspended' : ''}{u.emailVerified ? '' : ' · Email not verified'}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void act(() => authClient.admin.setRole({ userId: u.id, role: isAdmin ? 'user' : 'admin' }))}>{isAdmin ? 'Remove admin' : 'Make admin'}</Button>
                  {u.banned ? (
                    <Button variant="ghost" onClick={() => void act(() => authClient.admin.unbanUser({ userId: u.id }))}>Restore access</Button>
                  ) : (
                    <Button variant="danger" onClick={() => window.confirm(`Suspend ${u.email}? They will be signed out.`) && void act(() => authClient.admin.banUser({ userId: u.id, banReason: 'Suspended by an administrator' }))}>Suspend</Button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

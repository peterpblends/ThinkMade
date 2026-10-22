import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Button, Card, PageHeader } from '../../components/ui';

export function AdminPublic() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'public'], queryFn: () => api<{ series: Array<{ id: string; title: string; publicSlug: string; owner: string; createdAt: string }> }>('/api/admin/public') });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Public content" subtitle="Everything currently shared publicly. Unpublishing makes a series private again and is recorded in the audit log." />
      {q.data?.series.length === 0 && <p className="text-muted">Nothing is public.</p>}
      <ul className="flex flex-col gap-2">
        {q.data?.series.map((s) => (
          <li key={s.id}>
            <Card className="flex flex-col gap-2">
              <Link to={`/p/${s.publicSlug}`} className="font-semibold underline-offset-4 hover:underline">{s.title}</Link>
              <p className="text-xs text-muted">{s.owner} · {new Date(s.createdAt).toLocaleDateString()}</p>
              <Button
                variant="danger"
                onClick={async () => {
                  const reason = window.prompt('Why are you unpublishing this series?');
                  if (!reason || reason.trim().length < 3) return;
                  await api(`/api/admin/public/${s.id}/unpublish`, { method: 'POST', body: JSON.stringify({ reason }) });
                  await qc.invalidateQueries({ queryKey: ['admin', 'public'] });
                }}
              >
                Unpublish
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

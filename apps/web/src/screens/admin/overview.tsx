import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Card, PageHeader } from '../../components/ui';

interface Usage {
  users: { total: number; activeLast7Days: number; newLast30Days: number };
  generations: { last30Days: Record<string, number>; failedLast30Days: number; averageProcessingSeconds: number | null };
  episodes: { ready: number; minutesOfAudio: number; heldForReview: number };
  storage: { audioBytes: number; uploadBytes: number; databaseBytes: number | null };
  tokens: { last24Hours: number; last30Days: number };
  speech: { secondsLast30Days: number };
  emails: { sentLast30Days: number; failedLast30Days: number };
  quality: { firstPassRate: number; averageReviews: number };
  models: Array<{ stage: string; provider: string; model: string }>;
  bandwidth: { measured: boolean; note: string };
  costs: { estimatedMonthlyUsd: number };
  alerts: Array<{ key: string; label: string; used: number; limit: number; percent: number; level: 'ok' | 'warning' | 'over' }>;
}

const mb = (b: number | null) => (b === null ? 'n/a' : `${(b / 1048576).toFixed(1)} MB`);

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function AdminOverview() {
  const q = useQuery({ queryKey: ['admin', 'usage'], queryFn: () => api<Usage>('/api/admin/usage'), refetchInterval: 60_000 });
  if (!q.data) return <p role="status" className="text-muted">Loading…</p>;
  const u = q.data;
  const g = u.generations.last30Days;
  const requests = Object.values(g).reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Overview" subtitle="Last 30 days unless stated." />
      {u.alerts.some((a) => a.level !== 'ok') && (
        <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-danger/40 bg-surface p-4">
          {u.alerts.filter((a) => a.level !== 'ok').map((a) => (
            <p key={a.key} className="text-danger">
              <strong>{a.level === 'over' ? 'Over limit' : 'Approaching limit'}:</strong> {a.label} at {a.percent}% ({a.used.toLocaleString()} of {a.limit.toLocaleString()}).
            </p>
          ))}
        </div>
      )}
      <section className="grid grid-cols-2 gap-3">
        <Stat label="People" value={u.users.total} hint={`${u.users.activeLast7Days} active this week`} />
        <Stat label="Generation requests" value={requests} hint={`${g.succeeded ?? 0} finished · ${u.generations.failedLast30Days} failed`} />
        <Stat label="Episodes ready" value={u.episodes.ready} hint={`${u.episodes.minutesOfAudio} minutes of audio`} />
        <Stat label="Held for review" value={u.episodes.heldForReview} />
        <Stat label="Average build time" value={u.generations.averageProcessingSeconds ? `${Math.round(u.generations.averageProcessingSeconds / 60)} min` : 'n/a'} />
        <Stat label="First-review pass rate" value={`${Math.round(u.quality.firstPassRate * 100)}%`} hint={`${u.quality.averageReviews.toFixed(1)} reviews per episode`} />
        <Stat label="Language-model tokens" value={u.tokens.last30Days.toLocaleString()} hint={`${u.tokens.last24Hours.toLocaleString()} in 24 hours`} />
        <Stat label="Speech generated" value={`${Math.round(u.speech.secondsLast30Days / 60)} min`} />
        <Stat label="Audio storage" value={mb(u.storage.audioBytes)} hint={`Uploads ${mb(u.storage.uploadBytes)}`} />
        <Stat label="Database" value={mb(u.storage.databaseBytes)} />
        <Stat label="Emails" value={u.emails.sentLast30Days} hint={`${u.emails.failedLast30Days} failed`} />
        <Stat label="Estimated cost" value={`$${u.costs.estimatedMonthlyUsd.toFixed(2)}`} hint="Based on the prices in Defaults" />
      </section>
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg">Free-tier allowances</h2>
        <ul className="flex flex-col gap-3">
          {u.alerts.map((a) => (
            <li key={a.key}>
              <div className="flex justify-between text-sm"><span>{a.label}</span><span className="tabular-nums">{a.percent}%</span></div>
              <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden>
                <div className={`h-full rounded-full ${a.level === 'ok' ? 'bg-sage' : 'bg-danger'}`} style={{ width: `${Math.min(100, a.percent)}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{u.bandwidth.note}</p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg">Models in use</h2>
        <ul className="text-sm">
          {u.models.map((m) => <li key={m.stage}><span className="font-semibold">{m.stage}</span>: {m.provider} · {m.model}</li>)}
        </ul>
      </Card>
    </div>
  );
}

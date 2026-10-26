import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Button, Card, Notice, PageHeader } from '../../components/ui';

interface Person {
  id: string; name: string; email: string; requests: number; series: number; episodes: number; minutes: number;
  failed: number; partial: number; cancelled: number; ratings: number; averageStars: number | null; lastRequestAt: string | null;
}
interface Generated {
  id: string; userId: string; email: string; topic: string; seriesTitle: string | null; status: string; stage: string | null;
  episodesRequested: number | null; episodesReady: number; episodesRejected: number; tokens: number; createdAt: string; finishedAt: string | null;
}
interface ReportError { jobId: string; userId: string; email: string; seriesTitle: string | null; topic: string; status: string; stage: string | null; error: string; createdAt: string }
interface Rated { userId: string; email: string; episodeId: string; episodeTitle: string; seriesTitle: string; stars: number; ratedAt: string }
export interface Report {
  days: number;
  totals: { people: number; requests: number; episodes: number; errors: number; ratings: number; averageStars: number | null };
  people: Person[];
  generation: Generated[];
  errors: ReportError[];
  ratings: Rated[];
}

const PERIODS = [7, 30, 90, 365] as const;
const VIEWS = [
  ['people', 'By person'],
  ['generated', 'Generated'],
  ['errors', 'Errors'],
  ['ratings', 'Ratings'],
] as const;
type View = (typeof VIEWS)[number][0];

const STATUS: Record<string, { label: string; tone: string }> = {
  succeeded: { label: 'Finished', tone: 'border-sage/50 bg-sage-soft text-ink' },
  partial: { label: 'Partly finished', tone: 'border-danger/40 text-danger' },
  failed: { label: 'Failed', tone: 'border-danger/40 text-danger' },
  cancelled: { label: 'Cancelled', tone: 'border-line text-muted' },
  queued: { label: 'Waiting', tone: 'border-line text-muted' },
  running: { label: 'In progress', tone: 'border-accent-strong text-accent-ink' },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const stars = (n: number) => `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;

function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'border-line text-muted' };
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.tone}`}>{s.label}</span>;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string | undefined }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Statuses an administrator can restart: the podcast errored out. */
const RESTARTABLE = new Set(['failed', 'partial']);

/** Puts an errored podcast back in the queue; the worker resumes where it stopped and keeps finished episodes. */
function RestartButton({ jobId, title, onDone }: { jobId: string; title: string; onDone: (message: { tone: 'info' | 'error'; text: string }) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const restart = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/generations/${jobId}/restart`, { method: 'POST' });
      onDone({ tone: 'info', text: `Restarted “${title}”. It is back in the queue and picks up where it stopped.` });
      await qc.invalidateQueries({ queryKey: ['admin', 'report'] });
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string } | null) : null;
      onDone({ tone: 'error', text: body?.message ?? `Could not restart “${title}”. Please try again.` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" busy={busy} onClick={() => void restart()} className="min-h-10 self-start px-4 text-sm" aria-label={`Restart ${title}`}>
      Restart
    </Button>
  );
}

const empty = (text: string) => <p className="py-3 text-muted">{text}</p>;

/** Admin report: what each person generated, which runs went wrong and why, and how episodes were rated. */
export function AdminReport() {
  const [days, setDays] = useState<number>(30);
  const [who, setWho] = useState('');
  const [view, setView] = useState<View>('people');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const q = useQuery({ queryKey: ['admin', 'report', days], queryFn: () => api<Report>(`/api/admin/report?days=${days}`) });
  const r = q.data;
  const mine = <T extends { userId: string }>(rows: T[]) => (who ? rows.filter((x) => x.userId === who) : rows);
  const people = r ? (who ? r.people.filter((p) => p.id === who) : r.people.filter((p) => p.requests > 0 || p.ratings > 0)) : [];
  const counts: Record<View, number> = { people: people.length, generated: r ? mine(r.generation).length : 0, errors: r ? mine(r.errors).length : 0, ratings: r ? mine(r.ratings).length : 0 };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Activity report" subtitle="What each person generated, what went wrong, and what they rated. Podcasts that errored out can be restarted." />

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Period
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-[0.95rem]">
            {PERIODS.map((d) => <option key={d} value={d}>{d === 365 ? 'Last year' : `Last ${d} days`}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Person
          <select value={who} onChange={(e) => setWho(e.target.value)} className="min-h-11 min-w-0 rounded-xl border border-line bg-surface px-3 text-[0.95rem]">
            <option value="">Everyone</option>
            {r?.people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
          </select>
        </label>
      </div>

      {message && (
        <Notice tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </Notice>
      )}
      {q.isError && <p role="alert" className="text-danger">The report could not be loaded. Please try again.</p>}
      {!r && !q.isError && <p role="status" className="text-muted">Loading…</p>}

      {r && (
        <>
          {!who && (
            <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="People active" value={r.totals.people} />
              <Stat label="Requests" value={r.totals.requests} />
              <Stat label="Episodes made" value={r.totals.episodes} />
              <Stat label="Errors" value={r.totals.errors} />
              <Stat label="Ratings" value={r.totals.ratings} hint={r.totals.averageStars === null ? undefined : `Average ${r.totals.averageStars} ★`} />
            </section>
          )}

          <div role="group" aria-label="Report view" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VIEWS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={`min-h-11 rounded-full border px-3 text-sm font-semibold transition ${view === key ? 'border-accent-strong bg-accent-strong text-on-accent' : 'border-line bg-surface text-ink hover:bg-surface-2'}`}
              >
                {label} <span className="tabular-nums">({counts[key]})</span>
              </button>
            ))}
          </div>

          {view === 'people' && (
            <Card className="flex flex-col">
              <ul className="divide-y divide-line">
                {people.length === 0 && empty('Nobody generated or rated anything in this period.')}
                {people.map((p) => (
                  <li key={p.id} className="flex flex-col gap-1.5 py-3">
                    <button type="button" onClick={() => { setWho(p.id); setView('generated'); }} className="self-start text-left font-semibold text-accent-ink [overflow-wrap:anywhere] hover:underline">
                      {p.name || p.email} <span className="font-normal text-muted">· {p.email}</span>
                    </button>
                    <p className="text-sm tabular-nums">
                      {p.requests} request{p.requests === 1 ? '' : 's'} · {p.series} series · {p.episodes} episode{p.episodes === 1 ? '' : 's'} ({p.minutes} min)
                    </p>
                    <p className="text-sm tabular-nums text-muted">
                      {p.failed} failed · {p.partial} partly finished · {p.cancelled} cancelled · {p.ratings} rating{p.ratings === 1 ? '' : 's'}
                      {p.averageStars !== null && ` (avg ${p.averageStars} ★)`}
                    </p>
                    <p className="text-xs text-muted">Last request {when(p.lastRequestAt)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {view === 'generated' && (
            <Card className="flex flex-col">
              <ul className="divide-y divide-line">
                {mine(r.generation).length === 0 && empty('Nothing was generated in this period.')}
                {mine(r.generation).map((g) => (
                  <li key={g.id} className="flex flex-col gap-1.5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold [overflow-wrap:anywhere]">{g.seriesTitle ?? 'Not titled yet'}</p>
                      <Badge status={g.status} />
                    </div>
                    {g.topic && <p className="text-sm text-muted [overflow-wrap:anywhere]">“{g.topic}”</p>}
                    <p className="text-sm tabular-nums">
                      {g.episodesReady}{g.episodesRequested ? ` of ${g.episodesRequested}` : ''} episode{(g.episodesRequested ?? g.episodesReady) === 1 ? '' : 's'} ready
                      {g.episodesRejected > 0 && ` · ${g.episodesRejected} rejected`} · {g.tokens.toLocaleString()} tokens
                    </p>
                    <p className="text-xs text-muted [overflow-wrap:anywhere]">{g.email} · {when(g.createdAt)}</p>
                    {RESTARTABLE.has(g.status) && <RestartButton jobId={g.id} title={g.seriesTitle ?? (g.topic || 'Untitled request')} onDone={setMessage} />}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {view === 'errors' && (
            <Card className="flex flex-col">
              <ul className="divide-y divide-line">
                {mine(r.errors).length === 0 && empty('No errors in this period.')}
                {mine(r.errors).map((e) => (
                  <li key={e.jobId} className="flex flex-col gap-1.5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold [overflow-wrap:anywhere]">{e.seriesTitle ?? (e.topic || 'Untitled request')}</p>
                      <Badge status={e.status} />
                    </div>
                    <p className="rounded-xl border border-danger/30 bg-surface-2 px-3 py-2 text-sm text-danger [overflow-wrap:anywhere]">{e.error}</p>
                    <p className="text-xs text-muted [overflow-wrap:anywhere]">
                      {e.stage ? `Stopped at: ${e.stage.replace(/_/g, ' ')} · ` : ''}{e.email} · {when(e.createdAt)}
                    </p>
                    {RESTARTABLE.has(e.status) && <RestartButton jobId={e.jobId} title={e.seriesTitle ?? (e.topic || 'Untitled request')} onDone={setMessage} />}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {view === 'ratings' && (
            <Card className="flex flex-col">
              <ul className="divide-y divide-line">
                {mine(r.ratings).length === 0 && empty('No ratings in this period.')}
                {mine(r.ratings).map((x) => (
                  <li key={`${x.userId}-${x.episodeId}`} className="flex flex-col gap-1 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold [overflow-wrap:anywhere]">{x.episodeTitle}</p>
                      <span role="img" className="shrink-0 text-accent-ink" aria-label={`${x.stars} out of 5 stars`}>{stars(x.stars)}</span>
                    </div>
                    <p className="text-sm text-muted [overflow-wrap:anywhere]">{x.seriesTitle}</p>
                    <p className="text-xs text-muted [overflow-wrap:anywhere]">{x.email} · {when(x.ratedAt)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

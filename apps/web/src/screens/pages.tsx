import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useSession } from '../lib/auth-client';
import { formatDuration } from '../lib/format';
import type { SeriesListItem } from '../lib/types';
import { Compass, Library as LibraryIcon } from 'lucide-react';
import { BRAND } from '@thinkmade/shared';
import { api, ApiError } from '../lib/api';
import { Button, Card, Notice, PageHeader } from '../components/ui';

export function DiscoverScreen() {
  return (
    <div>
      <PageHeader title="Discover" subtitle="Explore podcasts other people have chosen to share." />
      <label htmlFor="discover-search" className="sr-only">
        Search public podcasts
      </label>
      <input
        id="discover-search"
        type="search"
        disabled
        placeholder="Search by topic, mental model, book or author"
        className="min-h-12 w-full rounded-full border border-line bg-surface px-5 text-ink placeholder:text-muted disabled:opacity-60"
      />
      <div className="mt-10 flex flex-col items-center gap-3 text-center">
        <Compass aria-hidden size={40} className="text-sage" />
        <p className="max-w-sm text-muted">Public podcasts and search arrive in a later release. Nothing has been shared yet.</p>
      </div>
    </div>
  );
}

const LIBRARY_TABS = ['Continue Listening', 'My Podcasts', 'Downloads', 'Completed', 'Favorites'] as const;

interface GenerationListItem {
  id: string;
  status: string;
  label: string;
  topic: string | null;
  seriesId: string | null;
}

function SeriesRow({ s }: { s: SeriesListItem }) {
  return (
    <li>
      <Link to={`/series/${s.id}`} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4 shadow-card hover:bg-surface-2">
        <span className="font-serif text-lg font-semibold">{s.title}</span>
        <span className="text-sm text-muted">
          {s.readyCount} of {s.episodeCount} episodes ready{s.totalSeconds ? ` · ${formatDuration(s.totalSeconds)}` : ''}
          {s.visibility === 'public' ? ' · Public' : ''}
        </span>
      </Link>
    </li>
  );
}

export function LibraryScreen() {
  const { user } = useSession();
  const [tab, setTab] = useState<(typeof LIBRARY_TABS)[number]>('My Podcasts');
  const series = useQuery({ queryKey: ['series', 'mine'], queryFn: () => api<{ series: SeriesListItem[] }>('/api/series'), enabled: !!user });
  const gens = useQuery({
    queryKey: ['generations'],
    queryFn: () => api<{ generations: GenerationListItem[] }>('/api/generations'),
    enabled: !!user?.emailVerified,
    refetchInterval: 5000,
  });
  const active = (gens.data?.generations ?? []).filter((g) => g.status === 'queued' || g.status === 'running');
  if (!user) {
    return (
      <div>
        <PageHeader title="My Library" />
        <p className="text-muted">
          <Link className="font-semibold text-accent-ink underline" to="/sign-in?next=/library">Sign in</Link> to see your podcasts.
        </p>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="My Library" />
      <div role="tablist" aria-label="Library sections" className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {LIBRARY_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="min-h-11 shrink-0 rounded-full border border-line px-4 text-[0.95rem] aria-selected:border-accent-strong aria-selected:bg-accent-strong aria-selected:text-on-accent"
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab}>
        {active.length > 0 && (
          <section aria-labelledby="in-progress" className="mb-6">
            <h2 id="in-progress" className="mb-2 text-lg">In progress</h2>
            <ul className="flex flex-col gap-2">
              {active.map((g) => (
                <li key={g.id}>
                  <Link to={`/generations/${g.id}`} className="flex flex-col rounded-2xl border border-line bg-surface p-4 hover:bg-surface-2">
                    <span className="font-semibold">{g.topic}</span>
                    <span className="text-sm text-muted">{g.label}…</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {tab === 'My Podcasts' ? (
          series.data?.series.length ? (
            <ul className="flex flex-col gap-3">{series.data.series.map((s) => <SeriesRow key={s.id} s={s} />)}</ul>
          ) : (
            <div className="mt-10 flex flex-col items-center gap-3 text-center">
              <LibraryIcon aria-hidden size={40} className="text-sage" />
              <p className="max-w-sm text-muted">Nothing here yet. Your podcasts appear here as soon as you create them.</p>
              <Link to="/" className="font-semibold text-accent-ink underline">Create your first series</Link>
            </div>
          )
        ) : (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <LibraryIcon aria-hidden size={40} className="text-sage" />
            <p className="max-w-sm text-muted">{tab} arrives with the full player in the next release.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function HelpScreen() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Help" subtitle={BRAND.fullDescription} />
      <Card className="flex flex-col gap-2">
        <h2 className="text-xl">What is a mental model?</h2>
        <p>
          A mental model is a reusable way of thinking about a kind of problem. <em>Opportunity cost</em> helps with choices.{' '}
          <em>Bottlenecks</em> explain why work piles up. <em>Second-order thinking</em> asks what happens after the obvious result.
          ThinkMade picks the models that fit your question and teaches them through the best books written about them.
        </p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-xl">Thinking. Seeing. Doing.</h2>
        <p>
          Every episode helps you understand a way of thinking, notice when it applies, and put it into practice. These three parts are
          woven into the conversation rather than read out like a lecture.
        </p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-xl">Installing ThinkMade</h2>
        <p>
          <strong>iPhone and iPad:</strong> open ThinkMade in Safari, tap Share, then Add to Home Screen.
        </p>
        <p>
          <strong>Android and desktop Chrome or Edge:</strong> use Install ThinkMade in the account menu, or the install icon in the
          address bar.
        </p>
        <p>
          <strong>Removing it:</strong> on iPhone, press and hold the icon and choose Remove App. On Android, press and hold the icon and
          choose Uninstall. On desktop, open the installed app's menu and choose Uninstall. Your account and podcasts stay safe on our
          servers.
        </p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-xl">Listening offline</h2>
        <p>
          Offline listening arrives in a later release. Your device controls how much it lets apps store. It may clear downloads when space
          runs low, so ThinkMade will always check a download before calling it available.
        </p>
      </Card>
    </div>
  );
}

export function ReportBugScreen() {
  const [state, setState] = useState<'idle' | 'busy' | 'unavailable' | 'sent' | 'error'>('idle');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState('busy');
    try {
      await api('/api/bug-reports', {
        method: 'POST',
        body: JSON.stringify({ description: String(new FormData(e.currentTarget).get('description') ?? '') }),
      });
      setState('sent');
    } catch (err) {
      setState(err instanceof ApiError && err.status === 501 ? 'unavailable' : 'error');
    }
  };
  return (
    <div>
      <PageHeader title="Report a Bug" subtitle="Tell us what went wrong. We never collect passwords or your private podcasts with a report." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label htmlFor="bug-description" className="text-sm font-medium">
          What happened?
        </label>
        <textarea
          id="bug-description"
          name="description"
          required
          rows={6}
          maxLength={5000}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink focus:border-accent focus:outline-none"
        />
        <Button type="submit" block busy={state === 'busy'}>
          Send report
        </Button>
        {state === 'unavailable' && (
          <Notice role="alert">Bug reporting isn't connected yet, so this report was not sent. It arrives in a later release.</Notice>
        )}
        {state === 'sent' && <Notice>Thanks. Your report was received.</Notice>}
        {state === 'error' && (
          <Notice tone="error" role="alert">
            We couldn't send your report. Please try again.
          </Notice>
        )}
      </form>
    </div>
  );
}

export function NotFoundScreen() {
  return (
    <div>
      <PageHeader title="Page not found" subtitle="That page doesn't exist." />
    </div>
  );
}

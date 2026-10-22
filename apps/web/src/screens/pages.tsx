import { useState, type FormEvent } from 'react';
import { Compass } from 'lucide-react';
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
          Tap Download on any episode to listen without a connection. Your progress, favorites and ratings are saved on the device and sync
          when you are back online, or the next time you open ThinkMade. Your device controls how much apps can store and may clear downloads
          when space runs low, so ThinkMade checks every download before showing it as available. On iPhone, keep ThinkMade on your home
          screen and open it now and then; iOS does not sync apps in the background.
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

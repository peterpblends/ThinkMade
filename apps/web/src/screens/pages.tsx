import { useState, type FormEvent } from 'react';
import { BRAND } from '@thinkmade/shared';
import { collectDiagnostics, getRecentErrorIds } from '../lib/diagnostics';
import { Button, Card, Notice, PageHeader } from '../components/ui';

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
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  const [result, setResult] = useState<{ emailed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const diagnostics = collectDiagnostics(getRecentErrorIds());
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState('busy');
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set('diagnostics', JSON.stringify(diagnostics));
    const shot = form.get('screenshot');
    if (shot instanceof File && shot.size === 0) form.delete('screenshot');
    try {
      const res = await fetch('/api/bug-reports', { method: 'POST', body: form, credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as { emailed?: boolean; message?: string };
      if (!res.ok) {
        setError(body.message ?? 'We could not send your report. Please try again.');
        return setState('error');
      }
      setResult({ emailed: !!body.emailed });
      setState('sent');
    } catch {
      setError('You seem to be offline. Please try again when connected.');
      setState('error');
    }
  };
  if (state === 'sent') {
    return (
      <div>
        <PageHeader title="Thank you" />
        <Notice>
          Your report was saved{result?.emailed ? ' and our team has been notified' : ''}. We read every report.
        </Notice>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="Report a Bug" subtitle="Tell us what went wrong. Reports never include your password or your private podcasts." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label htmlFor="bug-description" className="text-sm font-medium">What happened?</label>
        <textarea id="bug-description" name="description" required minLength={3} rows={6} maxLength={5000} className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink focus:border-accent focus:outline-none" />
        <label htmlFor="bug-screenshot" className="text-sm font-medium">Screenshot (optional)</label>
        <input id="bug-screenshot" name="screenshot" type="file" accept="image/*" className="text-sm" />
        {/* Hidden from people; bots fill it in. */}
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <details className="rounded-xl border border-line p-3 text-sm">
          <summary className="cursor-pointer font-semibold">What else is sent</summary>
          <p className="mt-2 text-muted">To help us fix it, we include these details about your device:</p>
          <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-2 text-xs">{JSON.stringify(diagnostics, null, 2)}</pre>
        </details>
        <Button type="submit" block busy={state === 'busy'}>Send report</Button>
        {error && <Notice tone="error" role="alert">{error}</Notice>}
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

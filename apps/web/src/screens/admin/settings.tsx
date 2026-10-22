import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { ApiError } from '../../lib/api';
import { api } from '../../lib/api';
import { Button, Card, Field, Notice, PageHeader } from '../../components/ui';

interface AdminSettings {
  version: number;
  settings: {
    podcast: Record<string, string | number>;
    voices: { single: string; hostA: string; hostB: string; available: string[] };
    media: Record<string, number>;
    limits: Record<string, number>;
    bugReports: { email: string };
  };
}

interface VersionRow {
  version: number;
  createdAt: string;
  note: string | null;
  active: boolean;
}

const NUMBER_FIELDS: Array<[section: 'podcast' | 'media' | 'limits', key: string, label: string]> = [
  ['podcast', 'defaultLengthMinutes', 'Default episode length (minutes)'],
  ['podcast', 'defaultEpisodes', 'Default number of episodes'],
  ['podcast', 'maxEpisodeMinutes', 'Maximum episode length (minutes)'],
  ['podcast', 'maxEpisodesPerSeries', 'Maximum episodes per series'],
  ['media', 'maxImages', 'Images per request'],
  ['media', 'maxImageBytes', 'Maximum image size (bytes)'],
  ['media', 'maxVideoSeconds', 'Maximum video length (seconds)'],
  ['media', 'maxVideoBytes', 'Maximum video size (bytes)'],
  ['limits', 'generationConcurrency', 'Concurrent generations'],
  ['limits', 'perUserDailyJobs', 'Generations per user per day'],
  ['limits', 'maxTokensPerJob', 'Language model tokens per generation'],
  ['limits', 'maxAudioMinutesPerJob', 'Audio minutes per generation'],
];

const SELECTS: Array<[key: string, label: string, options: Array<[string, string]>]> = [
  ['speakerFormat', 'Speaker format', [['single', 'Single host'], ['two_hosts', 'Two hosts'], ['mixed', 'Mixed']]],
  ['learningMode', 'Learning mode', [['explore', 'Explore'], ['deepen', 'Deepen'], ['reinforce', 'Reinforce']]],
  ['visibility', 'Default privacy', [['private', 'Private'], ['public', 'Public']]],
  ['audioQuality', 'Audio quality', [['compact', 'Compact'], ['balanced', 'Balanced'], ['high', 'High']]],
];

export function AdminSettingsScreen() {
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<AdminSettings>('/api/admin/settings'), retry: false });
  const versions = useQuery({
    queryKey: ['admin', 'settings', 'versions'],
    queryFn: () => api<{ versions: VersionRow[] }>('/api/admin/settings/versions'),
    enabled: current.isSuccess,
  });
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (current.isError) {
    const err = current.error as ApiError;
    return (
      <div>
        <PageHeader title="Admin" />
        <Notice tone="error" role="alert">
          {err.code === 'two_factor_required' ? (
            <>
              Turn on two-step verification in <Link className="font-semibold underline" to="/settings">Settings</Link> to use admin tools.
            </>
          ) : (
            'You do not have access to admin tools.'
          )}
        </Notice>
      </div>
    );
  }
  if (!current.data) return <p role="status">Loading…</p>;
  const s = current.data.settings;

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(f.get(k));
    const patch = {
      podcast: {
        ...Object.fromEntries(NUMBER_FIELDS.filter(([sec]) => sec === 'podcast').map(([, k]) => [k, num(`podcast.${k}`)])),
        ...Object.fromEntries(SELECTS.map(([k]) => [k, String(f.get(`podcast.${k}`))])),
      },
      media: Object.fromEntries(NUMBER_FIELDS.filter(([sec]) => sec === 'media').map(([, k]) => [k, num(`media.${k}`)])),
      limits: Object.fromEntries(NUMBER_FIELDS.filter(([sec]) => sec === 'limits').map(([, k]) => [k, num(`limits.${k}`)])),
      voices: { single: String(f.get('voices.single')), hostA: String(f.get('voices.hostA')), hostB: String(f.get('voices.hostB')) },
      bugReports: { email: String(f.get('bugReports.email') ?? '').trim() },
    };
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<AdminSettings>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ patch, note: String(f.get('note') ?? '') || undefined }),
      });
      setMessage({ tone: 'info', text: `Saved as version ${res.version}.` });
      await qc.invalidateQueries({ queryKey: ['admin'] });
      await qc.invalidateQueries({ queryKey: ['settings', 'public'] });
    } catch (err) {
      const issues = (err as ApiError).body as { issues?: Array<{ message: string }> } | null;
      setMessage({ tone: 'error', text: issues?.issues?.map((i) => i.message).join(' ') || 'Could not save these settings.' });
    } finally {
      setBusy(false);
    }
  };

  const select = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-ink';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Podcast defaults" subtitle={`Version ${current.data.version}. Every change is saved as a new version you can roll back.`} />
      <form onSubmit={save} className="flex flex-col gap-5" key={current.data.version}>
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Creation defaults</h2>
          {NUMBER_FIELDS.filter(([sec]) => sec === 'podcast').map(([sec, k, label]) => (
            <Field key={k} label={label} name={`${sec}.${k}`} type="number" inputMode="numeric" defaultValue={s[sec][k]} min={1} required />
          ))}
          {SELECTS.map(([k, label, options]) => (
            <label key={k} className="flex flex-col gap-1.5 text-sm font-medium">
              {label}
              <select name={`podcast.${k}`} defaultValue={String(s.podcast[k])} className={select}>
                {options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Voices</h2>
          {(['single', 'hostA', 'hostB'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1.5 text-sm font-medium">
              {k === 'single' ? 'Single host' : k === 'hostA' ? 'First host' : 'Second host'}
              <select name={`voices.${k}`} defaultValue={s.voices[k]} className={select}>
                {s.voices.available.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Media and usage limits</h2>
          {NUMBER_FIELDS.filter(([sec]) => sec !== 'podcast').map(([sec, k, label]) => (
            <Field key={k} label={label} name={`${sec}.${k}`} type="number" inputMode="numeric" defaultValue={s[sec][k]} min={0} required />
          ))}
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Bug reports</h2>
          <Field label="Send bug reports to" name="bugReports.email" type="email" defaultValue={s.bugReports.email} hint="Leave empty to keep reports in the dashboard only." />
        </Card>
        <Field label="Change note (optional)" name="note" maxLength={500} />
        {message && (
          <Notice tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>
            {message.text}
          </Notice>
        )}
        <Button type="submit" block busy={busy}>
          Save as new version
        </Button>
      </form>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">History</h2>
        <ul className="flex flex-col divide-y divide-line">
          {versions.data?.versions.map((v) => (
            <li key={v.version} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-semibold">
                  Version {v.version} {v.active && <span className="ml-1 rounded-full bg-sage-soft px-2 py-0.5 text-xs text-sage-ink">Active</span>}
                </p>
                <p className="truncate text-sm text-muted">
                  {new Date(v.createdAt).toLocaleString()} {v.note ? `· ${v.note}` : ''}
                </p>
              </div>
              {!v.active && (
                <Button
                  variant="secondary"
                  className="min-h-11 px-4 text-sm"
                  onClick={async () => {
                    if (!window.confirm(`Restore version ${v.version}? This creates a new version.`)) return;
                    const res = await api<AdminSettings>('/api/admin/settings/rollback', { method: 'POST', body: JSON.stringify({ version: v.version }) });
                    setMessage({ tone: 'info', text: `Restored version ${v.version} as version ${res.version}.` });
                    await qc.invalidateQueries({ queryKey: ['admin'] });
                  }}
                >
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

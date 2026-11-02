import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { castableByDefault, DEFAULT_APP_SETTINGS, DEFAULT_FEATURES, DEFAULT_PRODUCTION, DEFAULT_SPLASH_SECONDS, FEATURE_INFO, FEATURE_KEYS, type FeatureKey, voiceInfo, voiceLabel, type ProductionSettings, type VoiceProfile } from '@thinkmade/shared';
import { api, ApiError } from '../../lib/api';
import { Button, Card, Field, Notice, PageHeader } from '../../components/ui';

interface AdminSettings {
  version: number;
  settings: {
    podcast: Record<string, string | number>;
    voices: { single: string; hostA: string; hostB: string; available: string[]; profiles?: Record<string, VoiceProfile> };
    media: Record<string, number>;
    limits: Record<string, number>;
    quality: Record<string, number>;
    production?: ProductionSettings;
    appearance?: { splashSeconds: number };
    features?: Partial<Record<FeatureKey, boolean>>;
    bugReports: { email: string };
  };
}

interface VersionRow {
  version: number;
  createdAt: string;
  note: string | null;
  active: boolean;
}

const NUMBER_FIELDS: Array<[section: 'podcast' | 'media' | 'limits' | 'quality', key: string, label: string]> = [
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
  ['quality', 'minScore', 'Minimum quality score to record (1–5)'],
  ['quality', 'maxRevisions', 'Script rewrites before holding for human review'],
];

const PRODUCTION_SELECTS: Array<[key: 'showFormat' | 'pacing' | 'expressiveness', label: string, options: Array<[string, string]>, hint: string]> = [
  ['showFormat', 'Show format', [['auto', 'Choose for each topic'], ['storytelling', 'Storytelling'], ['conversation', 'Conversation'], ['interview', 'Interview']], "Single-host episodes are always storytelling. A listener's own request comes first."],
  ['pacing', 'Pacing', [['relaxed', 'Relaxed'], ['natural', 'Natural'], ['brisk', 'Brisk']], 'Pauses between lines and speakers, and speaking speed.'],
  ['expressiveness', 'Voice expressiveness', [['steady', 'Steady'], ['natural', 'Natural'], ['expressive', 'Expressive']], 'How much delivery varies from line to line.'],
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
  const production = { ...DEFAULT_PRODUCTION, ...s.production };
  const castingVoices = s.voices.available.map(voiceInfo).filter((v): v is NonNullable<typeof v> => !!v);

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
      quality: Object.fromEntries(NUMBER_FIELDS.filter(([sec]) => sec === 'quality').map(([, k]) => [k, num(`quality.${k}`)])),
      voices: {
        single: String(f.get('voices.single')),
        hostA: String(f.get('voices.hostA')),
        hostB: String(f.get('voices.hostB')),
        // Only what differs from the defaults is stored.
        profiles: Object.fromEntries(
          castingVoices.flatMap((v) => {
            const age = String(f.get(`profile.${v.id}.age`) ?? '');
            const note = String(f.get(`profile.${v.id}.note`) ?? '').trim();
            const autoCast = f.get(`profile.${v.id}.autoCast`) === 'on';
            const p: VoiceProfile = {
              ...(age ? { age: age as NonNullable<VoiceProfile['age']> } : {}),
              ...(note ? { note } : {}),
              ...(autoCast !== castableByDefault(v) ? { autoCast } : {}),
            };
            return Object.keys(p).length ? [[v.id, p]] : [];
          }),
        ),
      },
      production: {
        ...Object.fromEntries(PRODUCTION_SELECTS.map(([k]) => [k, String(f.get(`production.${k}`))])),
        hostStyle: String(f.get('production.hostStyle') ?? '').trim(),
        allowSimulatedGuests: f.get('production.allowSimulatedGuests') === 'on',
        rotateGuests: f.get('production.rotateGuests') === 'on',
        roomTone: f.get('production.roomTone') === 'on',
      },
      appearance: { splashSeconds: num('appearance.splashSeconds') },
      features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, f.get(`features.${k}`) === 'on'])),
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
                {[...new Set([...DEFAULT_APP_SETTINGS.voices.available, ...s.voices.available])].map((v) => (
                  <option key={v} value={v}>
                    {voiceLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Production</h2>
          <p className="text-sm text-muted">How podcasts sound: the kind of show, the hosts' style and the delivery.</p>
          {PRODUCTION_SELECTS.map(([k, label, options, hint]) => (
            <label key={k} className="flex flex-col gap-1.5 text-sm font-medium">
              {label}
              <select name={`production.${k}`} defaultValue={production[k]} className={select}>
                {options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-muted">{hint}</span>
            </label>
          ))}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Host style
            <textarea name="production.hostStyle" defaultValue={production.hostStyle} maxLength={400} rows={2} placeholder="For example: warm and plain-spoken, with dry humour." className="rounded-xl border border-line bg-surface px-3 py-2 text-ink" />
            <span className="text-xs font-normal text-muted">Added to every host the listener didn't describe themselves.</span>
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input type="checkbox" name="production.allowSimulatedGuests" defaultChecked={production.allowSimulatedGuests} className="h-5 w-5" />
            Allow interviews with simulated expert guests (always introduced as simulated)
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input type="checkbox" name="production.rotateGuests" defaultChecked={production.rotateGuests} className="h-5 w-5" />
            In interview series, keep one host and bring a different guest, suited to the topic, each episode
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input type="checkbox" name="production.roomTone" defaultChecked={production.roomTone} className="h-5 w-5" />
            Quiet room tone under the audio, so pauses don't sound like dead air
          </label>
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Voice casting</h2>
          <p className="text-sm text-muted">
            Hosts are cast from these voices to fit their gender, age and the show's accent. Kokoro voices graded below C, and the whispered
            one, are left out unless you switch them on. After listening to a voice (Actions → Samples), tag how old it sounds so casting can
            match it to hosts&apos; ages.
          </p>
          <details className="group">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold text-accent-ink">Show all {castingVoices.length} voices</summary>
            <div className="mt-2 flex flex-col divide-y divide-line">
              {castingVoices.map((v) => {
                const p = s.voices.profiles?.[v.id] ?? {};
                return (
                  <div key={v.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold">{v.name}</span>{' '}
                      <span className="text-muted">
                        {v.accent} {v.gender} · {v.engine}
                        {v.grade ? ` · grade ${v.grade}` : ''}
                        {v.style ? ` · ${v.style}` : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`profile.${v.id}.age`}>{`${v.name} sounds`}</label>
                      <select id={`profile.${v.id}.age`} name={`profile.${v.id}.age`} defaultValue={p.age ?? ''} className="min-h-11 rounded-xl border border-line bg-surface px-2 text-sm">
                        <option value="">Age not tagged</option>
                        <option value="young">Sounds young</option>
                        <option value="adult">Sounds adult</option>
                        <option value="mature">Sounds mature</option>
                      </select>
                      <input name={`profile.${v.id}.note`} defaultValue={p.note ?? ''} maxLength={200} placeholder="Note" aria-label={`Note about ${v.name}`} className="min-h-11 w-32 rounded-xl border border-line bg-surface px-2 text-sm" />
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <input type="checkbox" name={`profile.${v.id}.autoCast`} defaultChecked={p.autoCast ?? castableByDefault(v)} className="h-5 w-5" />
                        Cast
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Media, usage and quality limits</h2>
          {NUMBER_FIELDS.filter(([sec]) => sec !== 'podcast').map(([sec, k, label]) => (
            <Field key={k} label={label} name={`${sec}.${k}`} type="number" inputMode="numeric" defaultValue={s[sec][k]} min={0} required />
          ))}
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Features</h2>
          <p className="text-sm text-muted">Switch features on or off for everyone. A feature that is off disappears from the app and the server refuses it.</p>
          {FEATURE_KEYS.map((k) => (
            <label key={k} className="flex items-start gap-3">
              <input type="checkbox" name={`features.${k}`} defaultChecked={{ ...DEFAULT_FEATURES, ...s.features }[k]} className="mt-1 h-5 w-5 shrink-0 accent-[var(--tm-accent-strong)]" />
              <span className="flex flex-col">
                <span className="font-medium">{FEATURE_INFO[k].label}</span>
                <span className="text-sm text-muted">{FEATURE_INFO[k].description}</span>
              </span>
            </label>
          ))}
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Opening splash</h2>
          <Field
            label="Splash duration (seconds)"
            name="appearance.splashSeconds"
            type="number"
            inputMode="decimal"
            step={0.1}
            min={0}
            max={10}
            defaultValue={s.appearance?.splashSeconds ?? DEFAULT_SPLASH_SECONDS}
            required
            hint={`How long the animated logo shows when the app opens, once per visit. The full animation takes about 2 seconds; 0 turns the splash off. Default ${DEFAULT_SPLASH_SECONDS}.`}
          />
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
                    try {
                      const res = await api<AdminSettings>('/api/admin/settings/rollback', {
                        method: 'POST',
                        body: JSON.stringify({ version: v.version }),
                      });
                      setMessage({ tone: 'info', text: `Restored version ${v.version} as version ${res.version}.` });
                    } catch (err) {
                      const code = err instanceof ApiError ? err.code : 'network_error';
                      setMessage({ tone: 'error', text: `Could not restore version ${v.version} (${code}).` });
                    } finally {
                      await qc.invalidateQueries({ queryKey: ['admin'] });
                    }
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

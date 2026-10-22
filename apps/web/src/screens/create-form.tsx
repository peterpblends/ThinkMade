import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Camera, Mic, SlidersHorizontal, Video } from 'lucide-react';
import type { PublicPodcastSettings } from '../lib/api';
import { Button } from '../components/ui';

export interface Customization {
  lengthMinutes: number;
  episodes: number;
  speakerFormat: 'single' | 'two_hosts' | 'mixed';
  learningMode: 'explore' | 'deepen' | 'reinforce';
}

export interface CreateRequest {
  topic: string;
  /** null when the user kept the administrator defaults. */
  customization: Customization | null;
}

const SPEAKERS = [
  { value: 'single', label: 'Single Host', hint: 'One natural teacher.' },
  { value: 'two_hosts', label: 'Two Hosts', hint: 'A real conversation between two hosts.' },
  { value: 'mixed', label: 'Mixed', hint: 'Episodes vary the format.' },
] as const;

const MODES = [
  { value: 'explore', label: 'Explore', hint: 'Meet new mental models.' },
  { value: 'deepen', label: 'Deepen', hint: 'Go further with models you know.' },
  { value: 'reinforce', label: 'Reinforce', hint: 'New books and examples for familiar models.' },
] as const;

function ChoiceGroup<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          return (
            <div key={String(o.value)}>
              <input
                type="radio"
                id={id}
                name={name}
                className="peer sr-only"
                checked={value === o.value}
                onChange={() => onChange(o.value)}
              />
              <label
                htmlFor={id}
                title={o.hint}
                className="flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-surface px-4 text-[0.95rem] text-ink transition peer-checked:border-accent-strong peer-checked:bg-accent-strong peer-checked:text-on-accent peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--tm-focus)]"
              >
                {o.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function MediaButton({ label, icon, describedBy }: { label: string; icon: ReactNode; describedBy: string }) {
  return (
    <button
      type="button"
      disabled
      aria-label={label}
      aria-describedby={describedBy}
      className="flex h-11 w-11 items-center justify-center rounded-full text-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      {icon}
    </button>
  );
}

/** The one thing ThinkMade asks: what would you like to think through? Customization stays optional. */
export function CreateForm({
  defaults,
  onCreate,
  initialTopic = '',
  busy = false,
}: {
  defaults: PublicPodcastSettings;
  onCreate: (request: CreateRequest) => void;
  initialTopic?: string;
  busy?: boolean;
}) {
  const [topic, setTopic] = useState(initialTopic);
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [touchedCustom, setTouchedCustom] = useState(false);
  const [custom, setCustom] = useState<Customization>({
    lengthMinutes: defaults.defaultLengthMinutes,
    episodes: defaults.defaultEpisodes,
    speakerFormat: defaults.speakerFormat,
    learningMode: defaults.learningMode,
  });
  const ids = { topic: useId(), soon: useId(), error: useId(), panel: useId() };

  const update = <K extends keyof Customization>(key: K, value: Customization[K]) => {
    setTouchedCustom(true);
    setCustom((c) => ({ ...c, [key]: value }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed) {
      setError("Tell us what you'd like to think through first.");
      return;
    }
    setError(null);
    onCreate({ topic: trimmed, customization: touchedCustom || customOpen ? custom : null });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <h1 className="text-[2rem] leading-tight text-ink sm:text-[2.25rem]">What would you like to think through today?</h1>

      <div className="rounded-[var(--radius-card)] border border-line bg-surface shadow-card focus-within:border-accent">
        <label htmlFor={ids.topic} className="sr-only">
          Your topic
        </label>
        <textarea
          id={ids.topic}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="A question, a decision, a problem at work… e.g. “Why do projects in my team always run late?”"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
          className="block w-full resize-none rounded-t-[var(--radius-card)] bg-transparent px-4 pb-2 pt-4 text-[1.05rem] leading-relaxed text-ink [overflow-wrap:anywhere] placeholder:text-muted focus:outline-none"
        />
        <div className="flex items-center gap-1 border-t border-line/70 px-2 py-1">
          <MediaButton label="Speak your topic" icon={<Mic aria-hidden size={22} />} describedBy={ids.soon} />
          <MediaButton label="Add a photo" icon={<Camera aria-hidden size={22} />} describedBy={ids.soon} />
          <MediaButton label="Add a video" icon={<Video aria-hidden size={22} />} describedBy={ids.soon} />
          <span id={ids.soon} className="ml-1 text-xs text-muted">
            Voice, photo and video input are coming soon.
          </span>
        </div>
      </div>

      {error && (
        <p id={ids.error} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button type="submit" block busy={busy} className="min-h-14 text-[1.05rem]">
        Create My Podcasts
      </Button>

      <div className="flex justify-center">
        <button
          type="button"
          aria-expanded={customOpen}
          aria-controls={ids.panel}
          onClick={() => setCustomOpen((o) => !o)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[0.95rem] font-semibold text-accent-ink hover:bg-surface-2"
        >
          <SlidersHorizontal aria-hidden size={18} />
          Customize
        </button>
      </div>

      {customOpen && (
        <div id={ids.panel} className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <ChoiceGroup
            legend="Episode length"
            name="length"
            options={defaults.lengthChoices.map((m) => ({ value: m, label: `${m} min` }))}
            value={custom.lengthMinutes}
            onChange={(v) => update('lengthMinutes', v)}
          />
          <ChoiceGroup
            legend="Number of episodes"
            name="episodes"
            options={defaults.episodeChoices.map((n) => ({ value: n, label: n === 1 ? '1 episode' : `${n} episodes` }))}
            value={custom.episodes}
            onChange={(v) => update('episodes', v)}
          />
          <ChoiceGroup legend="Hosts" name="speakers" options={SPEAKERS} value={custom.speakerFormat} onChange={(v) => update('speakerFormat', v)} />
          <ChoiceGroup legend="Learning mode" name="mode" options={MODES} value={custom.learningMode} onChange={(v) => update('learningMode', v)} />
        </div>
      )}
    </form>
  );
}

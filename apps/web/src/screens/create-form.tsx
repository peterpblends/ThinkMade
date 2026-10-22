import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Camera, Mic, Square, SlidersHorizontal, Video, X } from 'lucide-react';
import { useVoiceInput, type VoiceInput } from '../lib/voice';
import type { PublicPodcastSettings, PublicSettings } from '../lib/api';
import { Button } from '../components/ui';

export interface Customization {
  lengthMinutes: number;
  episodes: number;
  speakerFormat: 'single' | 'two_hosts' | 'mixed';
  learningMode: 'explore' | 'deepen' | 'reinforce';
}

export interface Attachment {
  id: string;
  file: File;
  kind: 'image' | 'video';
  previewUrl: string | null;
}

export interface CreateRequest {
  topic: string;
  /** null when the user kept the administrator defaults. */
  customization: Customization | null;
  attachments: Attachment[];
}

const FALLBACK_MEDIA: PublicSettings['media'] = { maxImages: 4, maxImageBytes: 10_485_760, maxVideoSeconds: 120, maxVideoBytes: 104_857_600 };

function preview(file: File): string | null {
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function mb(bytes: number) {
  return `${Math.round(bytes / 1048576)} MB`;
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

function FilePicker({ label, accept, icon, onFiles }: { label: string; accept: string; icon: ReactNode; onFiles: (files: File[]) => void }) {
  return (
    <label className="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-surface-2 focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--tm-focus)]">
      {icon}
      <span className="sr-only">{label}</span>
      <input
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </label>
  );
}

function VoiceControls({ voice, onFiles }: { voice: VoiceInput; onFiles: (files: File[], kind: 'image' | 'video') => void }) {
  const unsupportedId = useId();
  if (voice.state === 'recording') {
    return (
      <>
        <span role="status" className="flex items-center gap-2 px-2 text-sm font-semibold text-danger">
          <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" /> Recording…
        </span>
        <button type="button" onClick={voice.stop} aria-label="Stop recording" className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-strong text-on-accent">
          <Square aria-hidden size={18} />
        </button>
        <button type="button" onClick={voice.cancel} aria-label="Cancel recording" className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <X aria-hidden size={20} />
        </button>
      </>
    );
  }
  if (voice.state === 'transcribing') {
    return <span role="status" className="px-2 text-sm text-muted">Turning your words into text…</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={voice.start}
        disabled={!voice.supported}
        aria-label="Speak your topic"
        aria-describedby={voice.supported ? undefined : unsupportedId}
        className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-muted disabled:opacity-60"
      >
        <Mic aria-hidden size={22} />
      </button>
      {!voice.supported && (
        <span id={unsupportedId} className="sr-only">
          Voice input is not supported in this browser.
        </span>
      )}
      <FilePicker label="Add a photo" accept="image/*" icon={<Camera aria-hidden size={22} />} onFiles={(f) => onFiles(f, 'image')} />
      <FilePicker label="Add a video" accept="video/*" icon={<Video aria-hidden size={22} />} onFiles={(f) => onFiles(f, 'video')} />
      <span className="ml-1 text-xs text-muted">Type, speak, or show us.</span>
    </>
  );
}

/** The one thing ThinkMade asks: what would you like to think through? Customization stays optional. */
export function CreateForm({
  defaults,
  onCreate,
  initialTopic = '',
  busy = false,
  voice: voiceProp,
  media = FALLBACK_MEDIA,
  status,
}: {
  defaults: PublicPodcastSettings;
  media?: PublicSettings['media'];
  /** Progress text while attachments upload. */
  status?: string | null;
  onCreate: (request: CreateRequest) => void;
  initialTopic?: string;
  busy?: boolean;
  /** Injected in tests; the real hook is used otherwise. */
  voice?: VoiceInput;
}) {
  const ownVoice = useVoiceInput();
  const voice = voiceProp ?? ownVoice;
  const [topic, setTopic] = useState(initialTopic);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const addFiles = (files: File[], kind: 'image' | 'video') => {
    setMediaError(null);
    const accepted: Attachment[] = [];
    let images = attachments.filter((a) => a.kind === 'image').length;
    let videos = attachments.filter((a) => a.kind === 'video').length;
    for (const file of files) {
      const isVideo = kind === 'video' || file.type.startsWith('video/');
      if (isVideo) {
        if (file.size > media.maxVideoBytes) return setMediaError(`That video is larger than the ${mb(media.maxVideoBytes)} limit.`);
        if (videos >= 2) return setMediaError('You can add up to 2 videos.');
        videos++;
      } else {
        if (file.size > media.maxImageBytes) return setMediaError(`That photo is larger than the ${mb(media.maxImageBytes)} limit.`);
        if (images >= media.maxImages) return setMediaError(`You can add up to ${media.maxImages} photos.`);
        images++;
      }
      accepted.push({ id: crypto.randomUUID(), file, kind: isVideo ? 'video' : 'image', previewUrl: preview(file) });
    }
    setAttachments((a) => [...a, ...accepted]);
    // Check video length from its metadata where the browser can read it.
    for (const att of accepted.filter((x) => x.kind === 'video' && x.previewUrl)) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        if (v.duration > media.maxVideoSeconds + 1) {
          setAttachments((a) => a.filter((x) => x.id !== att.id));
          setMediaError(`Videos can be up to ${media.maxVideoSeconds} seconds long.`);
        }
      };
      v.src = att.previewUrl!;
    }
  };
  const removeAttachment = (id: string) => setAttachments((a) => a.filter((x) => x.id !== id));

  useEffect(() => {
    if (voice.transcript) setTopic((t) => (t.trim() ? `${t.trim()} ${voice.transcript}` : voice.transcript!));
  }, [voice.transcript]);
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [touchedCustom, setTouchedCustom] = useState(false);
  const [custom, setCustom] = useState<Customization>({
    lengthMinutes: defaults.defaultLengthMinutes,
    episodes: defaults.defaultEpisodes,
    speakerFormat: defaults.speakerFormat,
    learningMode: defaults.learningMode,
  });
  const ids = { topic: useId(), error: useId(), panel: useId() };

  const update = <K extends keyof Customization>(key: K, value: Customization[K]) => {
    setTouchedCustom(true);
    setCustom((c) => ({ ...c, [key]: value }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed && attachments.length === 0) {
      setError("Tell us what you'd like to think through first.");
      return;
    }
    setError(null);
    onCreate({ topic: trimmed, customization: touchedCustom || customOpen ? custom : null, attachments });
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
        <div className="flex min-h-12 flex-wrap items-center gap-1 border-t border-line/70 px-2 py-1">
          <VoiceControls voice={voice} onFiles={addFiles} />
        </div>
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-t border-line/70 p-3" aria-label="Attached photos and videos">
            {attachments.map((a) => (
              <li key={a.id} className="relative">
                {a.kind === 'image' && a.previewUrl ? (
                  <img src={a.previewUrl} alt={`Photo ${a.file.name}`} className="h-20 w-20 rounded-xl object-cover" />
                ) : (
                  <span role="img" aria-label={`${a.kind === 'video' ? 'Video' : 'Photo'} ${a.file.name}`} className="flex h-20 w-20 items-center justify-center rounded-xl bg-surface-2 text-muted">
                    {a.kind === 'video' ? <Video aria-hidden size={26} /> : <Camera aria-hidden size={26} />}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={`Remove ${a.file.name}`}
                  className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-card"
                >
                  <X aria-hidden size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {mediaError && (
        <p role="alert" className="text-sm text-danger">
          {mediaError}
        </p>
      )}
      {attachments.length > 0 && <p className="text-xs text-muted">Photos and videos stay private and are deleted automatically after a while.</p>}
      {status && (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      )}
      {voice.error && (
        <p role="alert" className="text-sm text-danger">
          {voice.error}
        </p>
      )}

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

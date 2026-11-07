import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Camera, MessageCircleQuestion, MessagesSquare, Mic, Play, Square, SlidersHorizontal, Video, X } from 'lucide-react';
import { useVoiceInput, type VoiceInput } from '../lib/voice';
import type { PublicPodcastSettings, PublicSettings, VoiceOption } from '../lib/api';
import { LANGUAGES, languageInfo, type LanguageCode } from '@thinkmade/shared';
import { Button } from '../components/ui';
import { PlannerPanel, type PlannerSettings } from '../components/planner';
import { CREATE_EXAMPLES, EXAMPLE_INTERVAL_MS } from './create-examples';

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
  /** Voices picked for the hosts, in order; left out for different voices each series. */
  voices?: string[];
  /** Female or male voices, when no exact voices were picked. */
  voiceGender?: VoiceGender;
  /** The podcast's language, when not English. */
  language?: LanguageCode;
}

const MAX_HOSTS = 4;
/** How voices are grouped in the picker: by accent (American, British, then American with another heritage's accent) and gender. */
const VOICE_GROUPS: ReadonlyArray<{ label: string; match: (v: VoiceOption) => boolean }> = [
  ...([['US', 'American'], ['UK', 'British']] as const).flatMap(([accent, name]) =>
    (['female', 'male'] as const).map((g) => ({ label: `${name}, ${g}`, match: (v: VoiceOption) => v.accent === accent && !v.heritage && v.gender === g })),
  ),
  ...([['latino', 'American, Latino accent'], ['south-asian', 'American, South Asian accent'], ['east-asian', 'American, East Asian accent']] as const).flatMap(([heritage, name]) =>
    (['female', 'male'] as const).map((g) => ({ label: `${name}, ${g}`, match: (v: VoiceOption) => v.heritage === heritage && v.gender === g })),
  ),
];

/**
 * Plays a voice's short sample. One sample plays at a time across the page; pressing again stops it.
 */
function useSamplePlayer() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const stop = () => {
    audio.current?.pause();
    setPlaying(null);
  };
  const toggle = (v: VoiceOption) => {
    if (playing === v.id) return stop();
    audio.current?.pause();
    if (!v.sampleUrl) return;
    const a = new Audio(v.sampleUrl);
    audio.current = a;
    a.onended = () => setPlaying((p) => (p === v.id ? null : p));
    setFailed(null);
    setPlaying(v.id);
    void Promise.resolve(a.play()).catch(() => {
      setPlaying((p) => (p === v.id ? null : p));
      setFailed(v.id);
    });
  };
  return { playing, failed, toggle, stop };
}

function SampleButton({ voice, player }: { voice: VoiceOption | undefined; player: ReturnType<typeof useSamplePlayer> }) {
  if (!voice?.sampleUrl) return <span className="flex h-11 w-11 shrink-0" aria-hidden />;
  const on = player.playing === voice.id;
  return (
    <button
      type="button"
      onClick={() => player.toggle(voice)}
      aria-label={on ? `Stop the sample of ${voice.name}` : `Play a sample of ${voice.name}`}
      aria-pressed={on}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition ${on ? 'border-accent-strong bg-accent-strong text-on-accent' : 'border-line bg-surface text-ink hover:bg-surface-2'}`}
    >
      {on ? <Square aria-hidden size={16} /> : <Play aria-hidden size={18} />}
    </button>
  );
}

export type VoiceGender = 'female' | 'male';

/**
 * Optional: the hosts' voices. By default every series gets its own voices; listeners can ask for female or
 * male voices, or pick a voice for each host (hearing a sample of each).
 */
function VoicePicker({
  voices,
  hostCount,
  value,
  onChange,
  gender,
  onGender,
  languageName,
}: {
  /** For a podcast in another language: its voices are grouped by gender under the language's name. */
  languageName?: string | undefined;
  voices: VoiceOption[];
  hostCount: number;
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  gender: VoiceGender | null;
  onGender: (g: VoiceGender | null) => void;
}) {
  const player = useSamplePlayer();
  const choosing = value !== null;
  const pick = (i: number, id: string) => {
    player.stop();
    onChange((value ?? []).map((v, j) => (j === i ? id : v)));
  };
  const has = (g: VoiceGender) => voices.some((v) => v.gender === g);
  const modes = [
    { key: 'auto', label: 'Any voices', on: !choosing && !gender, select: () => (onChange(null), onGender(null)) },
    ...(has('female') ? [{ key: 'female', label: 'Female', on: !choosing && gender === 'female', select: () => (onChange(null), onGender('female')) }] : []),
    ...(has('male') ? [{ key: 'male', label: 'Male', on: !choosing && gender === 'male', select: () => (onChange(null), onGender('male')) }] : []),
    {
      key: 'choose',
      label: 'Choose voices',
      on: choosing,
      // Start with distinct voices: of the gender asked for, or alternating female and male.
      select: () => {
        const start = gender ? voices.filter((v) => v.gender === gender) : [];
        onGender(null);
        onChange(Array.from({ length: hostCount }, (_, i) => (start[i] ?? voices.filter((v) => v.gender === (i % 2 ? 'male' : 'female'))[Math.floor(i / 2)] ?? voices[i] ?? voices[0]!).id));
      },
    },
  ];
  const hint = choosing
    ? voices.some((v) => v.sampleUrl)
      ? 'Press play to hear a voice before you choose it.'
      : 'Voice samples are being prepared.'
    : gender
      ? `Every host and guest will have a ${gender} voice, unless your request describes someone differently.`
      : 'Each series gets its own voices. Hosts you name in your request keep their names, with voices to match.';
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold text-ink">Voices</legend>
      <div className="flex flex-wrap gap-2">
        {modes.map((o) => (
          <div key={o.key}>
            <input type="radio" id={`voices-${o.key}`} name="voices" className="peer sr-only" checked={o.on} onChange={o.select} />
            <label
              htmlFor={`voices-${o.key}`}
              className="flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-surface px-4 text-[0.95rem] text-ink transition peer-checked:border-accent-strong peer-checked:bg-accent-strong peer-checked:text-on-accent peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--tm-focus)]"
            >
              {o.label}
            </label>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">{hint}</p>
      {choosing && (
        <div className="flex flex-col gap-3">
          {value.map((id, i) => (
            <div key={i} className="flex items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-ink">
                Host {i + 1}
                <select value={id} onChange={(e) => pick(i, e.target.value)} className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-[0.95rem] text-ink">
                  {(languageName
                    ? (['female', 'male'] as const).map((g) => ({ label: `${languageName}, ${g}`, match: (v: VoiceOption) => v.gender === g }))
                    : VOICE_GROUPS
                  ).filter((grp) => voices.some(grp.match)).map(({ label, match }) => (
                    <optgroup key={label} label={label}>
                      {voices
                        .filter(match)
                        .map((v) => (
                          <option key={v.id} value={v.id} disabled={v.id !== id && value.includes(v.id)}>
                            {v.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <SampleButton voice={voices.find((v) => v.id === id)} player={player} />
              {value.length > 1 && (
                <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove host ${i + 1}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2">
                  <X aria-hidden size={18} />
                </button>
              )}
            </div>
          ))}
          {player.failed && (
            <p role="alert" className="text-sm text-danger">
              That sample could not be played. Please try again.
            </p>
          )}
          {value.length < MAX_HOSTS && (
            <button
              type="button"
              onClick={() => onChange([...value, voices.find((v) => !value.includes(v.id))!.id])}
              className="self-start rounded-full px-3 py-2 text-[0.95rem] font-semibold text-accent-ink hover:bg-surface-2"
            >
              Add a host
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
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
  { value: 'mixed', label: 'Mixed', hint: 'Each podcast gets its own format: co-hosts, expert or founder guests, or a storyteller.' },
] as const;

/** Which voices have an accent the planner can ask for. */
const ACCENT_MATCH: Record<Exclude<NonNullable<PlannerSettings['voiceAccent']>, 'any'>, (v: VoiceOption) => boolean> = {
  american: (v) => v.accent === 'US' && !v.heritage,
  british: (v) => v.accent === 'UK',
  latino: (v) => v.heritage === 'latino',
  'south-asian': (v) => v.heritage === 'south-asian',
  'east-asian': (v) => v.heritage === 'east-asian',
};

const HOST_TAG: Record<Customization['speakerFormat'], string> = { single: '1', two_hosts: '2', mixed: 'Mixed' };

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

/** One setting at a glance: a quiet label and its value. Changed settings take the accent colour. */
function SettingTag({ label, value, changed, onClick }: { label: string; value: string; changed: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex min-h-9 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[0.85rem] transition hover:bg-surface-2 ${changed ? 'border-accent-strong bg-surface text-ink' : 'border-line bg-surface text-ink'}`}
      >
        {/* The spoken name is the visible text, plus "customized" for screen readers when it was changed. */}
        <span className="text-muted">{label}</span>{' '}
        <span className={`font-semibold ${changed ? 'text-accent-ink' : ''}`}>{value}</span>
        {changed && (
          <>
            {' '}
            <span className="sr-only">(customized)</span>
          </>
        )}
      </button>
    </li>
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

function VoiceControls({ voice, onFiles, allowVoice = true, allowMedia = true }: { voice: VoiceInput; onFiles: (files: File[], kind: 'image' | 'video') => void; allowVoice?: boolean; allowMedia?: boolean }) {
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
    return <span role="status" className="px-2 text-sm text-muted">{voice.onDevice ? 'Turning your words into text on this device…' : 'Turning your words into text…'}</span>;
  }
  const hint = allowVoice && allowMedia ? 'Type, speak, or show us.' : allowVoice ? 'Type or speak.' : allowMedia ? 'Type, or show us.' : null;
  return (
    <>
      {allowVoice && (
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
      )}
      {allowVoice && !voice.supported && (
        <span id={unsupportedId} className="sr-only">
          Voice input is not supported in this browser.
        </span>
      )}
      {allowMedia && (
        <>
          <FilePicker label="Add a photo" accept="image/*" icon={<Camera aria-hidden size={22} />} onFiles={(f) => onFiles(f, 'image')} />
          <FilePicker label="Add a video" accept="video/*" icon={<Video aria-hidden size={22} />} onFiles={(f) => onFiles(f, 'video')} />
        </>
      )}
      {hint && <span className="ml-1 text-xs text-muted">{hint}</span>}
    </>
  );
}

/** Cycles through example questions while `active`; holds the current one otherwise. */
export function useRotatingExample(active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((n) => (n + 1) % CREATE_EXAMPLES.length), EXAMPLE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [active]);
  return CREATE_EXAMPLES[i]!;
}

/** The one thing ThinkMade asks: what would you like to think through? Customization stays optional. */
export function CreateForm({
  defaults,
  onCreate,
  initialTopic = '',
  busy = false,
  voice: voiceProp,
  media = FALLBACK_MEDIA,
  voices: voiceOptions = [],
  status,
  features,
}: {
  /** Features an administrator switched on; all on when left out. */
  features?: Partial<Record<'voiceInput' | 'mediaUploads' | 'languages' | 'planner' | 'voiceCoaching' | 'coach', boolean>>;
  defaults: PublicPodcastSettings;
  media?: PublicSettings['media'];
  /** Voices listeners may pick; the picker is hidden without them. */
  voices?: VoiceOption[];
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
  const [chosenVoices, setChosenVoices] = useState<string[] | null>(null);
  const [voiceGender, setVoiceGender] = useState<VoiceGender | null>(null);
  const [language, setLanguage] = useState<LanguageCode>('en');
  // Languages with voices to speak them (other languages only while the administrator has them switched on).
  const languageChoices = LANGUAGES.filter((l) => l.code === 'en' || (features?.languages !== false && voiceOptions.some((v) => v.speaks?.includes(l.code))));
  // The voices that speak the chosen language, each with its sample in that language.
  const languageVoices = voiceOptions
    .filter((v) => (v.speaks ?? ['en']).includes(language))
    .map((v) => {
      const sampleUrl = v.sampleUrls?.[language] ?? (language === 'en' ? v.sampleUrl : undefined);
      const { sampleUrl: _s, ...rest } = v;
      return sampleUrl ? { ...rest, sampleUrl } : rest;
    });
  const ids = { topic: useId(), error: useId(), panel: useId(), hint: useId() };
  // Example questions rotate in the empty box, but never while someone is typing, focused or recording.
  const [focused, setFocused] = useState(false);
  const example = useRotatingExample(!topic && !focused && voice.state === 'idle');

  const update = <K extends keyof Customization>(key: K, value: Customization[K]) => {
    setTouchedCustom(true);
    setCustom((c) => ({ ...c, [key]: value }));
  };

  const [planning, setPlanning] = useState(false);
  /** Applies what the planner set up: the request in the listener's words, and the settings. */
  const applyPlan = (p: PlannerSettings) => {
    if (p.brief) setTopic(p.brief);
    const next = { ...custom };
    if (p.episodes) next.episodes = p.episodes;
    if (p.lengthMinutes) next.lengthMinutes = p.lengthMinutes;
    if (p.speakerFormat) next.speakerFormat = p.speakerFormat;
    if (p.learningMode) next.learningMode = p.learningMode;
    if (p.episodes || p.lengthMinutes || p.speakerFormat || p.learningMode) {
      setTouchedCustom(true);
      setCustom(next);
    }
    const lang = (p.language && languageChoices.some((l) => l.code === p.language) ? p.language : language) as LanguageCode;
    if (lang !== language) {
      setLanguage(lang);
      setChosenVoices(null);
    }
    const gender = p.voiceGender === 'any' ? null : (p.voiceGender ?? voiceGender);
    if (p.voiceGender) {
      setVoiceGender(gender);
      setChosenVoices(null);
    }
    if (p.voiceAccent === 'any') setChosenVoices(null);
    else if (p.voiceAccent) {
      // Voices with that accent (and gender, if asked for), one per host.
      const match = ACCENT_MATCH[p.voiceAccent];
      const pool = voiceOptions.filter((v) => (v.speaks ?? ['en']).includes(lang) && match(v));
      const hosts = next.speakerFormat === 'single' ? 1 : 2;
      // A female and a male voice in turn, unless a gender was asked for.
      const females = pool.filter((v) => v.gender === 'female');
      const males = pool.filter((v) => v.gender === 'male');
      const ordered = gender ? pool.filter((v) => v.gender === gender) : Array.from({ length: Math.max(females.length, males.length) }, (_, i) => [females[i], males[i]]).flat().filter((v): v is VoiceOption => !!v);
      if (ordered.length >= hosts) {
        setChosenVoices(ordered.slice(0, hosts).map((v) => v.id));
        setVoiceGender(null);
      }
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed && attachments.length === 0) {
      setError("Tell us what you'd like to think through first.");
      return;
    }
    setError(null);
    // Only choices the listener actually changed override what they wrote (for example "five episodes").
    onCreate({ topic: trimmed, customization: touchedCustom ? custom : null, attachments, ...(chosenVoices ? { voices: chosenVoices } : voiceGender ? { voiceGender } : {}), ...(language !== 'en' ? { language } : {}) });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-1 sm:gap-1.5">
        <h1 className="text-[1.6rem] leading-[1.15] text-ink sm:text-[2.25rem]">What would you like to think through?</h1>
        <p id={ids.hint} className="text-[0.95rem] leading-snug text-muted">
          A challenge you're facing, a decision you're making, or something you want to understand better.
        </p>
      </div>

      <div className="rounded-[var(--radius-card)] border border-line bg-surface shadow-card focus-within:border-accent">
        <label htmlFor={ids.topic} className="sr-only">
          Your topic
        </label>
        <textarea
          id={ids.topic}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={3}
          maxLength={2000}
          placeholder={example}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : ids.hint}
          className="block min-h-[5.5rem] w-full resize-none rounded-t-[var(--radius-card)] bg-transparent px-4 pb-2 pt-3.5 text-[1.05rem] sm:min-h-[7.5rem] leading-relaxed text-ink [overflow-wrap:anywhere] placeholder:text-muted focus:outline-none"
        />
        <div className="flex min-h-12 flex-wrap items-center gap-1 border-t border-line/70 px-2 py-1">
          <VoiceControls voice={voice} onFiles={addFiles} allowVoice={features?.voiceInput !== false} allowMedia={features?.mediaUploads !== false} />
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

      {features?.planner !== false &&
        (planning ? (
          <PlannerPanel
            current={{ topic, ...custom, ...(voiceGender ? { voiceGender } : {}), language }}
            onApply={applyPlan}
            onClose={() => setPlanning(false)}
            allowTalk={features?.voiceCoaching !== false}
            languageName={(c) => languageInfo(c).native}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlanning(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-full px-4 text-[0.95rem] font-semibold text-accent-ink hover:bg-surface-2"
          >
            <MessagesSquare aria-hidden size={18} /> Not sure how to put it? Plan it with me
          </button>
        ))}

      <Button type="submit" block busy={busy} className="min-h-14 text-[1.05rem]">
        Create My Podcasts
      </Button>

      <ul aria-label="Podcast settings" className="grid grid-cols-2 gap-2">
        {[
          { label: 'Episode Length', value: `${custom.lengthMinutes} min`, changed: custom.lengthMinutes !== defaults.defaultLengthMinutes },
          { label: 'Episodes', value: String(custom.episodes), changed: custom.episodes !== defaults.defaultEpisodes },
          {
            label: 'Hosts',
            value: chosenVoices ? String(chosenVoices.length) : `${HOST_TAG[custom.speakerFormat]}${voiceGender ? (voiceGender === 'female' ? ' · Female' : ' · Male') : ''}`,
            changed: custom.speakerFormat !== defaults.speakerFormat || chosenVoices !== null || voiceGender !== null,
          },
          { label: 'Learning Mode', value: MODES.find((o) => o.value === custom.learningMode)!.label, changed: custom.learningMode !== defaults.learningMode },
          // Only when a podcast is in another language.
          ...(language !== 'en' ? [{ label: 'Language', value: languageInfo(language).native, changed: true }] : []),
        ].map((t) => (
          <SettingTag key={t.label} {...t} onClick={() => setCustomOpen(true)} />
        ))}
      </ul>

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
          {languageChoices.length > 1 && (
            <ChoiceGroup
              legend="Language"
              name="language"
              options={languageChoices.map((l) => ({ value: l.code, label: l.native, hint: l.name }))}
              value={language}
              onChange={(v) => {
                setLanguage(v);
                // Voices picked for one language may not speak another.
                setChosenVoices(null);
              }}
            />
          )}
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
          {languageVoices.length > 1 && (
            <VoicePicker
              voices={languageVoices}
              hostCount={touchedCustom && custom.speakerFormat === 'single' ? 1 : 2}
              value={chosenVoices}
              onChange={setChosenVoices}
              gender={voiceGender}
              onGender={setVoiceGender}
              languageName={language === 'en' ? undefined : languageInfo(language).name}
            />
          )}
          <ChoiceGroup legend="Learning mode" name="mode" options={MODES} value={custom.learningMode} onChange={(v) => update('learningMode', v)} />
        </div>
      )}

      {features?.coach !== false && (
        <p className="mt-1 flex items-start justify-center gap-1.5 text-center text-[0.8rem] leading-snug text-muted">
          <MessageCircleQuestion aria-hidden size={15} className="mt-px shrink-0 text-accent-ink" />
          <span>
            Every episode comes with <span className="font-semibold text-ink">Coach Me</span>, an AI coach to question, role-play and practise the thinking with.
          </span>
        </p>
      )}
    </form>
  );
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AudioLines, Check, Send, Square, X } from 'lucide-react';
import { ApiError, streamApi } from '../lib/api';
import { createCoachSpeaker } from '../lib/coach-voice';
import { useVoiceConversation, type ConversationTurn } from '../lib/conversation';

/** What the planner can change on the Create form. */
export interface PlannerSettings {
  brief?: string;
  episodes?: number;
  lengthMinutes?: number;
  speakerFormat?: 'single' | 'two_hosts' | 'mixed';
  learningMode?: 'explore' | 'deepen' | 'reinforce';
  voiceGender?: 'female' | 'male' | 'any';
  voiceAccent?: 'american' | 'british' | 'latino' | 'south-asian' | 'east-asian' | 'any';
  language?: string;
  ready?: boolean;
}

/** The Create form as the planner sees it. */
export interface PlannerCurrent {
  topic: string;
  episodes: number;
  lengthMinutes: number;
  speakerFormat: 'single' | 'two_hosts' | 'mixed';
  learningMode: 'explore' | 'deepen' | 'reinforce';
  voiceGender?: 'female' | 'male' | 'any';
  language?: string;
}

type Message = { role: 'user' | 'assistant'; content: string; changes?: string[] };

const OPENING = "Tell me what you'd like to think through. I'll ask a couple of questions so the podcast fits exactly what you want, and set it up as we go.";
const SPEAKER_LABEL = { single: 'One host', two_hosts: 'Two hosts', mixed: 'Mixed hosts' } as const;
const MODE_LABEL = { explore: 'Explore', deepen: 'Deepen', reinforce: 'Reinforce' } as const;
const ACCENT_LABEL = { american: 'American', british: 'British', latino: 'Latino accent', 'south-asian': 'South Asian accent', 'east-asian': 'East Asian accent' } as const;

/** The planner's changes, in a few words each, for the note under its reply. */
export function describeChanges(s: PlannerSettings, languageName: (code: string) => string = (c) => c): string[] {
  const out: string[] = [];
  if (s.brief) out.push('Request updated');
  if (s.episodes) out.push(s.episodes === 1 ? '1 episode' : `${s.episodes} episodes`);
  if (s.lengthMinutes) out.push(`${s.lengthMinutes} min`);
  if (s.speakerFormat) out.push(SPEAKER_LABEL[s.speakerFormat]);
  if (s.voiceGender && s.voiceGender !== 'any') out.push(s.voiceGender === 'female' ? 'Female voices' : 'Male voices');
  if (s.voiceAccent && s.voiceAccent !== 'any') out.push(`${ACCENT_LABEL[s.voiceAccent]} voices`);
  if (s.learningMode) out.push(MODE_LABEL[s.learningMode]);
  if (s.language) out.push(languageName(s.language));
  return out;
}

const PHASE_LABEL = { listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…', error: '', off: '' } as const;

/**
 * Plan a podcast by conversation, typed or spoken hands-free: the planner asks clarifying questions, writes
 * the request in the listener's words, and changes the settings as they talk. The replies stream in.
 */
export function PlannerPanel({
  current,
  onApply,
  onClose,
  allowTalk,
  languageName,
}: {
  current: PlannerCurrent;
  onApply: (settings: PlannerSettings) => void;
  onClose: () => void;
  /** Hands-free talking is switched on. */
  allowTalk: boolean;
  languageName?: (code: string) => string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // The latest conversation and form, for requests started from speech.
  const latest = useRef({ messages, current });
  latest.current = { messages, current };
  const applyRef = useRef(onApply);
  applyRef.current = onApply;

  /** Sends what the listener said; returns the planner's reply once it has finished. */
  const ask = async (content: string, opts: { spoken?: boolean; signal?: AbortSignal; onText?: (soFar: string) => void } = {}) => {
    const history: Message[] = [...latest.current.messages, { role: 'user', content }];
    setMessages(history);
    setError(null);
    setBusy(true);
    setStreaming(null);
    try {
      const res = await streamApi<{ reply: string; settings: PlannerSettings }>(
        '/api/planner',
        { messages: history.map(({ role, content: c }) => ({ role, content: c })), current: latest.current.current, ...(opts.spoken ? { spoken: true } : {}) },
        (soFar) => {
          setStreaming(soFar.trim());
          opts.onText?.(soFar);
        },
        opts.signal,
      );
      applyRef.current(res.settings);
      if (res.settings.ready) setReady(true);
      setMessages([...history, { role: 'assistant', content: res.reply, changes: describeChanges(res.settings, languageName) }]);
      return res.reply;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const body = err instanceof ApiError ? (err.body as { message?: string } | null) : null;
      const message = body?.message ?? 'The planner could not answer just now. Please try again.';
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
      setStreaming(null);
    }
  };

  const talk = useVoiceConversation(
    (turn: ConversationTurn, signal: AbortSignal, onText: (soFar: string) => void) => ask(turn.text, { spoken: true, signal, onText }),
    createCoachSpeaker,
    'en-US',
  );
  const talking = talk.phase !== 'off' && talk.phase !== 'error';

  // Start from what they already wrote, if anything.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const topic = current.topic.trim();
    if (topic) void ask(topic).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages, streaming]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    void ask(q).catch(() => {});
  };

  return (
    <section aria-label="Plan with me" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Plan with me</h2>
        <button type="button" onClick={() => (talk.stop(), onClose())} aria-label="Close planning" className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <X aria-hidden size={18} />
        </button>
      </div>

      <div role="log" aria-live="polite" aria-label="Planning conversation" className="flex max-h-[22rem] flex-col gap-2.5 overflow-y-auto">
        <Bubble role="assistant">{OPENING}</Bubble>
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <Bubble role={m.role}>{m.content}</Bubble>
            {m.changes && m.changes.length > 0 && (
              <p className="flex items-start gap-1 pl-1 text-xs text-muted">
                <Check aria-hidden size={13} className="mt-0.5 shrink-0 text-sage-ink" />
                <span>{m.changes.join(' · ')}</span>
              </p>
            )}
          </div>
        ))}
        {busy && (streaming ? <Bubble role="assistant">{streaming}</Bubble> : <p role="status" className="text-sm text-muted">Thinking…</p>)}
        <div ref={endRef} />
      </div>

      {ready && !busy && <p className="rounded-xl bg-sage-soft px-3 py-2 text-sm font-medium text-sage-ink">Your podcast is set up. Press Create My Podcasts when you're ready, or keep talking to change anything.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {talk.error && <p role="alert" className="text-sm text-danger">{talk.error}</p>}

      {talking ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
          <p role="status" className="min-w-0 truncate text-sm">
            <span className="font-semibold">{PHASE_LABEL[talk.phase]}</span> {talk.phase === 'listening' && talk.caption ? <span className="text-muted">“{talk.caption}”</span> : null}
          </p>
          <button type="button" onClick={talk.stop} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-semibold">
            <Square aria-hidden size={14} /> End
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex items-end gap-2 rounded-xl border border-line bg-surface-2 p-1.5">
          <label htmlFor="planner-input" className="sr-only">
            Your answer
          </label>
          <textarea
            id="planner-input"
            rows={1}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
            placeholder={messages.length ? 'Reply…' : 'What would you like to think through?'}
            className="min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[1rem] text-ink placeholder:text-muted focus:outline-none"
          />
          {allowTalk && talk.supported && (
            <button type="button" onClick={talk.start} aria-label="Talk it through hands-free" className="flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-surface-2">
              <AudioLines aria-hidden size={20} />
            </button>
          )}
          <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-strong text-on-accent disabled:opacity-50">
            <Send aria-hidden size={17} />
          </button>
        </form>
      )}
    </section>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  return (
    <div className={role === 'user' ? 'max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent-strong px-3.5 py-2.5 text-on-accent' : 'max-w-[92%] self-start rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2.5'}>
      <span className="sr-only">{role === 'user' ? 'You: ' : 'Planner: '}</span>
      <p className="whitespace-pre-line text-[0.95rem] leading-relaxed">{children}</p>
    </div>
  );
}

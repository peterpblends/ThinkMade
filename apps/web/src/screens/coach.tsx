import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AudioLines, Mic, Send, Sparkles, Square, Volume2, VolumeX } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useVoiceConversation, type ConversationTurn, type VoiceConversation } from '../lib/conversation';
import { useFeatures } from '../lib/features';
import { useVoiceInput, type VoiceInput } from '../lib/voice';
import { Button, Notice } from '../components/ui';

interface CoachMessage {
  id: string;
  role: 'user' | 'coach';
  content: string;
}

const SPEAK_KEY = 'tm-coach-speak';

/** Reads text aloud with the device's own voice (free and private; nothing leaves the device). */
function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  window.speechSynthesis.speak(u);
}

const PHASE_LABEL = { listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…', error: 'Stopped', off: '' } as const;

/** The hands-free conversation: one tap to start, then just talk. */
function TalkPanel({ talk }: { talk: VoiceConversation }) {
  if (talk.phase === 'off' || talk.phase === 'error') {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card">
        <Button onClick={talk.start} className="self-start">
          <AudioLines aria-hidden size={20} /> Talk with your coach
        </Button>
        <p className="text-sm text-muted">Hands-free: just talk, and your coach talks back. Interrupt any time, or ask several things at once.</p>
        {talk.error && <p role="alert" className="text-sm text-danger">{talk.error}</p>}
      </div>
    );
  }
  const ring =
    talk.phase === 'listening' ? 'border-sage bg-sage-soft animate-pulse' : talk.phase === 'speaking' ? 'border-accent-strong bg-accent-strong/15' : 'border-line bg-surface-2';
  return (
    <section aria-label="Spoken conversation" className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 text-center shadow-card">
      <div aria-hidden className={`flex h-24 w-24 items-center justify-center rounded-full border-4 transition-colors ${ring}`}>
        {talk.phase === 'thinking' ? (
          <span className="flex gap-1.5">
            {[0, 150, 300].map((d) => (
              <span key={d} className="h-2.5 w-2.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d}ms` }} />
            ))}
          </span>
        ) : talk.phase === 'speaking' ? (
          <AudioLines size={36} className="text-accent-ink" />
        ) : (
          <Mic size={34} className="text-sage-ink" />
        )}
      </div>
      <p role="status" className="font-semibold">
        {PHASE_LABEL[talk.phase]}
      </p>
      <p aria-live="off" className="min-h-[3rem] max-w-prose text-[0.98rem] text-muted [overflow-wrap:anywhere]">
        {talk.phase === 'speaking' ? talk.coachLine : talk.caption ? `“${talk.caption}”` : talk.phase === 'listening' ? 'Go ahead, I’m listening.' : ''}
      </p>
      {talk.error && <p role="alert" className="text-sm text-danger">{talk.error}</p>}
      <Button variant="secondary" onClick={talk.stop}>
        <Square aria-hidden size={16} /> End conversation
      </Button>
    </section>
  );
}

export function CoachView({
  episodeTitle,
  messages,
  onSend,
  onCreatePodcast,
  sending,
  creating = false,
  error,
  voice,
  talk,
  allowVoiceInput = true,
}: {
  episodeTitle: string;
  messages: CoachMessage[];
  onSend: (text: string) => void;
  onCreatePodcast: () => void;
  sending: boolean;
  creating?: boolean;
  error?: string | null;
  voice: VoiceInput;
  /** The hands-free conversation, when switched on. */
  talk?: VoiceConversation | null;
  allowVoiceInput?: boolean;
}) {
  const talking = !!talk && talk.phase !== 'off' && talk.phase !== 'error';
  const [text, setText] = useState('');
  const [speakReplies, setSpeakReplies] = useState(() => {
    try {
      return localStorage.getItem(SPEAK_KEY) === '1';
    } catch {
      return false;
    }
  });
  const endRef = useRef<HTMLDivElement>(null);
  const lastSpoken = useRef<string | null>(null);

  useEffect(() => {
    if (voice.transcript) setText((t) => (t.trim() ? `${t.trim()} ${voice.transcript}` : voice.transcript!));
  }, [voice.transcript]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
    const last = messages.at(-1);
    // In a spoken conversation the coach already says its replies.
    if (speakReplies && !talking && last?.role === 'coach' && last.id !== lastSpoken.current) {
      lastSpoken.current = last.id;
      speak(last.content);
    }
  }, [messages, speakReplies, talking]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q || sending) return;
    onSend(q);
    setText('');
  };

  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-sm font-semibold text-muted">Coach Me</p>
        <h1 className="text-2xl">{episodeTitle}</h1>
        <p className="mt-1 text-[0.95rem] text-muted">Ask anything about this episode. Try: "How would this apply to my situation?" or "Give me a different example."</p>
      </header>

      {talk?.supported && <TalkPanel talk={talk} />}

      <div role="log" aria-live="polite" aria-label="Coaching conversation" className="flex flex-col gap-3">
        {messages.length === 0 && <p className="text-muted">Your conversation is private and saved with this episode, so you can come back to it.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'self-end max-w-[85%] rounded-2xl rounded-br-md bg-accent-strong px-4 py-3 text-on-accent' : 'self-start max-w-[90%] rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3 shadow-card'}>
            <span className="sr-only">{m.role === 'user' ? 'You: ' : 'Coach: '}</span>
            <p className="whitespace-pre-line text-[0.98rem] leading-relaxed">{m.content}</p>
          </div>
        ))}
        {sending && (
          <p role="status" className="self-start text-sm text-muted">
            The coach is thinking…
          </p>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}
      {voice.error && <p role="alert" className="text-sm text-danger">{voice.error}</p>}

      {!talking && <form onSubmit={submit} className="flex items-end gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-card">
        <label htmlFor="coach-q" className="sr-only">Your question</label>
        <textarea
          id="coach-q"
          rows={2}
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
          placeholder="Ask your coach…"
          className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-[1rem] text-ink placeholder:text-muted focus:outline-none"
        />
        {!allowVoiceInput ? null : voice.state === 'recording' ? (
          <button type="button" onClick={voice.stop} aria-label="Stop recording" className="flex h-11 w-11 items-center justify-center rounded-full bg-danger text-white">
            <Square aria-hidden size={18} />
          </button>
        ) : (
          <button type="button" onClick={voice.start} disabled={!voice.supported || voice.state === 'transcribing'} aria-label="Ask by voice" className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface-2 disabled:opacity-50">
            <Mic aria-hidden size={20} />
          </button>
        )}
        <button type="submit" disabled={sending || !text.trim()} aria-label="Send" className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-strong text-on-accent disabled:opacity-50">
          <Send aria-hidden size={18} />
        </button>
      </form>}

      <div className="flex flex-wrap items-center gap-2">
        {canSpeak && (
          <button
            type="button"
            aria-pressed={speakReplies}
            onClick={() => {
              const v = !speakReplies;
              setSpeakReplies(v);
              if (!v) window.speechSynthesis.cancel();
              try {
                localStorage.setItem(SPEAK_KEY, v ? '1' : '0');
              } catch {
                /* ignore */
              }
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold"
          >
            {speakReplies ? <Volume2 aria-hidden size={18} /> : <VolumeX aria-hidden size={18} />} Read answers aloud
          </button>
        )}
        {messages.some((m) => m.role === 'coach') && (
          <Button variant="secondary" onClick={onCreatePodcast} busy={creating}>
            <Sparkles aria-hidden size={18} /> Create a Podcast About This
          </Button>
        )}
      </div>
    </div>
  );
}

export function CoachScreen() {
  const { episodeId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const voice = useVoiceInput();
  const features = useFeatures();
  const [error, setError] = useState<string | null>(null);
  // Spoken turns go straight to the coach; the conversation log refreshes after each reply.
  const talk = useVoiceConversation(async (turn: ConversationTurn, signal: AbortSignal) => {
    try {
      const res = await api<{ reply: CoachMessage }>(`/api/coach/${episodeId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: turn.text, spoken: true, ...(turn.interruptedAfter ? { interruptedAfter: turn.interruptedAfter } : {}) }),
        signal,
      });
      void qc.invalidateQueries({ queryKey: ['coach', episodeId] });
      return res.reply.content;
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string } | null) : null;
      throw new Error(body?.message ?? 'The coach could not answer just now. Please try again.');
    }
  });
  const [optimistic, setOptimistic] = useState<CoachMessage | null>(null);
  const q = useQuery({
    queryKey: ['coach', episodeId],
    queryFn: () => api<{ session: { id: string } | null; episode: { id: string; title: string; seriesTitle: string }; messages: CoachMessage[] }>(`/api/coach/${episodeId}`),
  });
  const send = useMutation({
    mutationFn: (content: string) => api<{ message: CoachMessage; reply: CoachMessage }>(`/api/coach/${episodeId}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
    onMutate: (content) => {
      setError(null);
      setOptimistic({ id: 'pending', role: 'user', content });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach', episodeId] }),
    onError: (err) => {
      const body = err instanceof ApiError ? (err.body as { message?: string } | null) : null;
      setError(body?.message ?? 'You seem to be offline. Coaching needs a connection.');
    },
    onSettled: () => setOptimistic(null),
  });
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/api/generations', { method: 'POST', body: JSON.stringify({ topic: '', coachingSessionId: q.data?.session?.id }) }),
    onSuccess: ({ id }) => navigate(`/generations/${id}`),
    onError: (err) => {
      const body = err instanceof ApiError ? (err.body as { message?: string } | null) : null;
      setError(body?.message ?? 'We could not start a new podcast. Please try again.');
    },
  });

  if (q.isError) {
    const off = q.error instanceof ApiError && q.error.code === 'feature_off';
    return (
      <Notice tone="error" role="alert">
        {off ? 'Coach Me is turned off right now.' : navigator.onLine ? "This episode isn't available for coaching." : 'Coaching needs a connection.'}{' '}
        <Link className="underline" to="/library">Back to My Library</Link>
      </Notice>
    );
  }
  if (!q.data) return <p role="status" className="text-muted">Loading…</p>;
  const messages = optimistic ? [...q.data.messages, optimistic] : q.data.messages;
  return (
    <CoachView
      episodeTitle={q.data.episode.title}
      messages={messages}
      onSend={(t) => send.mutate(t)}
      onCreatePodcast={() => create.mutate()}
      sending={send.isPending}
      creating={create.isPending}
      error={error}
      voice={voice}
      talk={features.voiceCoaching ? talk : null}
      allowVoiceInput={features.voiceInput}
    />
  );
}

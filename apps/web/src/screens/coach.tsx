import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Mic, Send, Sparkles, Square, Volume2, VolumeX } from 'lucide-react';
import { api, ApiError } from '../lib/api';
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

export function CoachView({
  episodeTitle,
  messages,
  onSend,
  onCreatePodcast,
  sending,
  creating = false,
  error,
  voice,
}: {
  episodeTitle: string;
  messages: CoachMessage[];
  onSend: (text: string) => void;
  onCreatePodcast: () => void;
  sending: boolean;
  creating?: boolean;
  error?: string | null;
  voice: VoiceInput;
}) {
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
    if (speakReplies && last?.role === 'coach' && last.id !== lastSpoken.current) {
      lastSpoken.current = last.id;
      speak(last.content);
    }
  }, [messages, speakReplies]);

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

      <form onSubmit={submit} className="flex items-end gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-card">
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
        {voice.state === 'recording' ? (
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
      </form>

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
  const [error, setError] = useState<string | null>(null);
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
    return (
      <Notice tone="error" role="alert">
        {navigator.onLine ? "This episode isn't available for coaching." : 'Coaching needs a connection.'} <Link className="underline" to="/library">Back to My Library</Link>
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
    />
  );
}

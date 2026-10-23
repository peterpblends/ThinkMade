import { useCallback, useEffect, useRef, useState } from 'react';
import { canRecogniseOnDevice, decodeForSpeech, onDeviceSpeech, onDeviceSpeechEnabled } from './on-device-speech';

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error';

export interface VoiceInput {
  supported: boolean;
  state: VoiceState;
  error: string | null;
  /** Latest finished transcript, for the caller to place in an editable field. */
  transcript: string | null;
  /** The current transcription is happening on this device, not on the server. */
  onDevice: boolean;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}

const MAX_SECONDS = 90;

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return undefined;
}

/**
 * Records the microphone only after the user taps and grants permission, then transcribes on this
 * device (Moonshine, when the listener has turned it on in Settings and it has loaded) or on the
 * server. Falls back to the browser's own speech recognition when the server has no transcription service.
 */
export function useVoiceInput(): VoiceInput {
  const hasRecorder = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const Recognition = speechRecognitionCtor();
  const supported = hasRecorder || Recognition !== null;
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [onDevice, setOnDevice] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = () => {
    if (timer.current) clearTimeout(timer.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
  };
  useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      recognition.current?.abort();
      cleanup();
    },
    [],
  );

  const startBrowserRecognition = useCallback(() => {
    if (!Recognition) return false;
    const rec = new Recognition();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.continuous = true;
    let text = '';
    rec.onresult = (e) => {
      text = Array.from(e.results).map((r) => r[0]?.transcript ?? '').join(' ').trim();
    };
    rec.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : 'Speech recognition stopped unexpectedly.');
      setState('error');
    };
    rec.onend = () => {
      recognition.current = null;
      if (!cancelled.current && text) setTranscript(text);
      setState((s) => (s === 'error' ? s : 'idle'));
    };
    recognition.current = rec;
    rec.start();
    setState('recording');
    return true;
  }, [Recognition]);

  const start = useCallback(async () => {
    setError(null);
    setTranscript(null);
    cancelled.current = false;
    if (!hasRecorder) {
      if (!startBrowserRecognition()) setError('Voice input is not supported in this browser.');
      return;
    }
    const local = onDeviceSpeechEnabled() && canRecogniseOnDevice() ? onDeviceSpeech() : null;
    local?.prepare(); // loads while the listener speaks; if it isn't ready in time, the server transcribes this one
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone permission was denied. You can allow it in your browser settings, or type instead.');
      setState('error');
      return;
    }
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      cleanup();
      if (cancelled.current) {
        setState('idle');
        return;
      }
      const type = (rec.mimeType || mimeType || 'audio/webm').split(';')[0]!;
      if (local?.ready) {
        setOnDevice(true);
        setState('transcribing');
        try {
          const text = await local.transcribe(await decodeForSpeech(new Blob(chunks, { type })));
          if (cancelled.current) return;
          if (text) {
            setTranscript(text);
            setState('idle');
            return;
          }
        } catch {
          // Fall through to the server.
        } finally {
          setOnDevice(false);
        }
      }
      setState('transcribing');
      const form = new FormData();
      form.set('audio', new File(chunks, `voice.${type.includes('mp4') ? 'm4a' : type.split('/')[1]}`, { type }));
      try {
        const res = await fetch('/api/transcribe', { method: 'POST', body: form, credentials: 'same-origin' });
        const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string; message?: string };
        if (res.ok && body.text) {
          setTranscript(body.text);
          setState('idle');
        } else if (res.status === 503 && Recognition) {
          setError('Server transcription is unavailable, so this browser will listen instead. Tap the microphone and speak again.');
          setState('idle');
        } else {
          setError(body.message ?? (res.status === 401 || res.status === 403 ? 'Sign in and verify your email to use voice input.' : 'We could not transcribe that. Please try again or type.'));
          setState('error');
        }
      } catch {
        setError('You seem to be offline. Please type your question instead.');
        setState('error');
      }
    };
    recorder.current = rec;
    rec.start();
    setState('recording');
    timer.current = setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_SECONDS * 1000);
  }, [hasRecorder, Recognition, startBrowserRecognition]);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recognition.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recognition.current?.abort();
    setState('idle');
  }, []);

  return { supported, state, error, transcript, onDevice, start: () => void start(), stop, cancel };
}

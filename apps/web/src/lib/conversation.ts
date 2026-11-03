import { useCallback, useEffect, useRef, useState } from 'react';
import { createCoachSpeaker, sentences, type CoachSpeaker } from './coach-voice';

/**
 * A hands-free spoken conversation. After one tap to start (browsers need a tap before using the microphone
 * and speakers), it listens continuously: when the listener stops talking, their words go to the coach and the
 * reply is spoken as it streams in, sentence by sentence, so the coach starts talking within a moment, as a
 * person would. Talking over the coach stops it at once and starts the listener's next turn; speaking
 * again while the coach is thinking adds to the question instead. It keeps going until the listener ends it.
 */

export type ConversationPhase = 'off' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface ConversationTurn {
  text: string;
  /** What the coach had said of its last reply when the listener talked over it. */
  interruptedAfter?: string;
}

export interface VoiceConversation {
  /** This browser can listen continuously (Chrome, Edge, Safari). */
  supported: boolean;
  phase: ConversationPhase;
  /** What the listener is saying right now, as it is recognised. */
  caption: string;
  /** What the coach is saying right now. */
  coachLine: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

type Result = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<Result> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/**
 * Whether what the microphone heard is the coach's own voice coming back through the speaker: most of its
 * words are in what the coach is saying.
 */
export function isEcho(heard: string, coachText: string): boolean {
  const h = words(heard);
  if (!h.length) return true;
  const said = new Set(words(coachText));
  return h.filter((w) => said.has(w)).length / h.length >= 0.6;
}

/** How long a pause ends the listener's turn (ms): shorter after a finished phrase, longer mid-phrase. */
export const END_OF_TURN_MS = { final: 900, interim: 1500 } as const;
/** Words needed before talking over the coach counts as an interruption (not a cough or an "mm"). */
const BARGE_IN_WORDS = 2;

/** `lang` is the language the listener speaks (a BCP-47 tag such as "es-MX"), read when the conversation starts. */
export function useVoiceConversation(
  /** Sends a turn and resolves with the whole reply; `onText` (optional) reports the reply so far as it streams. */
  ask: (turn: ConversationTurn, signal: AbortSignal, onText: (soFar: string) => void) => Promise<string>,
  speakerFactory: (lang: string) => CoachSpeaker = createCoachSpeaker,
  lang = 'en-US',
): VoiceConversation {
  const langRef = useRef(lang);
  langRef.current = lang;
  const Recognition = recognitionCtor();
  const [phase, setPhaseState] = useState<ConversationPhase>('off');
  const [caption, setCaption] = useState('');
  const [coachLine, setCoachLine] = useState('');
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef<ConversationPhase>('off');
  const setPhase = (p: ConversationPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const askRef = useRef(ask);
  askRef.current = ask;
  const rec = useRef<Recognition | null>(null);
  const speaker = useRef<CoachSpeaker | null>(null);
  const active = useRef(false);
  // The listener's current turn: finished phrases (by result index) and the phrase still being recognised.
  const finals = useRef(new Map<number, string>());
  const interim = useRef('');
  const turnStart = useRef(0);
  const resultCount = useRef(0);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<AbortController | null>(null);
  const replyText = useRef('');
  const spokenSoFar = useRef('');
  const interruptedAfter = useRef<string | undefined>(undefined);
  // Text already sent while the coach was thinking, when the listener carried on speaking.
  const carried = useRef('');

  const turnText = () =>
    [carried.current, ...[...finals.current.entries()].filter(([i]) => i >= turnStart.current).sort(([a], [b]) => a - b).map(([, t]) => t), interim.current]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  const resetTurn = () => {
    turnStart.current = resultCount.current;
    interim.current = '';
    carried.current = '';
    setCaption('');
  };

  const clearEndTimer = () => {
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = null;
  };

  const sendTurn = useCallback(async () => {
    clearEndTimer();
    const text = turnText();
    if (!text || !active.current) return;
    const turn: ConversationTurn = { text, ...(interruptedAfter.current ? { interruptedAfter: interruptedAfter.current } : {}) };
    interruptedAfter.current = undefined;
    // Words recognised from here on belong to the next turn (or are added to this one, see onSpeech).
    turnStart.current = resultCount.current;
    interim.current = '';
    carried.current = text;
    setPhase('thinking');
    const controller = new AbortController();
    pending.current = controller;
    const live = () => !controller.signal.aborted && active.current;

    // Speak each sentence as soon as it has streamed in, one after another.
    const queue: string[] = [];
    let queuedSentences = 0;
    let said = '';
    let speaking = false;
    let streamDone = false;
    const finish = () => {
      if (!live() || speaking || queue.length || !streamDone) return;
      pending.current = null;
      // What the microphone picked up while the coach spoke (its own voice, an "mm") isn't the next question.
      resetTurn();
      setCoachLine('');
      setPhase('listening');
    };
    const pump = async () => {
      if (speaking) return;
      speaking = true;
      while (queue.length && live()) {
        const line = queue.shift()!;
        if (phaseRef.current === 'thinking') {
          // The coach starts talking: the listener's question is done.
          carried.current = '';
          resetTurn();
          spokenSoFar.current = '';
          setPhase('speaking');
        }
        if (phaseRef.current !== 'speaking') break;
        setCoachLine(line);
        await speaker.current!.speak(line, (p) => (spokenSoFar.current = `${said} ${p}`.trim()));
        said = `${said} ${line}`.trim();
      }
      speaking = false;
      finish();
    };
    const onText = (soFar: string) => {
      if (!live()) return;
      replyText.current = soFar;
      // Only finished sentences are spoken while the reply is still coming; the last one waits for the end.
      const done = sentences(soFar);
      const complete = /[.!?]["')\]]*\s*$/.test(soFar) ? done : done.slice(0, -1);
      while (queuedSentences < complete.length) queue.push(complete[queuedSentences++]!);
      void pump();
    };

    let reply: string;
    try {
      reply = await askRef.current(turn, controller.signal, onText);
    } catch (err) {
      if (!live()) return;
      if (queuedSentences > 0) {
        // It broke off mid-reply: finish saying what arrived.
        streamDone = true;
        finish();
        return;
      }
      setError(err instanceof Error && err.message ? err.message : 'The coach could not answer just now.');
      pending.current = null;
      carried.current = '';
      setPhase('listening');
      return;
    }
    if (!live()) return;
    replyText.current = reply;
    const all = sentences(reply);
    while (queuedSentences < all.length) queue.push(all[queuedSentences++]!);
    streamDone = true;
    if (!all.length) {
      finish();
      return;
    }
    void pump();
  }, []);

  /** Called whenever recognition hears something. */
  const onSpeech = useCallback(() => {
    const text = turnText();
    const fresh = [...finals.current.entries()].filter(([i]) => i >= turnStart.current).map(([, t]) => t).join(' ') + ' ' + interim.current;
    if (phaseRef.current === 'speaking') {
      // Talking over the coach: stop it and start the listener's turn, unless it's the coach's own voice.
      if (words(fresh).length < BARGE_IN_WORDS || isEcho(fresh, replyText.current)) return;
      interruptedAfter.current = spokenSoFar.current || replyText.current.slice(0, 80);
      // Stop talking, and stop the rest of the reply that is still streaming in.
      pending.current?.abort();
      pending.current = null;
      speaker.current?.stop();
      setCoachLine('');
      setPhase('listening');
    } else if (phaseRef.current === 'thinking') {
      // Still talking: hold the question, keep listening, and send it all once they finish.
      if (words(fresh).length < BARGE_IN_WORDS) return;
      pending.current?.abort();
      pending.current = null;
      setPhase('listening');
    }
    if (phaseRef.current !== 'listening') return;
    setCaption(text);
    clearEndTimer();
    if (text) endTimer.current = setTimeout(() => void sendTurn(), interim.current ? END_OF_TURN_MS.interim : END_OF_TURN_MS.final);
  }, [sendTurn]);

  const listen = useCallback(() => {
    if (!Recognition || !active.current) return;
    const r = new Recognition();
    r.lang = langRef.current;
    r.continuous = true;
    r.interimResults = true;
    // A new recognition session numbers its results from zero again.
    const offset = resultCount.current;
    r.onresult = (e) => {
      let latest = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0].transcript.trim();
        if (res.isFinal) finals.current.set(offset + i, text);
        else latest = `${latest} ${text}`.trim();
      }
      resultCount.current = Math.max(resultCount.current, offset + e.results.length);
      // Only the newest unfinished phrase is interim; finished ones are in `finals`.
      interim.current = latest;
      onSpeech();
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        active.current = false;
        setError('Microphone permission was denied. You can allow it in your browser settings, or type instead.');
        setPhase('error');
      }
      // "no-speech", "aborted" and network blips: onend restarts listening.
    };
    r.onend = () => {
      if (rec.current === r) rec.current = null;
      // Browsers stop listening after a while; carry on until the listener ends the conversation.
      if (active.current) setTimeout(() => active.current && !rec.current && listen(), 150);
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      rec.current = null;
    }
  }, [Recognition, onSpeech]);

  const stop = useCallback(() => {
    active.current = false;
    clearEndTimer();
    pending.current?.abort();
    pending.current = null;
    speaker.current?.stop();
    rec.current?.abort();
    rec.current = null;
    finals.current.clear();
    resultCount.current = 0;
    resetTurn();
    setCoachLine('');
    setPhase('off');
  }, []);

  const start = useCallback(() => {
    if (!Recognition) {
      setError('Talking hands-free needs Chrome, Edge or Safari. You can still type, or use the microphone button.');
      setPhase('error');
      return;
    }
    setError(null);
    speaker.current ??= speakerFactory(langRef.current);
    speaker.current.prepare();
    active.current = true;
    finals.current.clear();
    resultCount.current = 0;
    resetTurn();
    setPhase('listening');
    listen();
  }, [Recognition, listen, speakerFactory]);

  useEffect(() => () => stop(), [stop]);

  return { supported: Recognition !== null, phase, caption, coachLine, error, start, stop };
}

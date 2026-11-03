import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachSpeaker } from './coach-voice';
import { END_OF_TURN_MS, isEcho, useVoiceConversation, type ConversationTurn } from './conversation';

/** A stand-in for the browser's speech recognition that the test feeds phrases into. */
class FakeRecognition {
  static current: FakeRecognition | null = null;
  static started = 0;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  results: Array<{ isFinal: boolean; 0: { transcript: string } }> = [];
  start() {
    FakeRecognition.current = this;
    FakeRecognition.started++;
  }
  stop() {}
  abort() {}
  /** The listener says `text`; interim first, then final unless `final` is false. */
  say(text: string, final = true) {
    const i = this.results.length;
    this.results.push({ isFinal: final, 0: { transcript: text } });
    this.onresult?.({ resultIndex: i, results: [...this.results] });
  }
}

function fakeSpeaker() {
  let finish: (() => void) | null = null;
  const spoken: string[] = [];
  const speaker: CoachSpeaker & { spoken: string[]; finishSpeaking: () => void; stops: number } = {
    engine: 'device',
    spoken,
    stops: 0,
    prepare: vi.fn(),
    speak: (text, onProgress) =>
      new Promise<void>((resolve) => {
        spoken.push(text);
        onProgress?.(text.split(' ').slice(0, 4).join(' '));
        finish = resolve;
      }),
    stop() {
      speaker.stops++;
      finish?.();
    },
    finishSpeaking: () => finish?.(),
  };
  return speaker;
}

const flush = () => act(async () => void (await Promise.resolve()));

describe('isEcho', () => {
  it("recognises the coach's own words coming back through the speaker", () => {
    expect(isEcho('what would you give up', 'So what would you give up if you said yes?')).toBe(true);
    expect(isEcho('wait hold on a second', 'So what would you give up if you said yes?')).toBe(false);
  });
});

describe('a spoken conversation with the coach', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecognition.current = null;
    FakeRecognition.started = 0;
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup(reply = (t: ConversationTurn) => `You said ${t.text}. What would you try first?`) {
    const turns: ConversationTurn[] = [];
    const signals: AbortSignal[] = [];
    let respond: ((s: string) => void) | null = null;
    const ask = vi.fn((turn: ConversationTurn, signal: AbortSignal) => {
      turns.push(turn);
      signals.push(signal);
      return new Promise<string>((resolve) => (respond = () => resolve(reply(turn))));
    });
    const speaker = fakeSpeaker();
    const hook = renderHook(() => useVoiceConversation(ask, () => speaker));
    return { hook, ask, turns, signals, speaker, answer: () => act(async () => respond?.('')) };
  }

  it('listens, sends what the listener said once they pause, speaks the reply, and listens again', async () => {
    const { hook, turns, speaker, answer } = setup();
    act(() => hook.result.current.start());
    expect(hook.result.current.phase).toBe('listening');
    expect(speaker.prepare).toHaveBeenCalled();

    act(() => FakeRecognition.current!.say('how do I start'));
    expect(hook.result.current.caption).toBe('how do I start');
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.final));
    expect(hook.result.current.phase).toBe('thinking');
    expect(turns).toEqual([{ text: 'how do I start' }]);

    await answer();
    expect(hook.result.current.phase).toBe('speaking');
    // Said a sentence at a time.
    expect(speaker.spoken).toEqual(['You said how do I start.']);
    act(() => speaker.finishSpeaking());
    await flush();
    expect(speaker.spoken).toEqual(['You said how do I start.', 'What would you try first?']);
    expect(hook.result.current.phase).toBe('speaking');
    act(() => speaker.finishSpeaking());
    await flush();
    expect(hook.result.current.phase).toBe('listening');
    expect(hook.result.current.caption).toBe('');
  });

  it('starts speaking the first sentence while the rest of the reply is still streaming in', async () => {
    let stream: ((s: string) => void) | null = null;
    let end: ((s: string) => void) | null = null;
    const ask = vi.fn((_t: ConversationTurn, _s: AbortSignal, onText: (soFar: string) => void) => {
      stream = onText;
      return new Promise<string>((resolve) => (end = resolve));
    });
    const speaker = fakeSpeaker();
    const hook = renderHook(() => useVoiceConversation(ask, () => speaker));
    act(() => hook.result.current.start());
    act(() => FakeRecognition.current!.say('give me a scenario'));
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.final));
    act(() => stream!('Picture this: your'));
    // Half a sentence isn't spoken yet.
    expect(speaker.spoken).toEqual([]);
    expect(hook.result.current.phase).toBe('thinking');
    act(() => stream!('Picture this: your team is late. What do'));
    expect(speaker.spoken).toEqual(['Picture this: your team is late.']);
    expect(hook.result.current.phase).toBe('speaking');
    await act(async () => end!('Picture this: your team is late. What do you do first?'));
    act(() => speaker.finishSpeaking());
    await flush();
    expect(speaker.spoken).toEqual(['Picture this: your team is late.', 'What do you do first?']);
    act(() => speaker.finishSpeaking());
    await flush();
    expect(hook.result.current.phase).toBe('listening');
  });

  it('waits longer while a phrase is unfinished', () => {
    const { hook, turns } = setup();
    act(() => hook.result.current.start());
    act(() => FakeRecognition.current!.say('so the thing is', false));
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.final));
    expect(turns).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.interim - END_OF_TURN_MS.final));
    expect(turns).toHaveLength(1);
  });

  it('stops the coach as soon as the listener talks over it, and tells the coach where it was cut off', async () => {
    const { hook, turns, speaker, answer } = setup();
    act(() => hook.result.current.start());
    act(() => FakeRecognition.current!.say('what is this about'));
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.final));
    await answer();
    expect(hook.result.current.phase).toBe('speaking');

    // The coach's own voice coming back through the speaker doesn't count.
    act(() => FakeRecognition.current!.say('you said what is this'));
    expect(hook.result.current.phase).toBe('speaking');
    // A real interruption does.
    act(() => FakeRecognition.current!.say('wait hold on a second'));
    expect(speaker.stops).toBe(1);
    expect(hook.result.current.phase).toBe('listening');
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.final));
    expect(turns[1]).toMatchObject({ interruptedAfter: 'You said what is' });
    expect(turns[1]!.text).toContain('wait hold on a second');
  });

  it('keeps listening when the listener adds to their question while the coach is thinking', () => {
    const { hook, turns, signals } = setup();
    act(() => hook.result.current.start());
    act(() => FakeRecognition.current!.say('how do I say no'));
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.final));
    expect(hook.result.current.phase).toBe('thinking');
    act(() => FakeRecognition.current!.say('and also how do I explain why'));
    expect(signals[0]!.aborted).toBe(true);
    expect(hook.result.current.phase).toBe('listening');
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.final));
    expect(turns[1]!.text).toBe('how do I say no and also how do I explain why');
  });

  it('carries on listening when the browser stops recognition, until the listener ends the conversation', () => {
    const { hook } = setup();
    act(() => hook.result.current.start());
    expect(FakeRecognition.started).toBe(1);
    act(() => FakeRecognition.current!.onend!());
    act(() => void vi.advanceTimersByTime(200));
    expect(FakeRecognition.started).toBe(2);
    act(() => hook.result.current.stop());
    expect(hook.result.current.phase).toBe('off');
    act(() => FakeRecognition.current!.onend!());
    act(() => void vi.advanceTimersByTime(200));
    expect(FakeRecognition.started).toBe(2);
  });

  it('explains when the microphone is not allowed', () => {
    const { hook } = setup();
    act(() => hook.result.current.start());
    act(() => FakeRecognition.current!.onerror!({ error: 'not-allowed' }));
    expect(hook.result.current.phase).toBe('error');
    expect(hook.result.current.error).toMatch(/Microphone permission was denied/);
  });
});

describe('without continuous speech recognition', () => {
  it('says which browsers can talk hands-free', () => {
    const hook = renderHook(() => useVoiceConversation(vi.fn(), () => fakeSpeaker()));
    expect(hook.result.current.supported).toBe(false);
    act(() => hook.result.current.start());
    expect(hook.result.current.error).toMatch(/Chrome, Edge or Safari/);
  });
});

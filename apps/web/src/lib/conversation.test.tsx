import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachSpeaker } from './coach-voice';
import { END_OF_TURN_MS, isEcho, pickTranscript, useVoiceConversation, type ConversationTurn } from './conversation';
import type { TurnRecorder } from './turn-audio';

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
  // Lines queued to be said, oldest (playing) first; finishSpeaking ends the one playing.
  const pending: Array<{ text: string; resolve: () => void; onProgress?: ((s: string) => void) | undefined }> = [];
  const spoken: string[] = [];
  // Like the real voice, a line reports progress once it starts playing.
  const begin = () => pending[0]?.onProgress?.(pending[0].text.split(' ').slice(0, 4).join(' '));
  const say = (text: string, onProgress?: (s: string) => void) =>
    new Promise<void>((resolve) => {
      spoken.push(text);
      pending.push({ text, resolve, onProgress });
      if (pending.length === 1) begin();
    });
  const speaker: CoachSpeaker & { spoken: string[]; finishSpeaking: () => void; stops: number } = {
    engine: 'device',
    spoken,
    stops: 0,
    prepare: vi.fn(),
    say,
    speak: (text, onProgress) => say(text, onProgress),
    stop() {
      speaker.stops++;
      for (const p of pending.splice(0)) p.resolve();
    },
    finishSpeaking: () => {
      pending.shift()?.resolve();
      begin();
    },
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
    // Queued a sentence at a time, so each is ready as soon as the one before ends.
    expect(speaker.spoken).toEqual(['You said how do I start.', 'What would you try first?']);
    act(() => speaker.finishSpeaking());
    await flush();
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
    expect(speaker.spoken).toEqual(['Picture this: your team is late.', 'What do you do first?']);
    act(() => speaker.finishSpeaking());
    await flush();
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

describe('pickTranscript', () => {
  it('prefers the accurate transcript, unless it is empty, a phantom phrase, or about something else', () => {
    expect(pickTranscript('how do I deal with pressure at work', 'How do I deal with pressure at work?')).toBe('How do I deal with pressure at work?');
    expect(pickTranscript('how do i fell with precious at work', 'How do I deal with pressure at work?')).toBe('How do I deal with pressure at work?');
    expect(pickTranscript('how do I start', '')).toBe('how do I start');
    expect(pickTranscript('how do I start', 'Thank you.')).toBe('how do I start');
    expect(pickTranscript('how do I start this project', 'The weather in Paris is lovely today.')).toBe('how do I start this project');
    expect(pickTranscript('', 'Something the phone missed.')).toBe('Something the phone missed.');
  });
});

describe('accurate transcripts of spoken turns', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecognition.current = null;
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function fakeRecorder() {
    let marked = false;
    let voice: ReturnType<TurnRecorder['voice']> = null;
    const r: TurnRecorder & { hear: (v: ReturnType<TurnRecorder['voice']>) => void } = {
      start: async () => true,
      mark: () => void (marked = true),
      clear: () => {
        marked = false;
        voice = null;
      },
      get marked() {
        return marked;
      },
      take: () => (marked ? new Blob(['wav'], { type: 'audio/wav' }) : null),
      voice: () => voice,
      stop: () => {},
      hear: (v) => void (voice = v),
    };
    return r;
  }

  it('sends what was actually said, from the recording, instead of what the browser misheard', async () => {
    const turns: ConversationTurn[] = [];
    const ask = vi.fn(async (t: ConversationTurn) => (turns.push(t), 'Okay.'));
    const transcribe = vi.fn(async () => 'How do I deal with pressure at work?');
    const recorder = fakeRecorder();
    const hook = renderHook(() => useVoiceConversation(ask, () => fakeSpeaker(), 'en-US', { transcribe, recorder: () => recorder }));
    act(() => hook.result.current.start());
    act(() => FakeRecognition.current!.say('how do I fell with precious at work'));
    await act(async () => void vi.advanceTimersByTime(END_OF_TURN_MS.final));
    await act(async () => void (await Promise.resolve()));
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(turns).toEqual([{ text: 'How do I deal with pressure at work?' }]);
  });

  it("ends a turn on the recording's own silence where the browser recognised nothing", async () => {
    const turns: ConversationTurn[] = [];
    const ask = vi.fn(async (t: ConversationTurn) => (turns.push(t), 'Okay.'));
    const recorder = fakeRecorder();
    const hook = renderHook(() => useVoiceConversation(ask, () => fakeSpeaker(), 'en-US', { transcribe: async () => 'Give me a scenario.', recorder: () => recorder }));
    act(() => hook.result.current.start());
    recorder.hear({ startedMsAgo: 2500, endedMsAgo: 400, spokeMs: 1800 });
    await act(async () => void vi.advanceTimersByTime(300));
    expect(turns).toHaveLength(0);
    recorder.hear({ startedMsAgo: 3000, endedMsAgo: 1200, spokeMs: 1800 });
    await act(async () => void vi.advanceTimersByTime(300));
    await act(async () => void (await Promise.resolve()));
    expect(turns).toEqual([{ text: 'Give me a scenario.' }]);
  });

  it('waits longer when a phrase trails off', () => {
    const ask = vi.fn(async () => 'Okay.');
    const hook = renderHook(() => useVoiceConversation(ask, () => fakeSpeaker()));
    act(() => hook.result.current.start());
    act(() => FakeRecognition.current!.say('I want to get better at decisions and'));
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.final));
    expect(ask).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(END_OF_TURN_MS.interim - END_OF_TURN_MS.final));
    expect(ask).toHaveBeenCalled();
  });
});

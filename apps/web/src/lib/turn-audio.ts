/**
 * Records the microphone during a spoken conversation so each of the listener's turns can be transcribed
 * accurately (by Whisper on the server) rather than relying only on the browser's own recognition. Keeps the
 * last minute and a half of audio; `take` returns one turn as a 16 kHz WAV. It also notices speech and
 * silence itself, so a turn can end even where the browser's recognition hears nothing (some phones).
 */

export interface TurnRecorder {
  /** Starts the microphone (call from a tap). Resolves false where recording isn't possible. */
  start(): Promise<boolean>;
  /** The listener's turn started about now: it is recorded from a moment before, so the first word is kept. */
  mark(): void;
  /** Forgets the current turn. */
  clear(): void;
  /** Whether a turn is marked. */
  readonly marked: boolean;
  /** The marked turn so far as a WAV file, or null when there is too little of it. */
  take(): Blob | null;
  /** Speech heard since the last `clear`: how long ago it started and ended (ms), or null if none. */
  voice(): { startedMsAgo: number; endedMsAgo: number; spokeMs: number } | null;
  stop(): void;
}

const KEEP_SECONDS = 90;
const PREROLL_SECONDS = 1.2;
const TARGET_RATE = 16_000;

/** Encodes mono samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => data.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  data.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, 'data');
  data.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    data.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([data.buffer], { type: 'audio/wav' });
}

/** Averages samples down to `to` Hz (speech needs no more than 16 kHz). */
export function downsample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from <= to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += samples[j]!;
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

export function createTurnRecorder(): TurnRecorder {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: ScriptProcessorNode | null = null;
  // Recent audio in chunks, each with the time (s, AudioContext clock) it starts.
  let chunks: Array<{ at: number; samples: Float32Array }> = [];
  let markAt: number | null = null;
  // Voice activity since the last clear.
  let floor = 0.01;
  let voiceStart: number | null = null;
  let voiceEnd: number | null = null;
  let spoke = 0;

  const now = () => ctx?.currentTime ?? 0;

  return {
    async start() {
      if (ctx) return true;
      try {
        if (!navigator.mediaDevices?.getUserMedia) return false;
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        ctx = new AudioContext();
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const samples = new Float32Array(input);
          const at = e.playbackTime - samples.length / e.inputBuffer.sampleRate;
          chunks.push({ at, samples });
          while (chunks.length && chunks[0]!.at < at - KEEP_SECONDS) chunks.shift();
          // A simple voice detector: louder than the room's own noise by a clear margin.
          let sum = 0;
          for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
          const rms = Math.sqrt(sum / samples.length);
          const speaking = rms > Math.max(0.012, floor * 3);
          if (!speaking) floor = floor * 0.95 + rms * 0.05;
          else {
            voiceStart ??= at;
            voiceEnd = at + samples.length / e.inputBuffer.sampleRate;
            spoke += samples.length / e.inputBuffer.sampleRate;
          }
        };
        // A muted path to the speakers keeps the processor running in every browser.
        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(node);
        node.connect(mute);
        mute.connect(ctx.destination);
        return true;
      } catch {
        this.stop();
        return false;
      }
    },
    mark() {
      if (!ctx || markAt !== null) return;
      markAt = Math.max(0, Math.min(now() - PREROLL_SECONDS, voiceStart !== null ? voiceStart - 0.3 : Infinity));
    },
    clear() {
      markAt = null;
      voiceStart = null;
      voiceEnd = null;
      spoke = 0;
    },
    get marked() {
      return markAt !== null;
    },
    take() {
      if (!ctx || markAt === null) return null;
      const from = markAt;
      const parts = chunks.filter((c) => c.at + c.samples.length / ctx!.sampleRate >= from);
      const total = parts.reduce((n, c) => n + c.samples.length, 0);
      if (total < ctx.sampleRate * 0.4) return null;
      const all = new Float32Array(total);
      let o = 0;
      for (const c of parts) {
        all.set(c.samples, o);
        o += c.samples.length;
      }
      return encodeWav(downsample(all, ctx.sampleRate, TARGET_RATE), Math.min(ctx.sampleRate, TARGET_RATE));
    },
    voice() {
      if (voiceStart === null || voiceEnd === null) return null;
      const t = now();
      return { startedMsAgo: (t - voiceStart) * 1000, endedMsAgo: (t - voiceEnd) * 1000, spokeMs: spoke * 1000 };
    },
    stop() {
      node?.disconnect();
      node = null;
      stream?.getTracks().forEach((tr) => tr.stop());
      stream = null;
      void ctx?.close().catch(() => {});
      ctx = null;
      chunks = [];
      markAt = null;
    },
  };
}

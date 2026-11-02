import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlaybackEvent } from '@thinkmade/shared';
import { deviceId, sendProgressOnline, shouldSaveProgress, type ProgressSender } from './progress';

export interface PlayableEpisode {
  id: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  number: number;
  primaryModelName: string | null;
  audioUrl: string;
  durationSeconds: number | null;
}

interface PlayerState {
  current: PlayableEpisode | null;
  queue: PlayableEpisode[];
  playing: boolean;
  position: number;
  duration: number;
  rate: number;
  buffering: boolean;
  error: string | null;
}

interface PlayerApi extends PlayerState {
  play: (episode: PlayableEpisode, opts?: { queue?: PlayableEpisode[]; startAtMs?: number }) => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  setRate: (rate: number) => void;
  next: () => void;
  hasNext: boolean;
  stop: () => void;
  markStatus: (status: 'completed' | 'not_started' | 'in_progress') => void;
}

const Ctx = createContext<PlayerApi | null>(null);
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const RATE_KEY = 'tm-rate';

function readRate(): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return (RATES as readonly number[]).includes(r) ? r : 1;
  } catch {
    return 1;
  }
}

/**
 * One audio element for the whole app, so playback continues across screens.
 * Progress is saved on a 5-second cadence, and on pause, seek, episode change and when the app is hidden.
 */
export function PlayerProvider({ children, sendProgress = sendProgressOnline, resolveSource }: { children: ReactNode; sendProgress?: ProgressSender; resolveSource?: (ep: PlayableEpisode) => Promise<string> }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>({ current: null, queue: [], playing: false, position: 0, duration: 0, rate: readRate(), buffering: false, error: null });
  const saved = useRef({ at: 0, positionMs: -1 });
  const currentRef = useRef<PlayableEpisode | null>(null);
  const pendingStart = useRef<number | null>(null);

  const send = useCallback(
    (event: PlaybackEvent['event'], opts?: { keepalive?: boolean; status?: PlaybackEvent['status'] }) => {
      const ep = currentRef.current;
      const el = audio.current;
      if (!ep || !el) return;
      const positionMs = Math.round(el.currentTime * 1000);
      saved.current = { at: Date.now(), positionMs };
      void sendProgress(ep.id, { positionMs, event, clientUpdatedAt: new Date().toISOString(), deviceId: deviceId(), ...(opts?.status ? { status: opts.status } : {}) }, { keepalive: opts?.keepalive ?? false, durationMs: ep.durationSeconds ? ep.durationSeconds * 1000 : null });
    },
    [sendProgress],
  );

  useEffect(() => {
    const el = new Audio();
    el.preload = 'metadata';
    audio.current = el;
    el.playbackRate = readRate();
    const update = () => setState((s) => ({ ...s, position: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : s.duration }));
    el.addEventListener('timeupdate', () => {
      update();
      if (!el.paused && shouldSaveProgress({ lastSavedAt: saved.current.at, now: Date.now(), lastPositionMs: saved.current.positionMs, positionMs: el.currentTime * 1000 })) send('progress');
    });
    el.addEventListener('loadedmetadata', () => {
      if (pendingStart.current !== null) {
        el.currentTime = Math.min(pendingStart.current / 1000, Math.max(0, el.duration - 2));
        pendingStart.current = null;
      }
      update();
    });
    el.addEventListener('play', () => setState((s) => ({ ...s, playing: true, error: null })));
    el.addEventListener('pause', () => {
      setState((s) => ({ ...s, playing: false }));
      if (!el.ended) send('pause');
    });
    el.addEventListener('waiting', () => setState((s) => ({ ...s, buffering: true })));
    el.addEventListener('playing', () => setState((s) => ({ ...s, buffering: false })));
    el.addEventListener('ended', () => {
      send('ended');
      setState((s) => ({ ...s, playing: false }));
    });
    el.addEventListener('error', () => setState((s) => ({ ...s, playing: false, buffering: false, error: navigator.onLine ? 'This episode could not be played.' : 'You are offline and this episode is not downloaded.' })));
    const onHide = () => {
      if (document.visibilityState === 'hidden' && currentRef.current) send(el.paused ? 'pause' : 'progress', { keepalive: true });
    };
    const onPageHide = () => currentRef.current && send('progress', { keepalive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      el.pause();
      el.src = '';
    };
  }, [send]);

  const play = useCallback<PlayerApi['play']>(
    (episode, opts) => {
      const el = audio.current;
      if (!el) return;
      if (currentRef.current?.id === episode.id) {
        void el.play().catch(() => {});
        return;
      }
      if (currentRef.current && !el.paused) send('pause');
      currentRef.current = episode;
      saved.current = { at: Date.now(), positionMs: opts?.startAtMs ?? 0 };
      pendingStart.current = opts?.startAtMs && opts.startAtMs > 0 ? opts.startAtMs : null;
      setState((s) => ({ ...s, current: episode, queue: opts?.queue ?? s.queue, position: (opts?.startAtMs ?? 0) / 1000, duration: episode.durationSeconds ?? 0, error: null, buffering: true }));
      void (async () => {
        el.src = resolveSource ? await resolveSource(episode) : episode.audioUrl;
        el.playbackRate = readRate();
        await el.play().catch(() => setState((s) => ({ ...s, buffering: false })));
      })();
    },
    [send, resolveSource],
  );

  const api = useMemo<PlayerApi>(() => {
    const idx = state.current ? state.queue.findIndex((q) => q.id === state.current!.id) : -1;
    const nextEp = idx >= 0 ? state.queue[idx + 1] : undefined;
    return {
      ...state,
      play,
      toggle: () => {
        const el = audio.current;
        if (!el || !state.current) return;
        if (el.paused) void el.play().catch(() => {});
        else el.pause();
      },
      seek: (seconds) => {
        const el = audio.current;
        if (!el) return;
        el.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(el.duration) ? el.duration : seconds));
        send('seek');
      },
      skip: (delta) => {
        const el = audio.current;
        if (!el) return;
        el.currentTime = Math.max(0, Math.min(el.currentTime + delta, Number.isFinite(el.duration) ? el.duration - 0.5 : el.currentTime + delta));
        send('seek');
      },
      setRate: (rate) => {
        if (audio.current) audio.current.playbackRate = rate;
        try {
          localStorage.setItem(RATE_KEY, String(rate));
        } catch {
          /* ignore */
        }
        setState((s) => ({ ...s, rate }));
      },
      hasNext: !!nextEp,
      next: () => nextEp && play(nextEp, { queue: state.queue }),
      stop: () => {
        audio.current?.pause();
        currentRef.current = null;
        setState((s) => ({ ...s, current: null, playing: false }));
      },
      markStatus: (status) => send('status', { status }),
    };
  }, [state, play, send]);

  // Lock screen and headphone controls.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !state.current) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title: state.current.title,
      artist: state.current.primaryModelName ? `ThinkMade · ${state.current.primaryModelName}` : 'ThinkMade',
      album: state.current.seriesTitle,
      artwork: [
        // The show's cover where the system can show SVG; the app icon otherwise.
        { src: `/api/series/${encodeURIComponent(state.current.seriesId)}/cover.svg`, sizes: '1400x1400', type: 'image/svg+xml' },
        ...[192, 512].map((s) => ({ src: `/icons/icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png' })),
      ],
    });
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => api.toggle()],
      ['pause', () => api.toggle()],
      ['seekbackward', () => api.skip(-15)],
      ['seekforward', () => api.skip(15)],
      ['seekto', (d) => d.seekTime !== undefined && api.seek(d.seekTime)],
      ['nexttrack', () => api.next()],
    ];
    for (const [a, h] of handlers) {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* unsupported action */
      }
    }
  }, [state.current, api]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlayer(): PlayerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlayer must be used inside PlayerProvider');
  return v;
}

export function useOptionalPlayer(): PlayerApi | null {
  return useContext(Ctx);
}

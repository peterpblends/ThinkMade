import { Link } from 'react-router';
import { Pause, Play } from 'lucide-react';
import { usePlayer } from './player-context';
import { ShowArt } from '../components/show-art';

/** Docked above the tab bar whenever something is loaded. */
export function MiniPlayer() {
  const p = usePlayer();
  if (!p.current) return null;
  const pct = p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 px-2 pb-1">
      <div className="mx-auto flex max-w-xl items-center gap-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <Link to="/player" className="flex min-h-14 min-w-0 flex-1 items-center gap-3 pl-2 pr-4">
          <ShowArt seriesId={p.current.seriesId} title={p.current.seriesTitle} decorative className="h-10 w-10 rounded-lg" />
          <span className="flex min-w-0 flex-col justify-center">
            <span className="truncate text-[0.95rem] font-semibold"><span className="sr-only">Open player: </span>{p.current.title}</span>
            {p.current.primaryModelName && <span className="truncate text-xs text-muted">{p.current.primaryModelName}</span>}
          </span>
        </Link>
        <button type="button" onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Play'} className="mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-strong text-on-accent">
          {p.playing ? <Pause aria-hidden size={20} /> : <Play aria-hidden size={20} />}
        </button>
        <div aria-hidden className="absolute inset-x-2 bottom-1 mx-auto h-0.5 max-w-xl">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

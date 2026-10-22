import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './ui';
import { useOptionalPlayer } from '../player/player-context';

/**
 * When a new release is ready, offer it instead of forcing it.
 * The new service worker activates only when the user taps Update, so playback is never interrupted.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const player = useOptionalPlayer();
  // Never interrupt listening: offer the update only while nothing is playing.
  if (!needRefresh || player?.playing) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
      <p className="flex-1 text-sm">A new version of ThinkMade is ready.</p>
      <Button variant="ghost" className="min-h-11 px-3 text-sm" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
      <Button className="min-h-11 px-4 text-sm" onClick={() => updateServiceWorker(true)}>
        Update
      </Button>
    </div>
  );
}

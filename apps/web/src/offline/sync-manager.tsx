import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { pruneEvictedDownloads } from './downloads';
import { announceDownloadsChanged } from './hooks';
import { startSyncTriggers } from './sync';
import { setSignedIn } from './player-adapters';
import { useSession } from '../lib/auth-client';

/** Starts background sync for the life of the app and refreshes server data after changes are sent. */
export function SyncManager() {
  const qc = useQueryClient();
  const { user, isPending } = useSession();
  useEffect(() => {
    // Offline the session cannot be checked; keep recording so the listener's progress is not lost.
    if (!isPending) setSignedIn(!!user || navigator.onLine === false);
  }, [user, isPending]);
  useEffect(() => {
    void pruneEvictedDownloads().then((n) => n && announceDownloadsChanged());
    return startSyncTriggers(() => {
      void qc.invalidateQueries({ queryKey: ['library'] });
      void qc.invalidateQueries({ queryKey: ['playback'] });
    });
  }, [qc]);
  return null;
}

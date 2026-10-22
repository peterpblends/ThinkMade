import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { pruneEvictedDownloads } from './downloads';
import { announceDownloadsChanged } from './hooks';
import { startSyncTriggers } from './sync';

/** Starts background sync for the life of the app and refreshes server data after changes are sent. */
export function SyncManager() {
  const qc = useQueryClient();
  useEffect(() => {
    void pruneEvictedDownloads().then((n) => n && announceDownloadsChanged());
    return startSyncTriggers(() => {
      void qc.invalidateQueries({ queryKey: ['library'] });
      void qc.invalidateQueries({ queryKey: ['playback'] });
    });
  }, [qc]);
  return null;
}

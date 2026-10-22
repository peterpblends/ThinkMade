import { useCallback, useEffect, useState } from 'react';
import { downloadEpisode, getDownload, listDownloads, removeDownload, type DownloadableEpisode } from './downloads';
import type { DownloadRecord } from './db';

const EVENT = 'tm-downloads-changed';
export const announceDownloadsChanged = () => window.dispatchEvent(new Event(EVENT));

export function useDownloads() {
  const [items, setItems] = useState<DownloadRecord[] | null>(null);
  const refresh = useCallback(() => void listDownloads().then(setItems).catch(() => setItems([])), []);
  useEffect(() => {
    refresh();
    window.addEventListener(EVENT, refresh);
    return () => window.removeEventListener(EVENT, refresh);
  }, [refresh]);
  return items;
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export type DownloadState = { state: 'none' } | { state: 'downloading' } | { state: 'downloaded'; bytes: number } | { state: 'error'; message: string };

/** Download status and actions for one episode. `loadDetail` fetches what the player shows offline. */
export function useDownload(ep: DownloadableEpisode | null, loadDetail?: () => Promise<unknown>) {
  const [s, setS] = useState<DownloadState>({ state: 'none' });
  const id = ep?.id;
  const check = useCallback(() => {
    if (!id) return;
    void getDownload(id).then((d) => setS((prev) => (prev.state === 'downloading' ? prev : d ? { state: 'downloaded', bytes: d.bytes } : prev.state === 'error' ? prev : { state: 'none' })));
  }, [id]);
  useEffect(() => {
    check();
    window.addEventListener(EVENT, check);
    return () => window.removeEventListener(EVENT, check);
  }, [check]);
  return {
    ...s,
    download: async () => {
      if (!ep) return;
      setS({ state: 'downloading' });
      const detail = await loadDetail?.().catch(() => null);
      const r = await downloadEpisode(ep, { detail });
      setS(r.ok ? { state: 'downloaded', bytes: r.bytes } : { state: 'error', message: r.message });
      announceDownloadsChanged();
    },
    remove: async () => {
      if (!ep) return;
      await removeDownload(ep.id);
      setS({ state: 'none' });
      announceDownloadsChanged();
    },
  };
}

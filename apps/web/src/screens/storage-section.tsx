import { useEffect, useState } from 'react';
import { Card } from '../components/ui';
import { removeAllDownloads } from '../offline/downloads';
import { announceDownloadsChanged, useDownloads } from '../offline/hooks';

/** Offline storage: what ThinkMade uses, whether the browser has promised to keep it, and a way to clear it. */
export function StorageSection() {
  const items = useDownloads();
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
    void navigator.storage?.persisted?.().then(setPersisted);
  }, [items]);
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl">Downloads and storage</h2>
      <p className="text-[0.95rem]">
        {items?.length ?? 0} downloaded episode{items?.length === 1 ? '' : 's'} using {mb((items ?? []).reduce((n, d) => n + d.bytes, 0))}.
        {est?.quota ? ` This device allows about ${mb(est.quota)} for ThinkMade.` : ''}
      </p>
      <p className="text-sm text-muted">
        {persisted ? 'Your browser has agreed to keep downloads unless you remove them.' : 'Your browser may remove downloads if the device runs low on space.'}
      </p>
      {!!items?.length && (
        <button type="button" onClick={async () => { await removeAllDownloads(); announceDownloadsChanged(); }} className="self-start text-sm font-semibold text-danger underline-offset-4 hover:underline">
          Remove all downloads
        </button>
      )}
    </Card>
  );
}

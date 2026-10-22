import { CheckCircle2, Download, LoaderCircle, Trash2 } from 'lucide-react';
import type { DownloadableEpisode } from './downloads';
import { useDownload } from './hooks';

export function DownloadButton({ ep, loadDetail, compact = false }: { ep: DownloadableEpisode; loadDetail?: () => Promise<unknown>; compact?: boolean }) {
  const d = useDownload(ep, loadDetail);
  const cls = 'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold';
  if (d.state === 'downloading') {
    return (
      <span role="status" className={`${cls} text-muted`}>
        <LoaderCircle aria-hidden size={18} className="animate-spin" /> Downloading…
      </span>
    );
  }
  if (d.state === 'downloaded') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className={`${cls} border-sage/50 bg-sage-soft text-sage-ink`}>
          <CheckCircle2 aria-hidden size={18} /> Downloaded
        </span>
        <button type="button" onClick={() => void d.remove()} aria-label={`Remove download of ${ep.title}`} className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <Trash2 aria-hidden size={18} />
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={() => void d.download()} className={cls} aria-label={`Download ${ep.title} for offline listening`}>
        <Download aria-hidden size={18} /> {compact ? 'Download' : 'Download for offline'}
      </button>
      {d.state === 'error' && <span role="alert" className="text-sm text-danger">{d.message}</span>}
    </span>
  );
}

import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { DOCUMENT_LABEL, type CoachDocument } from '@thinkmade/shared';

const ICON = { pdf: FileText, xlsx: FileSpreadsheet, pptx: Presentation } as const;

/** What's in the file, in a few words. */
export function describeDocument(d: CoachDocument): string {
  if (d.format === 'pdf') return `${d.sections.length} section${d.sections.length === 1 ? '' : 's'}`;
  if (d.format === 'xlsx') {
    const rows = d.sheets.reduce((n, s) => n + s.rows.length, 0);
    return `${d.sheets.length} sheet${d.sheets.length === 1 ? '' : 's'}, ${rows} row${rows === 1 ? '' : 's'}`;
  }
  return `${d.slides.length + 1} slides`;
}

/** A file the coach made: what it is, and a button that builds and downloads it. */
export function DocumentCard({ d }: { d: CoachDocument }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = ICON[d.format];
  const label = DOCUMENT_LABEL[d.format];
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { buildDocument, saveFile } = await import('../lib/documents');
      const { blob, name } = await buildDocument(d);
      saveFile(blob, name);
    } catch {
      setError('The file could not be made. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-accent-ink">
          <Icon aria-hidden size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{d.title}</p>
          <p className="text-xs text-muted">
            {label} · {describeDocument(d)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          aria-label={`Download ${label}: ${d.title}`}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent-strong px-3.5 text-sm font-semibold text-on-accent disabled:opacity-60"
        >
          <Download aria-hidden size={16} /> {busy ? 'Making…' : 'Download'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

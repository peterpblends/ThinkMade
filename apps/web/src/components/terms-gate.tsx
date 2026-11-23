import { useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_CONTENT_NOTICE, TERMS_VERSION } from '@thinkmade/shared';
import { api, ApiError, TERMS_REQUIRED_EVENT } from '../lib/api';
import { authClient, useSession } from '../lib/auth-client';
import { Button, Notice } from './ui';

const link = 'font-semibold text-accent-ink underline underline-offset-4';

/**
 * The agreement: an unticked box the person must tick themselves, beside links to the full Terms and Privacy
 * Policy and a plain statement that the content is AI-generated and not professional advice.
 */
export function TermsAgreement({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} required className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-accent-strong)]" />
      <label htmlFor={id} className="text-[0.92rem] leading-snug">
        I have read and agree to the{' '}
        <Link to="/terms" target="_blank" className={link}>
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link to="/privacy" target="_blank" className={link}>
          Privacy Policy
        </Link>
        , including the AI-content disclaimer, the limits on ThinkMade's liability and the arbitration agreement. I understand that {AI_CONTENT_NOTICE.charAt(0).toLowerCase() + AI_CONTENT_NOTICE.slice(1)}
      </label>
    </div>
  );
}

/**
 * Asks a signed-in person who hasn't agreed to the current terms (an account from before them, or after an
 * update) to agree before they carry on. Opens itself, and whenever the server says agreement is needed.
 */
export function TermsGate() {
  const { user } = useSession();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const status = useQuery({
    queryKey: ['terms', user?.id],
    queryFn: () => api<{ version: string; accepted: boolean }>('/api/me/terms'),
    enabled: !!user,
    staleTime: 10 * 60_000,
  });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    const again = () => void qc.invalidateQueries({ queryKey: ['terms'] });
    window.addEventListener(TERMS_REQUIRED_EVENT, again);
    return () => window.removeEventListener(TERMS_REQUIRED_EVENT, again);
  }, [qc]);

  // The terms themselves stay readable.
  if (!user || !status.data || status.data.accepted || pathname === '/terms' || pathname === '/privacy') return null;
  const agree = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/me/terms', { method: 'POST', body: JSON.stringify({ version: TERMS_VERSION }) });
      await qc.invalidateQueries({ queryKey: ['terms'] });
    } catch (err) {
      // The terms changed again while this page was open: reload to show the latest.
      if (err instanceof ApiError && err.code === 'terms_version_mismatch') window.location.reload();
      else setError('Could not save your agreement. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
        <h2 id={titleId} className="font-serif text-xl font-semibold">
          Please review our terms
        </h2>
        <p className="mt-2 text-[0.95rem] text-muted">To keep making podcasts and using coaching, please read and agree to our Terms of Service and Privacy Policy.</p>
        <div className="mt-4">
          <TermsAgreement checked={checked} onChange={setChecked} />
        </div>
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <Button block disabled={!checked} busy={busy} onClick={() => void agree()}>
            Agree and continue
          </Button>
          <button type="button" onClick={() => void authClient.signOut().then(() => window.location.assign('/'))} className="min-h-11 text-sm font-semibold text-muted underline-offset-4 hover:underline">
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A short, visible note that a podcast is AI-generated (as AI transparency rules require), shown on podcast
 * pages rather than in the audio.
 */
export function AiContentNote({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs leading-snug text-muted ${className}`}>
      AI-generated podcast: may contain errors, and isn't professional advice.{' '}
      <Link to="/terms#ai" className="underline underline-offset-2">
        Learn more
      </Link>
    </p>
  );
}

/** Links to the Terms of Service and Privacy Policy. */
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <p className={`text-sm text-muted ${className}`}>
      <Link to="/terms" className="underline underline-offset-4">
        Terms of Service
      </Link>
      {' · '}
      <Link to="/privacy" className="underline underline-offset-4">
        Privacy Policy
      </Link>
    </p>
  );
}

import { useState } from 'react';
import { Share, SquarePlus } from 'lucide-react';
import { useInstall } from '../lib/install';
import { Button } from './ui';
import { Sheet } from './sheet';

/** iOS cannot prompt programmatically, so explain Add to Home Screen. */
export function IOSInstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Install ThinkMade">
      <ol className="flex flex-col gap-3 text-[0.98rem]">
        <li className="flex items-start gap-3">
          <Share aria-hidden className="mt-0.5 shrink-0 text-accent-ink" size={22} />
          <span>
            In Safari, tap the <strong>Share</strong> button.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <SquarePlus aria-hidden className="mt-0.5 shrink-0 text-accent-ink" size={22} />
          <span>
            Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
          </span>
        </li>
      </ol>
      <p className="mt-4 text-sm text-muted">ThinkMade then opens full screen from your home screen, like any other app.</p>
      <Button block className="mt-5" onClick={onClose}>
        Got it
      </Button>
    </Sheet>
  );
}

/** Starts installation: the browser prompt where supported, instructions on iOS. */
export function useInstallAction() {
  const install = useInstall();
  const [iosOpen, setIosOpen] = useState(false);
  return {
    available: install.available,
    start: async () => {
      if (install.canPrompt) await install.prompt();
      else if (install.needsIOSInstructions) setIosOpen(true);
    },
    sheet: <IOSInstallSheet open={iosOpen} onClose={() => setIosOpen(false)} />,
  };
}

const DISMISS_KEY = 'tm-install-dismissed';

/** A quiet, dismissible install suggestion. Hidden when installed or dismissed. */
export function InstallCard() {
  const action = useInstallAction();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!action.available || dismissed) return null;
  return (
    <div className="mt-8 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
      <p className="flex-1 text-sm text-ink">Add ThinkMade to your home screen for quick, full-screen listening.</p>
      <Button variant="secondary" className="min-h-11 px-4 text-sm" onClick={action.start}>
        Install
      </Button>
      <button
        type="button"
        className="min-h-11 min-w-11 rounded-full text-sm text-muted hover:text-ink"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(DISMISS_KEY, '1');
          } catch {
            /* ignore */
          }
        }}
        aria-label="Dismiss install suggestion"
      >
        ✕
      </button>
      {action.sheet}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { SYMBOL_GEOMETRY as G } from '@thinkmade/brand';
import { BRAND } from '@thinkmade/shared';

const SEEN_KEY = 'tm-splash-seen';
/** How long the splash shows before fading out, and how long the fade takes (milliseconds). */
export const SPLASH_MS = 2300;
export const SPLASH_FADE_MS = 400;

/**
 * Whether to open with the splash: once per visit (browser session). Automated browsers skip it unless the
 * address asks for it with ?splash=1, so tests don't wait on it.
 */
export function shouldShowSplash(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('splash') === '1') return true;
    if (navigator.webdriver) return false;
    return sessionStorage.getItem(SEEN_KEY) !== '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* private mode: the splash may show again next time, which is harmless */
  }
}

/**
 * The opening splash: the symbol's two ridges turn into place around the core, then the name and tagline
 * appear, and it fades into the app (which has loaded underneath). Tap to skip. With reduced motion the
 * logo appears already in place and leaves sooner.
 */
export function Splash() {
  const [phase, setPhase] = useState<'show' | 'leaving' | 'gone'>(() => (shouldShowSplash() ? 'show' : 'gone'));
  useEffect(() => {
    if (phase !== 'show') return;
    markSeen();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setPhase('leaving'), reduced ? 900 : SPLASH_MS);
    return () => clearTimeout(t);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'leaving') return;
    const t = setTimeout(() => setPhase('gone'), SPLASH_FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);
  if (phase === 'gone') return null;
  return (
    <div
      data-testid="splash"
      aria-hidden
      onClick={() => setPhase('leaving')}
      className={`tm-splash fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-bg text-ink ${phase === 'leaving' ? 'tm-splash-leave' : ''}`}
    >
      <svg viewBox={G.viewBox} width={112} height={112} className="overflow-visible">
        {G.ridgePaths.map((d, i) => (
          <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={G.strokeWidth} strokeLinecap="round" className={`tm-ridge tm-ridge-${i}`} />
        ))}
        <circle cx={G.center} cy={G.center} r={G.coreRadius} fill="var(--tm-accent)" className="tm-core" />
      </svg>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="tm-splash-name font-serif text-[2.1rem] font-semibold leading-none tracking-[-0.01em]">
          Think<span className="text-accent-ink">Made</span>
        </span>
        <span className="tm-splash-tagline font-serif text-[1.05rem] italic text-accent-ink">{BRAND.tagline}</span>
      </div>
    </div>
  );
}

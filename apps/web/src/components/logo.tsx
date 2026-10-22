import { SYMBOL_GEOMETRY as G } from '@thinkmade/brand';
import { BRAND } from '@thinkmade/shared';

/** The ThinkMade symbol, drawn inline so it follows the theme. */
export function LogoSymbol({ size = 28, decorative = false }: { size?: number; decorative?: boolean }) {
  return (
    <svg
      viewBox={G.viewBox}
      width={size}
      height={size}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': BRAND.name })}
    >
      <path d={G.ridgePath} fill="none" stroke="currentColor" strokeWidth={G.strokeWidth} strokeLinecap="round" />
      <circle cx={G.center} cy={G.center} r={G.coreRadius} fill="var(--tm-accent)" />
    </svg>
  );
}

/** Symbol plus wordmark. The wordmark is live text in Newsreader so it stays crisp and selectable. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink" role="img" aria-label={BRAND.name}>
      <LogoSymbol size={size} decorative />
      <span aria-hidden className="font-serif text-[1.35rem] font-semibold leading-none tracking-[-0.01em]">
        Think<span className="text-accent-ink">Made</span>
      </span>
    </span>
  );
}

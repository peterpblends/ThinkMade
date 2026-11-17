import type { Visual } from '@thinkmade/shared';

/** Series colours, from the theme, so charts read well in light and dark. */
const SERIES = ['var(--color-accent)', 'var(--color-sage)', 'var(--color-accent-ink)', 'var(--color-sage-ink)', 'var(--color-muted)', 'var(--color-accent-strong)'];
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString() : String(Math.round(n * 100) / 100));

/** A chart or thinking diagram the coach drew, drawn to fit the screen with a readable text equivalent. */
export function VisualView({ v }: { v: Visual }) {
  return (
    <figure aria-label={v.title} className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm font-semibold">
        <span>{v.title}</span>
        {'illustrative' in v && v.illustrative && <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">Illustrative</span>}
      </figcaption>
      <Body v={v} />
    </figure>
  );
}

function Body({ v }: { v: Visual }) {
  switch (v.type) {
    case 'bar':
      return <Bars v={v} />;
    case 'line':
      return <Lines v={v} />;
    case 'pie':
      return <Pie v={v} />;
    case 'matrix':
      return <Matrix v={v} />;
    case 'flow':
      return <Flow v={v} />;
    case 'cycle':
      return <Cycle v={v} />;
    case 'pyramid':
      return <Pyramid v={v} />;
    case 'compare':
      return <Compare v={v} />;
    case 'timeline':
      return <Timeline v={v} />;
  }
}

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

/** Horizontal bars: labels stay readable on a phone. Negative values extend left of zero. */
function Bars({ v }: { v: Extract<Visual, { type: 'bar' }> }) {
  const max = Math.max(...v.data.map((d) => Math.abs(d.value)), 1e-9);
  const hasNegative = v.data.some((d) => d.value < 0);
  return (
    <div>
      <ul aria-hidden className="flex flex-col gap-1.5">
        {v.data.map((d, i) => {
          const pct = (Math.abs(d.value) / max) * (hasNegative ? 50 : 100);
          return (
            <li key={i} className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-2 text-xs">
              <span className="truncate text-ink" title={d.label}>{d.label}</span>
              <span className="relative flex h-5 items-center">
                <span
                  className="absolute h-4 rounded"
                  style={{ background: SERIES[i % 2 === 0 ? 0 : 1], width: `${Math.max(pct, 1)}%`, left: hasNegative ? (d.value < 0 ? `${50 - pct}%` : '50%') : 0 }}
                />
                <span className="relative ml-auto pl-1 font-semibold tabular-nums text-ink" style={hasNegative ? undefined : { marginLeft: `calc(${Math.max(pct, 1)}% + 0.25rem)` }}>
                  {fmt(d.value)}
                  {v.unit ? ` ${v.unit}` : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <DataTable caption={v.title} head={['Item', v.unit ? `Value (${v.unit})` : 'Value']} rows={v.data.map((d) => [d.label, d.value])} />
    </div>
  );
}

function Lines({ v }: { v: Extract<Visual, { type: 'line' }> }) {
  const W = 320;
  const H = 170;
  const pad = { l: 34, r: 10, t: 10, b: 28 };
  const xs = v.series[0]!.points.map((p) => p.x);
  const all = v.series.flatMap((s) => s.points.map((p) => p.y));
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all, lo + 1e-9);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, xs.length - 1);
  const y = (val: number) => pad.t + (1 - (val - lo) / (hi - lo)) * (H - pad.t - pad.b);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
        {[lo, (lo + hi) / 2, hi].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
            <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xs.map((label, i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="9" fill="var(--color-muted)">
            {label}
          </text>
        ))}
        {v.series.map((s, k) => (
          <g key={s.name}>
            <polyline fill="none" stroke={SERIES[k]} strokeWidth="2.5" strokeLinejoin="round" points={s.points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ')} />
            {s.points.map((p, i) => (
              <circle key={i} cx={x(i)} cy={y(p.y)} r="3" fill={SERIES[k]} />
            ))}
          </g>
        ))}
      </svg>
      {v.series.length > 1 && <Legend items={v.series.map((s) => s.name)} />}
      {(v.xLabel || v.unit) && <p className="text-center text-xs text-muted">{[v.xLabel, v.unit && `values in ${v.unit}`].filter(Boolean).join(' · ')}</p>}
      <DataTable caption={v.title} head={[v.xLabel ?? 'Point', ...v.series.map((s) => s.name)]} rows={xs.map((label, i) => [label, ...v.series.map((s) => s.points[i]?.y ?? '')])} />
    </div>
  );
}

function Legend({ items }: { items: string[] }) {
  return (
    <ul aria-hidden className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {items.map((it, i) => (
        <li key={it} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
          {it}
        </li>
      ))}
    </ul>
  );
}

function Pie({ v }: { v: Extract<Visual, { type: 'pie' }> }) {
  const total = v.data.reduce((n, d) => n + d.value, 0);
  let angle = -Math.PI / 2;
  const arcs = v.data.map((d) => {
    const a0 = angle;
    angle += (d.value / total) * Math.PI * 2;
    return { d, a0, a1: angle };
  });
  const pt = (a: number, r: number) => `${60 + r * Math.cos(a)},${60 + r * Math.sin(a)}`;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0" aria-hidden>
        {arcs.map(({ d, a0, a1 }, i) =>
          v.data.length === 1 ? null : (
            <path key={d.label} d={`M${pt(a0, 56)} A56,56 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1, 56)} L${pt(a1, 32)} A32,32 0 ${a1 - a0 > Math.PI ? 1 : 0} 0 ${pt(a0, 32)} Z`} fill={SERIES[i % SERIES.length]} stroke="var(--color-surface-2)" strokeWidth="1.5" />
          ),
        )}
      </svg>
      <ul aria-hidden className="flex flex-col gap-1 text-xs">
        {v.data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
            <span>
              {d.label} <span className="font-semibold tabular-nums">{Math.round((d.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
      <DataTable caption={v.title} head={['Part', 'Share']} rows={v.data.map((d) => [d.label, `${Math.round((d.value / total) * 100)}%`])} />
    </div>
  );
}

function Matrix({ v }: { v: Extract<Visual, { type: 'matrix' }> }) {
  const [tl, tr, bl, br] = v.quadrants;
  const cell = (q: typeof tl, strong: boolean) => (
    <div className={`min-h-20 rounded-lg p-2 ${strong ? 'bg-sage-soft text-sage-ink' : 'bg-surface'}`}>
      <p className="text-xs font-semibold">{q!.title}</p>
      {q!.text && <p className="mt-0.5 text-xs leading-snug text-ink">{q!.text}</p>}
    </div>
  );
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-1.5">
      <div className="flex flex-col items-center justify-between py-1 text-[0.65rem] text-muted">
        <span>{v.y.high}</span>
        <span className="font-semibold text-ink [writing-mode:vertical-rl] rotate-180">{v.y.label}</span>
        <span>{v.y.low}</span>
      </div>
      <div>
        <div className="grid grid-cols-2 gap-1.5" role="list" aria-label={`${v.y.label} against ${v.x.label}`}>
          <div role="listitem" aria-label={`High ${v.y.label}, low ${v.x.label}`}>{cell(tl, false)}</div>
          <div role="listitem" aria-label={`High ${v.y.label}, high ${v.x.label}`}>{cell(tr, true)}</div>
          <div role="listitem" aria-label={`Low ${v.y.label}, low ${v.x.label}`}>{cell(bl, false)}</div>
          <div role="listitem" aria-label={`Low ${v.y.label}, high ${v.x.label}`}>{cell(br, false)}</div>
        </div>
        <div className="mt-1 flex justify-between text-[0.65rem] text-muted">
          <span>{v.x.low}</span>
          <span className="font-semibold text-ink">{v.x.label}</span>
          <span>{v.x.high}</span>
        </div>
      </div>
    </div>
  );
}

function Steps({ items, numbered }: { items: Array<{ title: string; text?: string | undefined }>; numbered: boolean }) {
  return (
    <ol className="flex flex-col">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2.5">
          <div className="flex flex-col items-center">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-strong text-xs font-bold text-on-accent">{numbered ? i + 1 : '•'}</span>
            {i < items.length - 1 && <span aria-hidden className="w-0.5 flex-1 bg-line" />}
          </div>
          <div className="pb-3">
            <p className="text-sm font-semibold leading-6">{s.title}</p>
            {s.text && <p className="text-xs leading-snug text-muted">{s.text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Flow({ v }: { v: Extract<Visual, { type: 'flow' }> }) {
  return <Steps items={v.steps} numbered />;
}

function Cycle({ v }: { v: Extract<Visual, { type: 'cycle' }> }) {
  const n = v.steps.length;
  const pos = (i: number) => ({ x: 60 + 44 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n), y: 60 + 44 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / n) });
  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start">
      <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0" aria-hidden>
        <circle cx="60" cy="60" r="44" fill="none" stroke="var(--color-line)" strokeWidth="2" strokeDasharray="4 4" />
        {v.steps.map((_, i) => {
          const p = pos(i);
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="11" fill="var(--color-accent-strong)" />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--color-on-accent)">
                {i + 1}
              </text>
            </g>
          );
        })}
        <text x="60" y="64" textAnchor="middle" fontSize="16" fill="var(--color-muted)">
          ↻
        </text>
      </svg>
      <div className="flex-1">
        <Steps items={v.steps} numbered />
        <p className="text-xs text-muted">…and back to step 1.</p>
      </div>
    </div>
  );
}

function Pyramid({ v }: { v: Extract<Visual, { type: 'pyramid' }> }) {
  const n = v.levels.length;
  return (
    <ol className="flex flex-col items-center gap-1">
      {v.levels.map((l, i) => (
        <li key={i} className="rounded-md px-2 py-1.5 text-center" style={{ width: `${45 + (55 * i) / Math.max(1, n - 1)}%`, background: i === 0 ? 'var(--color-accent-strong)' : i % 2 ? 'var(--color-sage-soft)' : 'var(--color-surface)', color: i === 0 ? 'var(--color-on-accent)' : undefined }}>
          <p className="text-xs font-semibold">{l.title}</p>
          {l.text && <p className="text-[0.7rem] leading-snug opacity-90">{l.text}</p>}
        </li>
      ))}
    </ol>
  );
}

function Compare({ v }: { v: Extract<Visual, { type: 'compare' }> }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr>
            <th scope="col" className="p-1.5" />
            {v.columns.map((c) => (
              <th key={c} scope="col" className="border-b border-line p-1.5 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {v.rows.map((r) => (
            <tr key={r.label} className="align-top">
              <th scope="row" className="border-b border-line p-1.5 font-semibold">
                {r.label}
              </th>
              {r.cells.map((c, i) => (
                <td key={i} className="border-b border-line p-1.5 leading-snug">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ v }: { v: Extract<Visual, { type: 'timeline' }> }) {
  return (
    <ol className="flex flex-col">
      {v.events.map((e, i) => (
        <li key={i} className="grid grid-cols-[4.5rem_auto_1fr] gap-2">
          <span className="pt-0.5 text-right text-xs font-semibold tabular-nums text-accent-ink">{e.when}</span>
          <div className="flex flex-col items-center">
            <span aria-hidden className="mt-1.5 h-2.5 w-2.5 rounded-full bg-accent-strong" />
            {i < v.events.length - 1 && <span aria-hidden className="w-0.5 flex-1 bg-line" />}
          </div>
          <div className="pb-3">
            <p className="text-sm font-semibold leading-5">{e.title}</p>
            {e.text && <p className="text-xs leading-snug text-muted">{e.text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

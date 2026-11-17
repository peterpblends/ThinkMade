import { z } from 'zod';

/**
 * Visuals the coach can draw in a reply to teach better than words alone: charts (bar, line, pie) and
 * thinking diagrams (a 2x2 matrix, a flow of steps, a cycle, a pyramid, a comparison table, a timeline).
 * The coach writes one as a ```visual block of JSON; the app checks it against these shapes and draws it.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
const title = text(90);
const item = z.object({ title: text(48), text: text(160).optional() });
const datum = z.object({ label: text(40), value: z.number().finite() });

export const visualSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bar'), title, unit: text(16).optional(), illustrative: z.boolean().optional(), data: z.array(datum).min(2).max(10) }),
  z.object({
    type: z.literal('line'),
    title,
    unit: text(16).optional(),
    illustrative: z.boolean().optional(),
    xLabel: text(30).optional(),
    series: z
      .array(z.object({ name: text(30), points: z.array(z.object({ x: text(16), y: z.number().finite() })).min(2).max(12) }))
      .min(1)
      .max(3),
  }),
  z.object({ type: z.literal('pie'), title, illustrative: z.boolean().optional(), data: z.array(datum.extend({ value: z.number().finite().positive() })).min(2).max(6) }),
  z.object({
    type: z.literal('matrix'),
    title,
    x: z.object({ label: text(30), low: text(20), high: text(20) }),
    y: z.object({ label: text(30), low: text(20), high: text(20) }),
    /** Top-left, top-right, bottom-left, bottom-right. */
    quadrants: z.array(item).length(4),
  }),
  z.object({ type: z.literal('flow'), title, steps: z.array(item).min(2).max(7) }),
  z.object({ type: z.literal('cycle'), title, steps: z.array(item).min(3).max(6) }),
  z.object({ type: z.literal('pyramid'), title, levels: z.array(item).min(2).max(6) }),
  z.object({
    type: z.literal('compare'),
    title,
    columns: z.array(text(30)).min(2).max(4),
    rows: z.array(z.object({ label: text(40), cells: z.array(text(120)) })).min(1).max(8),
  }),
  z.object({ type: z.literal('timeline'), title, events: z.array(z.object({ when: text(24), title: text(60), text: text(160).optional() })).min(2).max(8) }),
]);
export type Visual = z.infer<typeof visualSchema>;
export const VISUAL_TYPES = ['bar', 'line', 'pie', 'matrix', 'flow', 'cycle', 'pyramid', 'compare', 'timeline'] as const;

const BLOCK = /```visual\s*\n?([\s\S]*?)```/g;

/**
 * Splits a coach reply into its words and the visuals in it. A visual that isn't valid is left out (never
 * shown as code). While a reply is still streaming, an unfinished visual is hidden and `drawing` is set.
 */
export function splitVisuals(content: string): { text: string; visuals: Visual[]; drawing: boolean } {
  const visuals: Visual[] = [];
  let rest = content.replace(BLOCK, (_m, body: string) => {
    try {
      const parsed = visualSchema.safeParse(JSON.parse(body));
      if (parsed.success) {
        const v = parsed.data;
        // A comparison's rows must have a cell for every column.
        if (v.type !== 'compare' || v.rows.every((r) => r.cells.length === v.columns.length)) visuals.push(v);
      }
    } catch {
      /* not a visual */
    }
    return '\n';
  });
  const open = rest.indexOf('```visual');
  const drawing = open >= 0;
  if (drawing) rest = rest.slice(0, open);
  return { text: rest.replace(/\n{3,}/g, '\n\n').trim(), visuals, drawing };
}

/** The words of a reply without its visuals, for reading aloud. */
export function withoutVisuals(content: string): string {
  return splitVisuals(content).text.replace(/\s+/g, ' ').trim();
}

/** Added to the coach's instructions: when and how to draw. */
export const VISUAL_COACH_INSTRUCTIONS = `
Visuals: when a picture would teach better than words (a trade-off, a framework, a process, a comparison, a trend, priorities), add one visual after your words, at most one per reply and only when it truly helps. Write it as a fenced block exactly like this:
\`\`\`visual
{"type": "matrix", "title": "...", ...}
\`\`\`
Types and shapes (JSON, short labels):
- bar: {"type":"bar","title":string,"unit"?:string,"illustrative"?:boolean,"data":[{"label":string,"value":number}]} (2-10 bars)
- line: {"type":"line","title":string,"unit"?:string,"illustrative"?:boolean,"xLabel"?:string,"series":[{"name":string,"points":[{"x":string,"y":number}]}]} (1-3 series)
- pie: {"type":"pie","title":string,"illustrative"?:boolean,"data":[{"label":string,"value":number}]} (2-6 slices)
- matrix (2x2): {"type":"matrix","title":string,"x":{"label":string,"low":string,"high":string},"y":{"label":string,"low":string,"high":string},"quadrants":[{"title":string,"text"?:string} x4: top-left, top-right, bottom-left, bottom-right]}
- flow (steps in order): {"type":"flow","title":string,"steps":[{"title":string,"text"?:string}]} (2-7)
- cycle (a loop): {"type":"cycle","title":string,"steps":[...]} (3-6)
- pyramid (top first): {"type":"pyramid","title":string,"levels":[{"title":string,"text"?:string}]} (2-6)
- compare (table): {"type":"compare","title":string,"columns":[string],"rows":[{"label":string,"cells":[string, one per column]}]}
- timeline: {"type":"timeline","title":string,"events":[{"when":string,"title":string,"text"?:string}]} (2-8)
Charts use real numbers only when they are well documented and you are sure of them; otherwise use made-up numbers to show a shape or idea and set "illustrative": true. Never invent statistics presented as fact. Refer to the visual naturally in your words ("Here's how the four options sit..."), never as code or JSON.`.trim();

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
  z.object({
    type: z.literal('area'),
    title,
    unit: text(16).optional(),
    illustrative: z.boolean().optional(),
    xLabel: text(30).optional(),
    series: z
      .array(z.object({ name: text(30), points: z.array(z.object({ x: text(16), y: z.number().finite() })).min(2).max(12) }))
      .min(1)
      .max(3),
  }),
  z.object({
    type: z.literal('scatter'),
    title,
    illustrative: z.boolean().optional(),
    xLabel: text(30),
    yLabel: text(30),
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), label: text(30).optional() })).min(2).max(40),
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
  /** A picture generated from a description (an illustration, a scene, a metaphor made visible). */
  z.object({ type: z.literal('image'), title, prompt: text(600), alt: text(200) }),
]);
export type Visual = z.infer<typeof visualSchema>;
export const VISUAL_TYPES = ['bar', 'line', 'area', 'scatter', 'pie', 'matrix', 'flow', 'cycle', 'pyramid', 'compare', 'timeline', 'image'] as const;

/** A chart a slide can carry (drawn as a native, editable PowerPoint chart). */
const slideChart = z.object({
  type: z.enum(['bar', 'line', 'pie']),
  data: z.array(datum).min(2).max(10),
  unit: text(16).optional(),
});
const docSection = z.object({ heading: text(90), paragraphs: z.array(text(1500)).max(8).optional(), bullets: z.array(text(300)).max(12).optional() });

/**
 * Files the coach can make for the listener to download: a PDF (a handout, worksheet, summary or plan), an
 * Excel workbook (a tracker, plan, scorecard or budget) or a PowerPoint deck (slides to present or study).
 */
export const documentSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('pdf'), title: text(90), subtitle: text(160).optional(), sections: z.array(docSection).min(1).max(12) }),
  z.object({
    format: z.literal('xlsx'),
    title: text(90),
    sheets: z
      .array(
        z.object({
          name: text(31),
          columns: z.array(text(40)).min(1).max(12),
          rows: z.array(z.array(z.union([z.string().max(300), z.number().finite(), z.null()]))).max(200),
        }),
      )
      .min(1)
      .max(5),
  }),
  z.object({
    format: z.literal('pptx'),
    title: text(90),
    subtitle: text(160).optional(),
    slides: z
      .array(z.object({ title: text(90), bullets: z.array(text(200)).max(7).optional(), notes: text(1500).optional(), chart: slideChart.optional() }))
      .min(1)
      .max(15),
  }),
]);
export type CoachDocument = z.infer<typeof documentSchema>;
export const DOCUMENT_LABEL = { pdf: 'PDF', xlsx: 'Excel', pptx: 'PowerPoint' } as const;

const BLOCK = /```visual\s*\n?([\s\S]*?)```/g;
const DOC_BLOCK = /```document\s*\n?([\s\S]*?)```/g;

/**
 * Splits a coach reply into its words and the visuals in it. A visual that isn't valid is left out (never
 * shown as code). While a reply is still streaming, an unfinished visual is hidden and `drawing` is set.
 */
export function splitVisuals(content: string): { text: string; visuals: Visual[]; documents: CoachDocument[]; drawing: boolean } {
  const visuals: Visual[] = [];
  const documents: CoachDocument[] = [];
  let rest = content.replace(DOC_BLOCK, (_m, body: string) => {
    try {
      const parsed = documentSchema.safeParse(JSON.parse(body));
      // A sheet's rows are cut to its columns; a valid file is offered for download.
      if (parsed.success) {
        const d = parsed.data;
        if (d.format === 'xlsx') for (const sh of d.sheets) sh.rows = sh.rows.map((r) => r.slice(0, sh.columns.length));
        documents.push(d);
      }
    } catch {
      /* not a document */
    }
    return '\n';
  });
  rest = rest.replace(BLOCK, (_m, body: string) => {
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
  const open = rest.search(/```(visual|document)/);
  const drawing = open >= 0;
  if (drawing) rest = rest.slice(0, open);
  return { text: rest.replace(/\n{3,}/g, '\n\n').trim(), visuals, documents, drawing };
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
- area: same shape as line, for a total or quantity that builds over time
- scatter: {"type":"scatter","title":string,"illustrative"?:boolean,"xLabel":string,"yLabel":string,"points":[{"x":number,"y":number,"label"?:string}]} (2-40 points: how two things relate)
- pie: {"type":"pie","title":string,"illustrative"?:boolean,"data":[{"label":string,"value":number}]} (2-6 slices)
- matrix (2x2): {"type":"matrix","title":string,"x":{"label":string,"low":string,"high":string},"y":{"label":string,"low":string,"high":string},"quadrants":[{"title":string,"text"?:string} x4: top-left, top-right, bottom-left, bottom-right]}
- flow (steps in order): {"type":"flow","title":string,"steps":[{"title":string,"text"?:string}]} (2-7)
- cycle (a loop): {"type":"cycle","title":string,"steps":[...]} (3-6)
- pyramid (top first): {"type":"pyramid","title":string,"levels":[{"title":string,"text"?:string}]} (2-6)
- compare (table): {"type":"compare","title":string,"columns":[string],"rows":[{"label":string,"cells":[string, one per column]}]}
- timeline: {"type":"timeline","title":string,"events":[{"when":string,"title":string,"text"?:string}]} (2-8)
- image: {"type":"image","title":string,"prompt":string,"alt":string} for a picture that helps an idea stick (a scene, a metaphor made visible, an illustrated concept). "prompt" describes the picture in detail for an illustrator; "alt" describes it in a sentence for someone who can't see it. Never real, identifiable people, logos or text-heavy images; use a chart or diagram for anything with data or labels.
Charts use real numbers only when they are well documented and you are sure of them; otherwise use made-up numbers to show a shape or idea and set "illustrative": true. Never invent statistics presented as fact. Refer to the visual naturally in your words ("Here's how the four options sit..."), never as code or JSON.

Files: when the listener asks for something to keep, print, fill in or present (or it would clearly help: a one-page summary, a worksheet, a habit tracker, a plan, a scorecard, a short deck), make a downloadable file as a fenced block:
\`\`\`document
{"format": "pdf", ...}
\`\`\`
- pdf (handout, worksheet, summary, plan): {"format":"pdf","title":string,"subtitle"?:string,"sections":[{"heading":string,"paragraphs"?:[string],"bullets"?:[string]}]} (1-12 sections; for a worksheet, use prompts with space to answer)
- xlsx (tracker, plan, scorecard, budget, comparison): {"format":"xlsx","title":string,"sheets":[{"name":string,"columns":[string],"rows":[[string | number | null]]}]} (1-5 sheets, at most 200 rows; leave cells null for the listener to fill in)
- pptx (slides to present or study): {"format":"pptx","title":string,"subtitle"?:string,"slides":[{"title":string,"bullets"?:[string],"notes"?:string,"chart"?:{"type":"bar"|"line"|"pie","data":[{"label":string,"value":number}],"unit"?:string}}]} (1-15 slides, up to 6 short bullets each; speaker notes say what to explain)
At most one file per reply. Ground its content in the episode, the books and the conversation; never invent facts, quotes or statistics. Say in a sentence what the file is and how to use it.`.trim();

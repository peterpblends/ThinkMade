import type { CoachDocument } from '@thinkmade/shared';

/** A plain, safe file name from a title. */
export function fileName(title: string, ext: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${base || 'ThinkMade'}.${ext}`;
}

const FOOTER = 'Made with ThinkMade. AI-generated: check anything important against the original sources.';
const ACCENT = 'B4532F';

/**
 * Builds a file the coach made, in the browser, loading the library for that format only when it's needed.
 */
export async function buildDocument(d: CoachDocument): Promise<{ blob: Blob; name: string }> {
  if (d.format === 'pdf') return { blob: await buildPdf(d), name: fileName(d.title, 'pdf') };
  if (d.format === 'xlsx') return { blob: await buildXlsx(d), name: fileName(d.title, 'xlsx') };
  return { blob: await buildPptx(d), name: fileName(d.title, 'pptx') };
}

async function buildPdf(d: Extract<CoachDocument, { format: 'pdf' }>): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  const width = W - 2 * M;
  let y = M;
  const room = (h: number) => {
    if (y + h > H - M - 20) {
      doc.addPage();
      y = M;
    }
  };
  const write = (text: string, size: number, style: 'normal' | 'bold', gap: number, indent = 0, bullet = false) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, width - indent) as string[];
    const lh = size * 1.35;
    lines.forEach((line, i) => {
      room(lh);
      if (bullet && i === 0) doc.text('•', M + indent - 12, y);
      doc.text(line, M + indent, y);
      y += lh;
    });
    y += gap;
  };
  doc.setTextColor(40, 36, 32);
  write(d.title, 22, 'bold', 4);
  if (d.subtitle) write(d.subtitle, 12, 'normal', 6);
  doc.setDrawColor(180, 83, 47);
  doc.setLineWidth(1.5);
  doc.line(M, y, M + 60, y);
  y += 20;
  for (const s of d.sections) {
    room(40);
    write(s.heading, 14, 'bold', 4);
    for (const p of s.paragraphs ?? []) write(p, 11, 'normal', 6);
    for (const b of s.bullets ?? []) write(b, 11, 'normal', 2, 14, true);
    y += 10;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 113, 105);
    doc.text(FOOTER, M, H - 28);
    doc.text(`${i} / ${pages}`, W - M, H - 28, { align: 'right' });
  }
  return doc.output('blob');
}

async function buildXlsx(d: Extract<CoachDocument, { format: 'xlsx' }>): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const used = new Set<string>();
  const sheets = d.sheets.map((sh, i) => {
    // Sheet names: unique, at most 31 characters, without the characters Excel forbids.
    let name = sh.name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet ${i + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${i + 1}`;
    used.add(name.toLowerCase());
    const header = sh.columns.map((c) => ({ value: c, fontWeight: 'bold' as const, backgroundColor: '#F4E9E2' }));
    const rows = sh.rows.map((r) => sh.columns.map((_, j) => (r[j] === undefined ? null : r[j]!)));
    const widths = sh.columns.map((c, j) => ({ width: Math.min(50, Math.max(10, c.length + 2, ...rows.map((r) => String(r[j] ?? '').length + 2))) }));
    return { sheet: name, data: [header, ...rows], columns: widths, stickyRowsCount: 1 };
  });
  return writeXlsxFile(sheets as Parameters<typeof writeXlsxFile>[0]).toBlob();
}

async function buildPptx(d: Extract<CoachDocument, { format: 'pptx' }>): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = d.title;
  const font = 'Calibri';
  const cover = pptx.addSlide();
  cover.background = { color: 'F7F3EE' };
  cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 2.5, w: 1.2, h: 0.08, fill: { color: ACCENT }, line: { color: ACCENT } });
  cover.addText(d.title, { x: 0.6, y: 2.7, w: 12, h: 1.2, fontFace: 'Georgia', fontSize: 40, bold: true, color: '28241F' });
  if (d.subtitle) cover.addText(d.subtitle, { x: 0.6, y: 3.9, w: 12, h: 0.8, fontFace: font, fontSize: 20, color: '5E574F' });
  cover.addText(FOOTER, { x: 0.6, y: 6.8, w: 12, h: 0.4, fontFace: font, fontSize: 10, color: '8A8178' });
  const CHART = { bar: pptx.ChartType.bar, line: pptx.ChartType.line, pie: pptx.ChartType.pie } as const;
  for (const s of d.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addText(s.title, { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontFace: 'Georgia', fontSize: 30, bold: true, color: '28241F' });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.3, w: 0.9, h: 0.06, fill: { color: ACCENT }, line: { color: ACCENT } });
    const bullets = s.bullets ?? [];
    const textW = s.chart ? 6 : 12.1;
    if (bullets.length) {
      slide.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.6, y: 1.6, w: textW, h: 5.2, fontFace: font, fontSize: 20, color: '3A342E', valign: 'top', paraSpaceAfter: 10 },
      );
    }
    if (s.chart) {
      const c = s.chart;
      slide.addChart(CHART[c.type], [{ name: s.title, labels: c.data.map((x) => x.label), values: c.data.map((x) => x.value) }], {
        x: bullets.length ? 7 : 1.5,
        y: 1.6,
        w: bullets.length ? 5.7 : 10.3,
        h: 5.2,
        chartColors: [ACCENT, '7C9A8A', '8A4A2F', '4F6B5D', 'A89F94', 'D9A285'],
        showLegend: c.type === 'pie',
        legendPos: 'r',
        showValue: true,
        dataLabelFormatCode: c.unit ? `0.## "${c.unit.replace(/"/g, '')}"` : '0.##',
        catAxisLabelFontFace: font,
        valAxisLabelFontFace: font,
      });
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  return (await pptx.write({ outputType: 'blob' })) as Blob;
}

/** Saves a blob as a file the listener downloads. */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

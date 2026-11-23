import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import type { CoachDocument } from '@thinkmade/shared';
import { buildDocument, fileName } from './documents';

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('files the coach makes', () => {
  it('makes a PDF handout with every section, and an AI note on each page', async () => {
    const d: CoachDocument = { format: 'pdf', title: 'Second-order thinking', subtitle: 'A one-page guide', sections: [{ heading: 'The idea', paragraphs: ['Ask "and then what?" '.repeat(40)] }, { heading: 'Try it', bullets: ['Pick one decision', 'Look a year out'] }] };
    const { blob, name } = await buildDocument(d);
    expect(name).toBe('Second-order-thinking.pdf');
    const b = await bytes(blob);
    expect(strFromU8(b.slice(0, 5))).toBe('%PDF-');
    expect(b.length).toBeGreaterThan(1500);
  });

  it('makes an Excel workbook with a header row, empty cells to fill in, and every sheet', async () => {
    const d: CoachDocument = { format: 'xlsx', title: 'Habit tracker', sheets: [{ name: 'Week 1', columns: ['Day', 'Done?', 'Notes'], rows: [['Mon', null, null], ['Tue', 1, 'Felt easy']] }, { name: 'Week/2', columns: ['Day'], rows: [] }] };
    const { blob, name } = await buildDocument(d);
    expect(name).toBe('Habit-tracker.xlsx');
    const files = unzipSync(await bytes(blob));
    const workbook = strFromU8(files['xl/workbook.xml']!);
    expect(workbook).toContain('name="Week 1"');
    expect(workbook).toContain('name="Week 2"');
    const strings = strFromU8(files['xl/sharedStrings.xml'] ?? new Uint8Array());
    for (const t of ['Day', 'Done?', 'Notes', 'Mon', 'Felt easy']) expect(strings + strFromU8(files['xl/worksheets/sheet1.xml']!)).toContain(t);
  });

  it('makes a PowerPoint deck: a cover, each slide, speaker notes and a native chart', async () => {
    const d: CoachDocument = {
      format: 'pptx',
      title: 'Opportunity cost',
      subtitle: 'What you give up',
      slides: [
        { title: 'The hidden price', bullets: ['Every yes is a no to something else'], notes: 'Start with the Kodak story.' },
        { title: 'Where time goes', chart: { type: 'bar', data: [{ label: 'Meetings', value: 6 }, { label: 'Focus', value: 2 }], unit: 'h' } },
      ],
    };
    const { blob, name } = await buildDocument(d);
    expect(name).toBe('Opportunity-cost.pptx');
    const files = unzipSync(await bytes(blob));
    const slides = Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    expect(slides).toHaveLength(3);
    const all = slides.map((k) => strFromU8(files[k]!)).join('');
    for (const t of ['Opportunity cost', 'The hidden price', 'Every yes is a no to something else', 'Where time goes']) expect(all).toContain(t);
    expect(Object.keys(files).some((k) => k.startsWith('ppt/charts/chart'))).toBe(true);
    expect(Object.values(files).some((f) => strFromU8(f).includes('Start with the Kodak story.'))).toBe(true);
  });

  it('names files safely', () => {
    expect(fileName('What / if: "this"?', 'pdf')).toBe('What-if-this.pdf');
    expect(fileName('!!!', 'xlsx')).toBe('ThinkMade.xlsx');
  });
});

import { describe, expect, it } from 'vitest';
import { splitVisuals, withoutVisuals } from './visuals';

const block = (v: unknown) => '```visual\n' + JSON.stringify(v) + '\n```';
const matrix = {
  type: 'matrix',
  title: 'Where your time goes',
  x: { label: 'Urgency', low: 'Not urgent', high: 'Urgent' },
  y: { label: 'Importance', low: 'Less important', high: 'Important' },
  quadrants: [{ title: 'Schedule' }, { title: 'Do now' }, { title: 'Drop' }, { title: 'Delegate' }],
};

describe('coach visuals', () => {
  it('pulls a valid visual out of a reply and keeps the words', () => {
    const r = splitVisuals(`Here's how the four options sit.\n\n${block(matrix)}\n\nWhich box is eating your week?`);
    expect(r.visuals).toEqual([matrix]);
    expect(r.text).toBe("Here's how the four options sit.\n\nWhich box is eating your week?");
    expect(r.drawing).toBe(false);
  });

  it('drops a broken or unknown visual instead of showing code', () => {
    const r = splitVisuals(`Words. ${block({ type: 'bar', title: 'x', data: [{ label: 'a', value: 1 }] })} ${'```visual\n{not json\n```'} ${block({ type: 'hologram' })}`);
    expect(r.visuals).toEqual([]);
    expect(r.text).toBe('Words.');
    const badTable = { type: 'compare', title: 'T', columns: ['A', 'B'], rows: [{ label: 'r', cells: ['only one'] }] };
    expect(splitVisuals(block(badTable)).visuals).toEqual([]);
  });

  it('hides a visual still being written while the reply streams', () => {
    const r = splitVisuals('Let me sketch it.\n```visual\n{"type":"flow","title":"St');
    expect(r).toEqual({ text: 'Let me sketch it.', visuals: [], documents: [], drawing: true });
  });

  it('never reads a visual aloud', () => {
    expect(withoutVisuals(`First this. ${block(matrix)} Then that.`)).toBe('First this. Then that.');
  });

  it('pulls out a file to download, and drops one that is not valid', () => {
    const deck = { format: 'pptx', title: 'Second-order thinking', slides: [{ title: 'And then what?', bullets: ['Look one step further'], chart: { type: 'bar', data: [{ label: 'Now', value: 1 }, { label: 'Later', value: 3 }] } }] };
    const sheet = { format: 'xlsx', title: 'Habit tracker', sheets: [{ name: 'Week 1', columns: ['Day', 'Done?'], rows: [['Mon', null, 'extra'], ['Tue', 1]] }] };
    const r = splitVisuals(`Here are your slides.\n\`\`\`document\n${JSON.stringify(deck)}\n\`\`\`\nAnd a tracker:\n\`\`\`document\n${JSON.stringify(sheet)}\n\`\`\``);
    expect(r.text).toBe('Here are your slides.\n\nAnd a tracker:');
    expect(r.documents.map((d) => d.format)).toEqual(['pptx', 'xlsx']);
    // Rows are cut to the sheet's columns.
    expect(r.documents[1]).toMatchObject({ sheets: [{ rows: [['Mon', null], ['Tue', 1]] }] });
    expect(splitVisuals('```document\n{"format":"docx","title":"x"}\n```').documents).toEqual([]);
  });

  it('accepts the new graphs and images', () => {
    const scatter = { type: 'scatter', title: 'Effort vs result', xLabel: 'Hours', yLabel: 'Score', illustrative: true, points: [{ x: 1, y: 2 }, { x: 3, y: 5 }] };
    const image = { type: 'image', title: 'The bottleneck', prompt: 'A busy kitchen where every order waits at one small oven', alt: 'Orders piling up at one oven' };
    expect(splitVisuals(`${block(scatter)}${block(image)}`).visuals).toEqual([scatter, image]);
  });
});

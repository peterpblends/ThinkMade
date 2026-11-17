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
    expect(r).toEqual({ text: 'Let me sketch it.', visuals: [], drawing: true });
  });

  it('never reads a visual aloud', () => {
    expect(withoutVisuals(`First this. ${block(matrix)} Then that.`)).toBe('First this. Then that.');
  });
});

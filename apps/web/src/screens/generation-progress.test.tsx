import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ProgressView, type GenerationStatus } from './generation-progress';

const base: GenerationStatus = {
  id: 'g1',
  status: 'running',
  label: 'Connecting relevant thinking',
  steps: [
    { label: 'Understanding your topic', state: 'done' },
    { label: 'Connecting relevant thinking', state: 'active' },
    { label: 'Building your podcasts', state: 'pending' },
    { label: 'Preparing the audio', state: 'pending' },
  ],
  error: null,
  retrying: false,
  seriesId: null,
  episodes: [],
};

describe('ProgressView', () => {
  it('lists the real steps without any percentage', () => {
    render(<MemoryRouter><ProgressView data={base} onCancel={() => {}} /></MemoryRouter>);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Understanding your topic'),
      expect.stringContaining('Connecting relevant thinking'),
      expect.stringContaining('Building your podcasts'),
      expect.stringContaining('Preparing the audio'),
    ]);
    expect(document.body.textContent).not.toMatch(/%/);
    expect(screen.getByText(/you can leave this page/i)).toBeInTheDocument();
  });

  it('links each finished episode as soon as it is ready', () => {
    render(
      <MemoryRouter>
        <ProgressView data={{ ...base, label: 'Preparing the audio', seriesId: 's1', episodes: [{ id: 'e1', number: 1, title: 'Opportunity cost', status: 'ready' }, { id: 'e2', number: 2, title: 'Inversion', status: 'synthesizing' }] }} onCancel={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /listen to episode 1/i })).toHaveAttribute('href', '/series/s1#e1');
    expect(screen.queryByRole('link', { name: /episode 2/i })).toBeNull();
  });

  it('shows an honest failure message', () => {
    render(<MemoryRouter><ProgressView data={{ ...base, status: 'failed', error: "Podcast generation isn't configured yet: Groq is selected but GROQ_API_KEY is not set." }} onCancel={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent(/isn't configured yet/);
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminReport, type Report } from './report';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const person = (id: string, email: string, over: object = {}) => ({
  id, name: '', email, requests: 1, series: 1, episodes: 1, minutes: 10, failed: 0, partial: 0, cancelled: 0, ratings: 0, averageStars: null, lastRequestAt: '2026-10-25T10:00:00Z', ...over,
});

const REPORT: Report = {
  days: 30,
  totals: { people: 2, requests: 3, episodes: 2, errors: 1, ratings: 1, averageStars: 4 },
  people: [person('u1', 'ann@example.com', { requests: 2, failed: 1, ratings: 1, averageStars: 4 }), person('u2', 'bo@example.com')],
  generation: [
    { id: 'j1', userId: 'u1', email: 'ann@example.com', topic: 'Habits', seriesTitle: 'Habit Loops', status: 'succeeded', stage: 'publish', episodesRequested: 1, episodesReady: 1, episodesRejected: 0, tokens: 1200, createdAt: '2026-10-24T10:00:00Z', finishedAt: '2026-10-24T10:10:00Z' },
    { id: 'j2', userId: 'u1', email: 'ann@example.com', topic: 'Broken', seriesTitle: null, status: 'failed', stage: 'script', episodesRequested: 3, episodesReady: 0, episodesRejected: 0, tokens: 0, createdAt: '2026-10-25T10:00:00Z', finishedAt: null },
    { id: 'j3', userId: 'u2', email: 'bo@example.com', topic: 'Focus', seriesTitle: 'Deep Focus', status: 'succeeded', stage: 'publish', episodesRequested: 1, episodesReady: 1, episodesRejected: 0, tokens: 900, createdAt: '2026-10-23T10:00:00Z', finishedAt: null },
  ],
  errors: [{ jobId: 'j2', userId: 'u1', email: 'ann@example.com', seriesTitle: null, topic: 'Broken', status: 'failed', stage: 'script', error: 'The language model service failed repeatedly.', createdAt: '2026-10-25T10:00:00Z' }],
  ratings: [{ userId: 'u1', email: 'ann@example.com', episodeId: 'e1', episodeTitle: 'Cue, Routine, Reward', seriesTitle: 'Habit Loops', stars: 4, ratedAt: '2026-10-25T11:00:00Z' }],
};

afterEach(() => vi.unstubAllGlobals());

function renderReport() {
  const fetch = vi.fn(async (_url: string) => json(REPORT));
  vi.stubGlobal('fetch', fetch);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminReport />
    </QueryClientProvider>,
  );
  return fetch;
}

describe('AdminReport', () => {
  it('shows totals and each person, then what they generated, their errors and their ratings', async () => {
    renderReport();
    expect(await screen.findByRole('button', { name: /ann@example.com/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Totals' })).getByText('Errors').nextSibling).toHaveTextContent('1');

    await userEvent.click(screen.getByRole('button', { name: /ann@example.com/ }));
    expect(screen.getByRole('button', { name: /^Generated/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Habit Loops')).toBeInTheDocument();
    expect(screen.queryByText('Deep Focus')).not.toBeInTheDocument(); // filtered to Ann

    await userEvent.click(screen.getByRole('button', { name: /^Errors/ }));
    expect(screen.getByText('The language model service failed repeatedly.')).toBeInTheDocument();
    expect(screen.getByText(/Stopped at: script/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Ratings/ }));
    expect(screen.getByText('Cue, Routine, Reward')).toBeInTheDocument();
    expect(screen.getByLabelText('4 out of 5 stars')).toBeInTheDocument();
  });

  it('restarts a podcast that errored out and says so', async () => {
    const fetch = renderReport();
    await screen.findByRole('button', { name: /ann@example.com/ });
    await userEvent.click(screen.getByRole('button', { name: /^Errors/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Restart Broken' }));
    expect(fetch.mock.calls.some((c) => c[0] === '/api/admin/generations/j2/restart')).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent('Restarted “Broken”. It is back in the queue');
    // Finished podcasts have nothing to restart.
    await userEvent.click(screen.getByRole('button', { name: /^Generated/ }));
    expect(screen.queryByRole('button', { name: 'Restart Habit Loops' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart Broken' })).toBeInTheDocument();
  });

  it('asks the API for the chosen period', async () => {
    const fetch = renderReport();
    await screen.findByRole('button', { name: /ann@example.com/ });
    await userEvent.selectOptions(screen.getByLabelText('Period'), '90');
    expect(fetch.mock.calls.map((c) => c[0])).toContain('/api/admin/report?days=90');
  });
});

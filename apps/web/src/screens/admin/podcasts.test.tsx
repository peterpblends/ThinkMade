import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider } from '../../player/player-context';
import { AdminPodcasts, type AdminPodcast } from './podcasts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PODCAST: AdminPodcast = {
  id: 's1',
  title: 'Negotiating a Raise',
  status: 'ready',
  visibility: 'private',
  createdAt: '2026-11-01T10:00:00Z',
  owner: { id: 'u1', email: 'ann@example.com' },
  episodeCount: 2,
  readyCount: 2,
  job: { id: 'j1', status: 'succeeded', error: null },
};
const SERIES = {
  id: 's1', title: 'Negotiating a Raise', description: '', status: 'ready', visibility: 'private', publicSlug: null, isOwner: false, createdAt: '2026-11-01T10:00:00Z',
  episodes: [1, 2].map((n) => ({ id: `e${n}`, seriesId: 's1', number: n, title: `Episode ${n}`, description: '', status: 'ready', durationSeconds: 600, audioUrl: `/api/episodes/e${n}/audio`, primaryModel: null, hosts: [] })),
};

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      if (u.startsWith('/api/admin/podcasts?')) return json({ podcasts: [PODCAST], more: false });
      if (u === '/api/series/s1') return json(SERIES);
      if (u.endsWith('/regenerate')) return json({ jobId: 'j2', status: 'queued' }, 202);
      if (init?.method === 'DELETE') return json({ deleted: true });
      return json({});
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PlayerProvider sendProgress={async () => {}}>
          <AdminPodcasts />
        </PlayerProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('AdminPodcasts', () => {
  it("lists everyone's podcasts with their owner, and opens, regenerates and deletes them", async () => {
    const calls = setup();
    expect(await screen.findByRole('link', { name: 'Negotiating a Raise' })).toHaveAttribute('href', '/series/s1');
    expect(screen.getByText(/ann@example.com/)).toBeInTheDocument();
    expect(screen.getByText('2 of 2 episodes ready')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Episodes' }));
    expect(await screen.findByRole('button', { name: 'Play episode 1' })).toBeEnabled();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate episode 2' }));
    expect(calls.find((c) => c.url.endsWith('/regenerate'))?.body).toEqual({ episodeIds: ['e2'] });
    expect(await screen.findByText(/the episode is being made again/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Regenerate$/ }));
    expect(calls.filter((c) => c.url.endsWith('/regenerate')).at(-1)?.body).toEqual({});

    vi.spyOn(window, 'prompt').mockReturnValue('Requested by the owner');
    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(calls.find((c) => c.method === 'DELETE')).toMatchObject({ url: '/api/admin/podcasts/s1', body: { reason: 'Requested by the owner' } });
    expect(await screen.findByText(/was deleted/)).toBeInTheDocument();
  });

  it('searches by title or owner', async () => {
    const calls = setup();
    await screen.findByRole('link', { name: 'Negotiating a Raise' });
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'ann');
    expect(calls.some((c) => c.url.includes('q=ann'))).toBe(true);
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeriesDetail } from '../lib/types';
import { ArtworkPicker } from './artwork-picker';
import { coverUrl } from './show-art';

const series = (artwork: SeriesDetail['artwork']): SeriesDetail => ({
  id: 's1',
  title: 'Habit Loops',
  description: '',
  status: 'ready',
  visibility: 'private',
  publicSlug: null,
  isOwner: true,
  createdAt: '2026-11-01T00:00:00Z',
  episodes: [],
  ...(artwork ? { artwork } : {}),
});

afterEach(() => vi.unstubAllGlobals());

describe('choosing show artwork', () => {
  it('makes new artwork, shows how many are left, and goes back to the original', async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    let art = { selected: 0, count: 1, regenerationsLeft: 3 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/artwork')) {
          const body = init?.body ? JSON.parse(String(init.body)) : null;
          calls.push({ method: init?.method ?? 'GET', body });
          art = init?.method === 'POST' ? { selected: art.count, count: art.count + 1, regenerationsLeft: art.regenerationsLeft - 1 } : { ...art, selected: (body as { selected: number }).selected };
          return new Response(JSON.stringify(art), { status: init?.method === 'POST' ? 201 : 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const qc = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ArtworkPicker s={series(art)} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change artwork' }));
    expect(screen.getByRole('radio', { name: 'Original artwork' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/3 new designs left/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /make new artwork/i }));
    await waitFor(() => expect(calls).toEqual([{ method: 'POST', body: null }]));
    // Every cover of the show now asks for the new version.
    await waitFor(() => expect(coverUrl('s1', 'Habit Loops')).toMatch(/&a=1$/));
    rerender(
      <QueryClientProvider client={qc}>
        <ArtworkPicker s={series(art)} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('radio', { name: 'New artwork 1' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/2 new designs left/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Original artwork' }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ method: 'PUT', body: { selected: 0 } }));
    await waitFor(() => expect(coverUrl('s1', 'Habit Loops')).toMatch(/&a=0$/));
  });

  it('says when no new designs are left but keeps every version to choose from', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ArtworkPicker s={series({ selected: 2, count: 4, regenerationsLeft: 0 })} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change artwork' }));
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /make new artwork/i })).toBeDisabled();
    expect(screen.getByText(/switch between the ones you have/)).toBeInTheDocument();
  });
});

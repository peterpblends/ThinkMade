import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@thinkmade/shared';
import { AdminSettingsScreen } from './settings';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('AdminSettingsScreen rollback', () => {
  it('shows an error when restoring a version fails instead of failing silently', async () => {
    vi.stubGlobal('confirm', () => true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/admin/settings') return json(200, { version: 2, settings: DEFAULT_APP_SETTINGS });
        if (url === '/api/admin/settings/versions')
          return json(200, {
            versions: [
              { version: 2, createdAt: '2026-10-22T00:00:00Z', note: null, active: true },
              { version: 1, createdAt: '2026-10-21T00:00:00Z', note: null, active: false },
            ],
          });
        if (url === '/api/admin/settings/rollback') return json(404, { error: 'version_not_found' });
        return json(404, {});
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AdminSettingsScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // The form lists every voice (about 80) with its casting settings, which is slow to render under load.
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }, { timeout: 10_000 }));
    expect(await screen.findByRole('alert', {}, { timeout: 10_000 })).toHaveTextContent(/could not restore version 1/i);
  }, 25_000);
});

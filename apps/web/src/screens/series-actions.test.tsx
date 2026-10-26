import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DeleteSeries, sameTitle } from './series-actions';

describe('deleting a series', () => {
  it('matches the typed title regardless of case, punctuation and spacing', () => {
    expect(sameTitle('heart  faith teen dating in a digital world', 'Heart & Faith: Teen Dating in a Digital World')).toBe(true);
    expect(sameTitle('Heart & Faith', 'Heart & Faith: Teen Dating in a Digital World')).toBe(false);
    expect(sameTitle('  ', '!!')).toBe(false);
  });

  it('only allows deleting once the series title is typed', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <DeleteSeries id="s1" title="Heart & Faith" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete this series' }));
    const confirm = screen.getByRole('button', { name: 'Delete forever' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /type the series title/i }), 'heart and faith');
    expect(confirm).toBeDisabled();
    await userEvent.clear(screen.getByRole('textbox', { name: /type the series title/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /type the series title/i }), 'heart & faith');
    expect(confirm).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('button', { name: 'Delete forever' })).toBeNull();
  });
});

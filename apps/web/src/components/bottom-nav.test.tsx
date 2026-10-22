import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BottomNav } from './bottom-nav';

describe('BottomNav', () => {
  it('renders exactly Create, Discover and My Library in that order', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Create', 'Discover', 'My Library']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/', '/discover', '/library']);
  });

  it('marks the current tab', () => {
    render(
      <MemoryRouter initialEntries={['/library']}>
        <BottomNav />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'My Library' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Create' })).not.toHaveAttribute('aria-current');
  });
});

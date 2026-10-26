import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PodcastList } from './library';
import type { SeriesListItem } from '../lib/types';

const series = (over: Partial<SeriesListItem>): SeriesListItem => ({
  id: 's1', title: 'Heart & Faith', description: 'A lively, faith-centered podcast.', status: 'ready', visibility: 'private', createdAt: '2026-10-25T00:00:00Z',
  episodeCount: 3, readyCount: 3, totalSeconds: 2700, ...over,
});

describe('My Podcasts', () => {
  it('shows podcasts being made as the same cards as finished ones, once each', () => {
    render(
      <MemoryRouter>
        <PodcastList
          series={[series({ id: 'new', title: 'Teen Dating in a Digital World', status: 'generating', readyCount: 1, totalSeconds: 600 }), series({})]}
          generations={[
            { id: 'g0', status: 'running', label: 'Understanding your topic', topic: `Create an engaging, relatable Christian podcast for teenage girls ages 15–19 about Christian dating, relationships, and navigating long-distance relationships, including dating someone from another country.`, seriesId: null },
            { id: 'g1', status: 'running', label: 'Preparing the audio', topic: 'Long prompt', seriesId: 'new' },
          ]}
        />
      </MemoryRouter>,
    );
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    // Not titled yet: a short excerpt of the request, not the whole prompt.
    expect(within(cards[0]!).getByText('Creating your podcast')).toBeInTheDocument();
    expect(cards[0]!.textContent).toMatch(/…/);
    expect(cards[0]!.textContent!.length).toBeLessThan(220);
    expect(within(cards[0]!).getByRole('link')).toHaveAttribute('href', '/generations/g0');
    // Being made: its title and description, with the current step and progress.
    expect(cards[1]!).toHaveTextContent('Teen Dating in a Digital World');
    expect(cards[1]!).toHaveTextContent('Preparing the audio…');
    expect(cards[1]!).toHaveTextContent('1 of 3 ready');
    expect(within(cards[1]!).getByRole('link')).toHaveAttribute('href', '/series/new');
    // Finished.
    expect(cards[2]!).toHaveTextContent('3 episodes · 45 min');
    expect(screen.queryByText('Long prompt')).toBeNull();
  });

  it('offers to try again when a podcast could not be finished', () => {
    render(
      <MemoryRouter>
        <PodcastList series={[series({ status: 'failed', readyCount: 0 })]} generations={[{ id: 'g9', status: 'failed', label: 'Building your podcasts', topic: 'x', seriesId: 's1' }]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/couldn't be finished/i)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/generations/g9');
  });

  it('says a podcast was cancelled rather than failed', () => {
    render(
      <MemoryRouter>
        <PodcastList series={[series({ status: 'failed', readyCount: 0, episodeCount: 0 })]} generations={[{ id: 'g2', status: 'cancelled', label: 'Building your podcasts', topic: 'x', seriesId: 's1' }]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't be finished/i)).toBeNull();
  });
});

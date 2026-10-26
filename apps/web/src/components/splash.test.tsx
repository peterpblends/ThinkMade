import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Splash, SPLASH_FADE_MS, SPLASH_MS } from './splash';

describe('opening splash', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('shows the logo, name and tagline once per visit, then gets out of the way', () => {
    const { unmount } = render(<Splash />);
    expect(screen.getByTestId('splash')).toHaveTextContent('ThinkMade');
    expect(screen.getByTestId('splash')).toHaveTextContent('Better Thinking. Made Personal.');
    act(() => void vi.advanceTimersByTime(SPLASH_MS));
    act(() => void vi.advanceTimersByTime(SPLASH_FADE_MS));
    expect(screen.queryByTestId('splash')).toBeNull();
    unmount();
    // Same visit: not again.
    render(<Splash />);
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it('can be skipped with a tap', () => {
    render(<Splash />);
    fireEvent.click(screen.getByTestId('splash'));
    act(() => void vi.advanceTimersByTime(SPLASH_FADE_MS));
    expect(screen.queryByTestId('splash')).toBeNull();
  });
});

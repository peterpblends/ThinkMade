import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldShowSplash, Splash, SPLASH_FADE_MS, SPLASH_MS } from './splash';

/** The public settings answer with the administrator's splash length (or never, when `seconds` is undefined). */
function stubSettings(seconds?: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      seconds === undefined
        ? new Promise<Response>(() => {})
        : Promise.resolve(new Response(JSON.stringify({ podcast: {}, media: {}, splash: { seconds } }), { status: 200, headers: { 'content-type': 'application/json' } })),
    ),
  );
}

const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('opening splash', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.useFakeTimers();
    stubSettings();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("follows the administrator's length, and remembers it for the next visit", async () => {
    stubSettings(5);
    render(<Splash />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    act(() => void vi.advanceTimersByTime(SPLASH_MS + SPLASH_FADE_MS));
    expect(screen.getByTestId('splash')).toBeInTheDocument(); // still showing: 5 seconds were asked for
    act(() => void vi.advanceTimersByTime(5000 - SPLASH_MS - SPLASH_FADE_MS));
    act(() => void vi.advanceTimersByTime(SPLASH_FADE_MS));
    expect(screen.queryByTestId('splash')).toBeNull();
    expect(localStorage.getItem('tm-splash-seconds')).toBe('5');
  });

  it('can be turned off with a length of 0', async () => {
    stubSettings(0);
    render(<Splash />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(50)));
    await act(async () => void (await vi.advanceTimersByTimeAsync(SPLASH_FADE_MS)));
    expect(screen.queryByTestId('splash')).toBeNull();
    // Next visit: not shown at all.
    sessionStorage.clear();
    expect(shouldShowSplash()).toBe(false);
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERMS_VERSION } from '@thinkmade/shared';

const signUp = vi.fn(async (_body: Record<string, unknown>) => ({ error: null }));
vi.mock('../lib/auth-client', () => ({
  authClient: { signUp: { email: (b: Record<string, unknown>) => signUp(b) }, signOut: vi.fn(async () => ({})) },
  useSession: () => ({ user: { id: 'u1' }, isPending: false, refetch: vi.fn() }),
  safeNext: (v: string | null) => v ?? '/',
  supportsPasskeys: () => false,
}));

const { SignUpScreen } = await import('../screens/auth');
const { TermsGate } = await import('./terms-gate');

const wrap = (ui: React.ReactNode, path = '/') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  signUp.mockClear();
});

describe('agreeing to the terms', () => {
  it('creates an account only after the person ticks the unticked agreement box, and sends the terms version', async () => {
    wrap(<SignUpScreen />);
    const box = screen.getByRole('checkbox', { name: /I have read and agree to the Terms of Service and Privacy Policy/ });
    expect(box).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(box.closest('div')).toHaveTextContent(/created by AI\. They can contain mistakes .* not professional/);
    const create = screen.getByRole('button', { name: 'Create account' });
    expect(create).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/Password/), 'correct-horse-battery');
    await userEvent.click(box);
    expect(create).toBeEnabled();
    await userEvent.click(create);
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com', acceptTerms: TERMS_VERSION }));
  });

  it('asks a signed-in person to agree to the current terms, and records it', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    let accepted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, ...(init?.body ? { body: String(init.body) } : {}) });
        if (init?.method === 'POST') accepted = true;
        return new Response(JSON.stringify({ version: TERMS_VERSION, accepted }), { status: 200 });
      }),
    );
    wrap(<TermsGate />);
    const dialog = await screen.findByRole('dialog', { name: 'Please review our terms' });
    const agree = screen.getByRole('button', { name: 'Agree and continue' });
    expect(agree).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(agree);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(calls.find((c) => c.body)).toEqual({ url: '/api/me/terms', body: JSON.stringify({ version: TERMS_VERSION }) });
  });

  it('never covers the terms themselves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: TERMS_VERSION, accepted: false }), { status: 200 })));
    wrap(<TermsGate />, '/terms');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

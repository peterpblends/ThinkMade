import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { KeyRound } from 'lucide-react';
import { authClient, safeNext, supportsPasskeys } from '../lib/auth-client';
import { Button, Field, Notice, PageHeader } from '../components/ui';

function useNext() {
  const [params] = useSearchParams();
  return safeNext(params.get('next'));
}

function messageFor(
  error: { status?: number | undefined; code?: string | undefined; message?: string | undefined } | null | undefined,
): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  return error.message || 'Something went wrong. Please try again.';
}

export function SignUpScreen() {
  const navigate = useNavigate();
  const next = useNext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(form.get('name') ?? '').trim(),
      email,
      password: String(form.get('password') ?? ''),
      callbackURL: next,
    });
    setBusy(false);
    if (error) return setError(messageFor(error));
    navigate(`/verify-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  };

  return (
    <div>
      <PageHeader title="Create your account" subtitle="Free for everyone. Your podcasts stay private unless you choose to share them." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name" name="name" autoComplete="name" required />
        <Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          hint="At least 10 characters. A short phrase is easy to remember."
        />
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        <Button type="submit" block busy={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-[0.95rem] text-muted">
        Already have an account?{' '}
        <Link className="font-semibold text-accent-ink underline-offset-4 hover:underline" to={`/sign-in?next=${encodeURIComponent(next)}`}>
          Sign in
        </Link>
      </p>
    </div>
  );
}

export function VerifyEmailScreen() {
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const next = useNext();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  return (
    <div>
      <PageHeader title="Check your email" subtitle={email ? <>We sent a confirmation link to <strong className="text-ink">{email}</strong>.</> : 'We sent you a confirmation link.'} />
      <p className="text-[0.98rem]">Open the link on this device to finish setting up your account. It may take a minute to arrive, so check your spam folder too.</p>
      {email && (
        <div className="mt-6 flex flex-col gap-3">
          <Button
            variant="secondary"
            busy={state === 'sending'}
            onClick={async () => {
              setState('sending');
              const { error } = await authClient.sendVerificationEmail({ email, callbackURL: next });
              setState(error ? 'error' : 'sent');
            }}
          >
            Resend the email
          </Button>
          {state === 'sent' && <Notice>Sent. Check your inbox.</Notice>}
          {state === 'error' && (
            <Notice tone="error" role="alert">
              We couldn't send the email. Please try again in a few minutes.
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}

export function SignInScreen() {
  const navigate = useNavigate();
  const next = useNext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const passkeys = supportsPasskeys();

  // Offer saved passkeys in the browser's autofill where supported (conditional UI).
  useEffect(() => {
    if (!passkeys) return;
    let cancelled = false;
    void (async () => {
      const available = await window.PublicKeyCredential?.isConditionalMediationAvailable?.();
      if (!available || cancelled) return;
      const { error } = await authClient.signIn.passkey({ autoFill: true });
      if (!error && !cancelled) navigate(next, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [passkeys, navigate, next]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    setBusy(true);
    setError(null);
    setUnverifiedEmail(null);
    const { error } = await authClient.signIn.email({ email, password: String(form.get('password') ?? '') });
    setBusy(false);
    if (error) {
      if (error.status === 403) {
        setUnverifiedEmail(email);
        return;
      }
      return setError(error.status === 401 ? 'That email and password don’t match an account.' : messageFor(error));
    }
    navigate(next, { replace: true });
  };

  return (
    <div>
      <PageHeader title="Welcome back" />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email" name="email" type="email" autoComplete="username webauthn" inputMode="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        {unverifiedEmail && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-line bg-sage-soft px-4 py-3">
            <p>Please verify your email first. We sent a link to {unverifiedEmail} when you signed up.</p>
            <Button
              variant="secondary"
              onClick={async () => {
                await authClient.sendVerificationEmail({ email: unverifiedEmail, callbackURL: next });
                setResent(true);
              }}
            >
              Resend verification email
            </Button>
            {resent && <p className="text-sm">Sent. Check your inbox.</p>}
          </div>
        )}
        <Button type="submit" block busy={busy}>
          Sign in
        </Button>
        {passkeys && (
          <Button
            type="button"
            variant="secondary"
            block
            onClick={async () => {
              setError(null);
              const { error } = await authClient.signIn.passkey();
              if (error) return setError('Passkey sign-in was cancelled or did not match an account.');
              navigate(next, { replace: true });
            }}
          >
            <KeyRound aria-hidden size={18} /> Sign in with a passkey
          </Button>
        )}
      </form>
      <div className="mt-6 flex flex-col items-center gap-3 text-[0.95rem]">
        <Link className="font-semibold text-accent-ink underline-offset-4 hover:underline" to="/forgot-password">
          Forgot your password?
        </Link>
        <p className="text-muted">
          New to ThinkMade?{' '}
          <Link className="font-semibold text-accent-ink underline-offset-4 hover:underline" to={`/sign-up?next=${encodeURIComponent(next)}`}>
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

export function TwoFactorScreen() {
  const navigate = useNavigate();
  const next = useNext();
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const code = String(form.get('code') ?? '').trim();
    const trustDevice = form.get('trust') === 'on';
    setBusy(true);
    setError(null);
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setBusy(false);
    if (error) return setError(error.status === 429 ? messageFor(error) : 'That code didn’t work. Try the latest one from your app.');
    navigate(next, { replace: true });
  };

  return (
    <div>
      <PageHeader title="Two-step verification" subtitle={useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'} />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label={useBackup ? 'Backup code' : 'Code'}
          name="code"
          autoComplete="one-time-code"
          inputMode={useBackup ? 'text' : 'numeric'}
          required
        />
        <label className="flex min-h-11 items-center gap-3 text-[0.95rem]">
          <input type="checkbox" name="trust" className="h-5 w-5 accent-[var(--tm-accent-strong)]" /> Trust this device for 30 days
        </label>
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        <Button type="submit" block busy={busy}>
          Verify
        </Button>
        <Button type="button" variant="ghost" onClick={() => setUseBackup((b) => !b)}>
          {useBackup ? 'Use authenticator code instead' : 'Use a backup code instead'}
        </Button>
      </form>
    </div>
  );
}

export function ForgotPasswordScreen() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    setBusy(true);
    await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    // Same message whether or not the account exists, so the form can't be used to probe for accounts.
    setSent(true);
  };
  return (
    <div>
      <PageHeader title="Reset your password" subtitle="We'll email you a link to choose a new one." />
      {sent ? (
        <Notice>If an account exists for that email, a reset link is on its way.</Notice>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" required />
          <Button type="submit" block busy={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </div>
  );
}

export function ResetPasswordScreen() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!token || params.get('error')) {
    return (
      <div>
        <PageHeader title="Reset link expired" />
        <p className="mb-4">This reset link is no longer valid. Request a new one.</p>
        <Link className="font-semibold text-accent-ink" to="/forgot-password">
          Request a new link
        </Link>
      </div>
    );
  }
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: String(new FormData(e.currentTarget).get('password') ?? ''), token });
    setBusy(false);
    if (error) return setError(messageFor(error));
    navigate('/sign-in', { replace: true });
  };
  return (
    <div>
      <PageHeader title="Choose a new password" />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={10} required hint="At least 10 characters." />
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        <Button type="submit" block busy={busy}>
          Save password
        </Button>
      </form>
    </div>
  );
}

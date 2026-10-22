import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import QRCode from 'qrcode';
import { authClient, supportsPasskeys, useSession } from '../lib/auth-client';
import { getTheme, setTheme, type ThemeChoice } from '../lib/theme';
import { Button, Card, Field, Notice, PageHeader } from '../components/ui';
import { StorageSection } from './storage-section';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl">{title}</h2>
      {children}
    </Card>
  );
}

function ProfileSection() {
  const { user, refetch } = useSession();
  const [saved, setSaved] = useState(false);
  if (!user) return null;
  return (
    <Section title="Profile">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          await authClient.updateUser({ name: String(new FormData(e.currentTarget).get('name') ?? '').trim() });
          await refetch();
          setSaved(true);
        }}
      >
        <Field label="Name" name="name" defaultValue={user.name} autoComplete="name" />
        <p className="text-sm text-muted">Email: {user.email}</p>
        <Button type="submit" variant="secondary">
          Save
        </Button>
        {saved && <Notice>Saved.</Notice>}
      </form>
    </Section>
  );
}

function AppearanceSection() {
  const [choice, setChoice] = useState<ThemeChoice>(getTheme());
  return (
    <Section title="Appearance">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Theme</legend>
        {(['system', 'light', 'dark'] as const).map((c) => (
          <label key={c} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 has-[:checked]:border-accent-strong has-[:checked]:bg-accent-strong has-[:checked]:text-on-accent">
            <input
              type="radio"
              name="theme"
              className="sr-only"
              checked={choice === c}
              onChange={() => {
                setChoice(c);
                setTheme(c);
              }}
            />
            {c === 'system' ? 'Match device' : c === 'light' ? 'Light' : 'Dark'}
          </label>
        ))}
      </fieldset>
    </Section>
  );
}

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
}

function PasskeySection() {
  const [rows, setRows] = useState<PasskeyRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const { data } = await authClient.passkey.listUserPasskeys();
    setRows((data as PasskeyRow[] | null) ?? []);
  };
  useEffect(() => {
    void load();
  }, []);
  if (!supportsPasskeys()) {
    return (
      <Section title="Passkeys">
        <p className="text-muted">This browser doesn't support passkeys. You can still sign in with your email and password.</p>
      </Section>
    );
  }
  return (
    <Section title="Passkeys">
      <p className="text-[0.95rem] text-muted">
        Sign in with Face ID, Touch ID or your device PIN. Your fingerprint or face never leaves your device, and ThinkMade never sees it.
      </p>
      {rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate">{p.name || 'Passkey'}</span>
              <Button
                variant="ghost"
                className="min-h-11 px-3 text-sm"
                onClick={async () => {
                  await authClient.passkey.deletePasskey({ id: p.id });
                  await load();
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="secondary"
        onClick={async () => {
          setError(null);
          const result = await authClient.passkey.addPasskey({ name: navigator.platform || 'This device' });
          if (result?.error) setError('The passkey was not added. You can try again.');
          await load();
        }}
      >
        Add a passkey
      </Button>
      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}
    </Section>
  );
}

function TwoFactorSection() {
  const { user, refetch } = useSession();
  const [stage, setStage] = useState<'idle' | 'verify'>('idle');
  const [qr, setQr] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const enabled = Boolean(user.twoFactorEnabled);

  return (
    <Section title="Two-step verification">
      <p className="text-[0.95rem] text-muted">
        {enabled
          ? 'On. You will be asked for a code from your authenticator app when you sign in with a password.'
          : 'Add a code from an authenticator app when you sign in with a password. Required for administrators.'}
      </p>
      {stage === 'idle' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            setError(null);
            const password = String(new FormData(e.currentTarget).get('password') ?? '');
            if (enabled) {
              const { error } = await authClient.twoFactor.disable({ password });
              if (error) return setError('That password is not correct.');
              await refetch();
              return;
            }
            const { data, error } = await authClient.twoFactor.enable({ password });
            if (error || !data || !('totpURI' in data)) return setError('That password is not correct.');
            setQr(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 }));
            setBackupCodes(data.backupCodes ?? []);
            setStage('verify');
          }}
        >
          <Field label="Confirm your password" name="password" type="password" autoComplete="current-password" required />
          <Button type="submit" variant="secondary">
            {enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </form>
      )}
      {stage === 'verify' && qr && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            setError(null);
            const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
            const { error } = await authClient.twoFactor.verifyTotp({ code });
            if (error) return setError('That code didn’t work. Try the latest one.');
            setStage('idle');
            await refetch();
          }}
        >
          <p>Scan this code with your authenticator app, then enter the 6-digit code it shows.</p>
          <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="self-center rounded-xl bg-white p-2" />
          {backupCodes.length > 0 && (
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer font-semibold">Backup codes (save these somewhere safe)</summary>
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
                {backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          )}
          <Field label="Code" name="code" autoComplete="one-time-code" inputMode="numeric" required />
          <Button type="submit">Confirm</Button>
        </form>
      )}
      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}
    </Section>
  );
}

function DataSection() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="Your data">
      <a
        href="/api/me/export"
        download
        className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-surface px-5 font-semibold hover:bg-surface-2"
      >
        Download my data
      </a>
      {!confirming ? (
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Delete my account
        </Button>
      ) : (
        <form
          className="flex flex-col gap-3 rounded-xl border border-danger/40 p-4"
          onSubmit={async (e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            setError(null);
            const { error } = await authClient.deleteUser({ password: String(new FormData(e.currentTarget).get('password') ?? '') });
            if (error) return setError('That password is not correct.');
            navigate('/', { replace: true });
          }}
        >
          <p>This permanently deletes your account, podcasts, coaching and listening history. It cannot be undone.</p>
          <Field label="Confirm your password" name="password" type="password" autoComplete="current-password" required />
          {error && (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger">
              Delete permanently
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

export function SettingsScreen() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Settings" />
      <ProfileSection />
      <AppearanceSection />
      <PasskeySection />
      <TwoFactorSection />
      <StorageSection />
      <DataSection />
    </div>
  );
}

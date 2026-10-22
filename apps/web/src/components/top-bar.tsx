import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bug, CircleHelp, Download, LogIn, LogOut, Settings, Shield, UserPlus, UserRound } from 'lucide-react';
import { authClient, isAdmin, useSession } from '../lib/auth-client';
import { useInstallAction } from './install';
import { Logo } from './logo';

/** Brand on the left, account menu on the right. Secondary destinations live in the menu, not the tab bar. */
export function TopBar() {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const install = useInstallAction();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const item = 'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[0.98rem] hover:bg-surface-2 focus:bg-surface-2 focus:outline-none';

  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-line/70 bg-bg/90 backdrop-blur">
      <div className="px-safe mx-auto flex h-14 max-w-xl items-center justify-between">
        <Link to="/" className="rounded-lg" aria-label="ThinkMade home">
          <Logo size={26} />
        </Link>
        <div className="relative">
          <button
            ref={buttonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Account menu"
            onClick={() => setOpen((o) => !o)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink"
          >
            {user ? (
              <span aria-hidden className="font-semibold">
                {(user.name || user.email).slice(0, 1).toUpperCase()}
              </span>
            ) : (
              <UserRound aria-hidden size={20} />
            )}
          </button>
          {open && (
            <div
              ref={menuRef}
              role="menu"
              aria-label="Account"
              className="absolute right-0 top-12 z-40 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-2 shadow-card"
            >
              {user && (
                <div className="px-3 pb-2 pt-1">
                  <p className="truncate font-semibold">{user.name}</p>
                  <p className="truncate text-sm text-muted">{user.email}</p>
                </div>
              )}
              {!user && (
                <>
                  <button role="menuitem" className={item} onClick={() => go('/sign-in')}>
                    <LogIn aria-hidden size={20} /> Sign in
                  </button>
                  <button role="menuitem" className={item} onClick={() => go('/sign-up')}>
                    <UserPlus aria-hidden size={20} /> Create account
                  </button>
                </>
              )}
              {user && (
                <button role="menuitem" className={item} onClick={() => go('/settings')}>
                  <Settings aria-hidden size={20} /> Settings
                </button>
              )}
              {user && isAdmin(user) && (
                <button role="menuitem" className={item} onClick={() => go('/admin')}>
                  <Shield aria-hidden size={20} /> Admin
                </button>
              )}
              <button role="menuitem" className={item} onClick={() => go('/help')}>
                <CircleHelp aria-hidden size={20} /> Help
              </button>
              <button role="menuitem" className={item} onClick={() => go('/report-bug')}>
                <Bug aria-hidden size={20} /> Report a Bug
              </button>
              {install.available && (
                <button
                  role="menuitem"
                  className={item}
                  onClick={() => {
                    setOpen(false);
                    void install.start();
                  }}
                >
                  <Download aria-hidden size={20} /> Install ThinkMade
                </button>
              )}
              {user && (
                <button
                  role="menuitem"
                  className={item}
                  onClick={async () => {
                    setOpen(false);
                    await authClient.signOut();
                    navigate('/');
                  }}
                >
                  <LogOut aria-hidden size={20} /> Sign out
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {install.sheet}
    </header>
  );
}

import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from '../lib/auth-client';
import { BottomNav } from './bottom-nav';
import { TopBar } from './top-bar';
import { UpdatePrompt } from './update-prompt';
import { MiniPlayer } from '../player/mini-player';
import { useOptionalPlayer } from '../player/player-context';

export function AppShell() {
  const location = useLocation();
  const player = useOptionalPlayer();
  const showMini = !!player?.current && location.pathname !== '/player';
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <TopBar />
      <main id="main" className={`px-safe mx-auto w-full max-w-xl flex-1 pt-6 ${showMini ? 'pb-[calc(10.5rem+env(safe-area-inset-bottom))]' : 'pb-[calc(6rem+env(safe-area-inset-bottom))]'}`}>
        <Outlet />
      </main>
      {showMini && <MiniPlayer />}
      <BottomNav />
      <UpdatePrompt />
    </div>
  );
}

/** Redirects to sign-in, remembering where the user was going. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isPending } = useSession();
  const location = useLocation();
  if (isPending) return <p className="text-muted" role="status">Loading…</p>;
  if (!user) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

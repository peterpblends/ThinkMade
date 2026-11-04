import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell, RequireAuth } from './components/app-shell';
import { CreateScreen } from './screens/create';
import { NotFoundScreen } from './screens/pages';
import { DiscoverScreen } from './screens/discover';
import { LibraryScreen } from './screens/library';
import { PlayerProvider } from './player/player-context';
import { makeOfflineSender, resolveSource } from './offline/player-adapters';
import { SyncManager } from './offline/sync-manager';
import { Splash } from './components/splash';
import { getDownload } from './offline/downloads';

/** Screens a first-time visitor doesn't need are loaded on demand to keep the Create screen fast on phones. */
function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as unknown as ComponentType }));
}

const auth = () => import('./screens/auth');
const SignInScreen = lazyNamed(auth, 'SignInScreen');
const SignUpScreen = lazyNamed(auth, 'SignUpScreen');
const VerifyEmailScreen = lazyNamed(auth, 'VerifyEmailScreen');
const TwoFactorScreen = lazyNamed(auth, 'TwoFactorScreen');
const ForgotPasswordScreen = lazyNamed(auth, 'ForgotPasswordScreen');
const ResetPasswordScreen = lazyNamed(auth, 'ResetPasswordScreen');
const pages = () => import('./screens/pages');
const HelpScreen = lazyNamed(pages, 'HelpScreen');
const ReportBugScreen = lazyNamed(pages, 'ReportBugScreen');
const SettingsScreen = lazyNamed(() => import('./screens/settings'), 'SettingsScreen');
const AdminSettingsScreen = lazyNamed(() => import('./screens/admin/settings'), 'AdminSettingsScreen');
const AdminLayout = lazyNamed(() => import('./screens/admin/layout'), 'AdminLayout');
const AdminOverview = lazyNamed(() => import('./screens/admin/overview'), 'AdminOverview');
const AdminModels = lazyNamed(() => import('./screens/admin/models'), 'AdminModels');
const AdminPrompts = lazyNamed(() => import('./screens/admin/prompts'), 'AdminPrompts');
const AdminQuality = lazyNamed(() => import('./screens/admin/quality'), 'AdminQuality');
const AdminBugs = lazyNamed(() => import('./screens/admin/bugs'), 'AdminBugs');
const AdminUsers = lazyNamed(() => import('./screens/admin/users'), 'AdminUsers');
const AdminPublic = lazyNamed(() => import('./screens/admin/public'), 'AdminPublic');
const AdminPodcasts = lazyNamed(() => import('./screens/admin/podcasts'), 'AdminPodcasts');
const AdminAudit = lazyNamed(() => import('./screens/admin/audit'), 'AdminAudit');
const AdminReport = lazyNamed(() => import('./screens/admin/report'), 'AdminReport');
const GenerationProgressScreen = lazyNamed(() => import('./screens/generation-progress'), 'GenerationProgressScreen');
const SeriesScreen = lazyNamed(() => import('./screens/series'), 'SeriesScreen');
const PublicSeriesScreen = lazyNamed(() => import('./screens/series'), 'PublicSeriesScreen');
const PublicEpisodeScreen = lazyNamed(() => import('./screens/series'), 'PublicEpisodeScreen');
const PlayerScreen = lazyNamed(() => import('./player/player-screen'), 'PlayerScreen');
const CoachScreen = lazyNamed(() => import('./screens/coach'), 'CoachScreen');

const page = (node: ReactNode) => (
  <Suspense fallback={<p role="status" className="text-muted">Loading…</p>}>{node}</Suspense>
);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, networkMode: 'offlineFirst' } } });

/** Durations of episodes the player has seen, for completion rules when offline. */
const durations = new Map<string, number>();
const sendProgress = makeOfflineSender((id) => durations.get(id) ?? null);
const resolve = async (ep: Parameters<typeof resolveSource>[0]) => {
  if (ep.durationSeconds) durations.set(ep.id, ep.durationSeconds * 1000);
  else {
    const d = await getDownload(ep.id).catch(() => undefined);
    if (d?.durationSeconds) durations.set(ep.id, d.durationSeconds * 1000);
  }
  return resolveSource(ep);
};

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <CreateScreen /> },
      { path: '/discover', element: <DiscoverScreen /> },
      { path: '/library', element: <LibraryScreen /> },
      { path: '/sign-in', element: page(<SignInScreen />) },
      { path: '/sign-up', element: page(<SignUpScreen />) },
      { path: '/verify-email', element: page(<VerifyEmailScreen />) },
      { path: '/two-factor', element: page(<TwoFactorScreen />) },
      { path: '/forgot-password', element: page(<ForgotPasswordScreen />) },
      { path: '/reset-password', element: page(<ResetPasswordScreen />) },
      { path: '/help', element: page(<HelpScreen />) },
      { path: '/report-bug', element: page(<ReportBugScreen />) },
      { path: '/generations/:id', element: <RequireAuth>{page(<GenerationProgressScreen />)}</RequireAuth> },
      { path: '/series/:id', element: page(<SeriesScreen />) },
      { path: '/p/:slug', element: page(<PublicSeriesScreen />) },
      { path: '/p/:slug/e/:number', element: page(<PublicEpisodeScreen />) },
      { path: '/player', element: page(<PlayerScreen />) },
      { path: '/coach/:episodeId', element: <RequireAuth>{page(<CoachScreen />)}</RequireAuth> },
      { path: '/settings', element: <RequireAuth>{page(<SettingsScreen />)}</RequireAuth> },
      {
        path: '/admin',
        element: <RequireAuth>{page(<AdminLayout />)}</RequireAuth>,
        children: [
          { index: true, element: page(<AdminOverview />) },
          { path: 'report', element: page(<AdminReport />) },
          { path: 'settings', element: page(<AdminSettingsScreen />) },
          { path: 'models', element: page(<AdminModels />) },
          { path: 'prompts', element: page(<AdminPrompts />) },
          { path: 'quality', element: page(<AdminQuality />) },
          { path: 'bugs', element: page(<AdminBugs />) },
          { path: 'users', element: page(<AdminUsers />) },
          { path: 'public', element: page(<AdminPublic />) },
          { path: 'podcasts', element: page(<AdminPodcasts />) },
          { path: 'audit', element: page(<AdminAudit />) },
        ],
      },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PlayerProvider sendProgress={sendProgress} resolveSource={resolve}>
        <SyncManager />
        <RouterProvider router={router} />
        <Splash />
      </PlayerProvider>
    </QueryClientProvider>
  );
}

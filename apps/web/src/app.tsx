import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell, RequireAuth } from './components/app-shell';
import { CreateScreen } from './screens/create';
import { DiscoverScreen, LibraryScreen, NotFoundScreen } from './screens/pages';

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
const GenerationProgressScreen = lazyNamed(() => import('./screens/generation-progress'), 'GenerationProgressScreen');
const SeriesScreen = lazyNamed(() => import('./screens/series'), 'SeriesScreen');

const page = (node: ReactNode) => (
  <Suspense fallback={<p role="status" className="text-muted">Loading…</p>}>{node}</Suspense>
);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

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
      { path: '/settings', element: <RequireAuth>{page(<SettingsScreen />)}</RequireAuth> },
      { path: '/admin/settings', element: <RequireAuth>{page(<AdminSettingsScreen />)}</RequireAuth> },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell, RequireAuth } from './components/app-shell';
import { CreateScreen } from './screens/create';
import {
  ForgotPasswordScreen,
  ResetPasswordScreen,
  SignInScreen,
  SignUpScreen,
  TwoFactorScreen,
  VerifyEmailScreen,
} from './screens/auth';
import { DiscoverScreen, HelpScreen, LibraryScreen, NotFoundScreen, ReportBugScreen } from './screens/pages';
import { SettingsScreen } from './screens/settings';
import { AdminSettingsScreen } from './screens/admin/settings';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <CreateScreen /> },
      { path: '/discover', element: <DiscoverScreen /> },
      { path: '/library', element: <LibraryScreen /> },
      { path: '/sign-in', element: <SignInScreen /> },
      { path: '/sign-up', element: <SignUpScreen /> },
      { path: '/verify-email', element: <VerifyEmailScreen /> },
      { path: '/two-factor', element: <TwoFactorScreen /> },
      { path: '/forgot-password', element: <ForgotPasswordScreen /> },
      { path: '/reset-password', element: <ResetPasswordScreen /> },
      { path: '/help', element: <HelpScreen /> },
      { path: '/report-bug', element: <ReportBugScreen /> },
      { path: '/settings', element: <RequireAuth><SettingsScreen /></RequireAuth> },
      { path: '/admin/settings', element: <RequireAuth><AdminSettingsScreen /></RequireAuth> },
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

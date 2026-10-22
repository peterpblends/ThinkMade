/** Privacy-safe facts about this device and app state. Never includes content, tokens, cookies or query strings. */
export function collectDiagnostics(errorIds: string[] = []) {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string }; standalone?: boolean };
  return {
    appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev',
    userAgent: navigator.userAgent.slice(0, 300),
    platform: nav.userAgentData?.platform ?? navigator.platform ?? '',
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    online: navigator.onLine,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true,
    path: window.location.pathname,
    errorIds: errorIds.slice(0, 10),
    occurredAt: new Date().toISOString(),
  };
}

const recentErrors: string[] = [];
/** Records short error identifiers (never messages with user content) for bug reports. */
export function startErrorCapture() {
  const add = (id: string) => {
    recentErrors.push(id.slice(0, 100));
    if (recentErrors.length > 10) recentErrors.shift();
  };
  window.addEventListener('error', (e) => add(`error:${e.filename?.split('/').pop() ?? '?'}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => add(`rejection:${(e.reason as Error)?.name ?? 'unknown'}`));
}
export const getRecentErrorIds = () => [...recentErrors];

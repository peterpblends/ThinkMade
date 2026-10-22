import { Hono } from 'hono';

/** Placeholder until Phase 9 adds storage, screenshots and email notification. */
export function bugReportRoutes() {
  return new Hono().post('/bug-reports', (c) => c.json({ error: 'not_implemented', feature: 'bug_reports' }, 501));
}

import { NavLink, Outlet } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type ApiError } from '../../lib/api';
import { Notice } from '../../components/ui';
import { Link } from 'react-router';

const TABS = [
  ['/admin', 'Overview', true],
  ['/admin/report', 'Activity', false],
  ['/admin/settings', 'Defaults', false],
  ['/admin/models', 'AI models', false],
  ['/admin/prompts', 'Prompts', false],
  ['/admin/quality', 'Quality', false],
  ['/admin/bugs', 'Bug reports', false],
  ['/admin/users', 'People', false],
  ['/admin/public', 'Public content', false],
  ['/admin/audit', 'Audit log', false],
] as const;

/** Admin area: checks access once (role + two-step verification) and shows the section tabs. */
export function AdminLayout() {
  const access = useQuery({ queryKey: ['admin', 'access'], queryFn: () => api('/api/admin/whoami'), retry: false });
  if (access.isError) {
    const err = access.error as ApiError;
    return (
      <Notice tone="error" role="alert">
        {err.code === 'two_factor_required' ? (
          <>Turn on two-step verification in <Link className="font-semibold underline" to="/settings">Settings</Link> to use admin tools.</>
        ) : (
          'You do not have access to admin tools.'
        )}
      </Notice>
    );
  }
  if (!access.data) return <p role="status" className="text-muted">Loading…</p>;
  return (
    <div>
      <nav aria-label="Admin sections" className="-mx-4 mb-6 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <ul className="flex gap-2">
          {TABS.map(([to, label, end]) => (
            <li key={to} className="shrink-0">
              <NavLink to={to} end={end} className={({ isActive }) => `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${isActive ? 'border-accent-strong bg-accent-strong text-on-accent' : 'border-line'}`}>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}

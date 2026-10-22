import { NavLink } from 'react-router';
import { Compass, Library, PenLine } from 'lucide-react';

const tabs = [
  { to: '/', label: 'Create', Icon: PenLine, end: true },
  { to: '/discover', label: 'Discover', Icon: Compass, end: false },
  { to: '/library', label: 'My Library', Icon: Library, end: false },
] as const;

/** The three primary destinations. Nothing else belongs here. */
export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
    >
      <ul className="mx-auto flex max-w-xl">
        {tabs.map(({ to, label, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[0.75rem] font-semibold transition ${
                  isActive ? 'text-accent-ink' : 'text-muted hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon aria-hidden size={24} strokeWidth={isActive ? 2.25 : 1.75} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

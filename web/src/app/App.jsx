import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Activity, CalendarDays, ClipboardCheck, History, Menu, Plug2, Settings, X } from 'lucide-react';
import { Toasts } from '../components/Toasts.jsx';

const NAV = [
  { to: '/', label: 'Overview', Icon: Activity, end: true },
  { to: '/events', label: 'Events', Icon: CalendarDays },
  { to: '/verify', label: 'Verify Announcement', Icon: ClipboardCheck },
  { to: '/history', label: 'Verification History', Icon: History },
  { to: '/integrations', label: 'Integrations', Icon: Plug2 },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="EventProof home">
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-600">
        <ClipboardCheck size={18} className="text-white" />
      </span>
      <span className="leading-tight">
        <span className="block text-[0.95rem] font-bold tracking-tight text-white">EventProof</span>
        <span className="block text-[0.68rem] font-medium text-slate-400">Proof Before Post</span>
      </span>
    </Link>
  );
}

function NavList({ onNavigate }) {
  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-1">
        {NAV.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-ink-800 text-white' : 'text-slate-300 hover:bg-ink-800/60 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={17} aria-hidden="true" className={isActive ? 'text-teal-400' : 'text-slate-400'} />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function App() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col gap-6 bg-ink-950 p-5 lg:flex" aria-label="Sidebar">
        <Logo />
        <NavList />
        <p className="mt-auto text-xs leading-relaxed text-slate-500">
          Verification only. EventProof never publishes announcements.
        </p>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-ink-950 px-4 py-3 lg:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          className="rounded-md p-2 text-slate-200 hover:bg-ink-800"
        >
          {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>
      {mobileOpen ? (
        <div className="border-b border-ink-800 bg-ink-950 px-4 pb-4 lg:hidden">
          <NavList onNavigate={() => setMobileOpen(false)} />
        </div>
      ) : null}

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <Outlet />
        </div>
      </main>
      <Toasts />
    </div>
  );
}

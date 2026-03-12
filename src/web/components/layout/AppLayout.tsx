import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';

const navItems = [
  { path: '/', label: 'Dashboard' },
  { path: '/submit', label: 'New Run' },
  { path: '/settings', label: 'Settings' },
];

function ThemeToggle() {
  const { theme, toggle } = useThemeStore();
  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium text-secondary hover-card transition-colors"
      style={{ borderColor: 'var(--color-card-border)' }}
    >
      {theme === 'dark' ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
      )}
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const logout = useAuthStore(state => state.logout);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="header-bg border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-hive-500 to-hive-700 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted leading-none">Distributed</p>
              <p className="text-lg font-bold text-heading leading-tight">Hive</p>
            </div>
          </Link>
          <nav className="flex gap-1 ml-4">
            {navItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  location.pathname === item.path
                    ? 'bg-hive-500/10 text-hive-600'
                    : 'text-secondary hover:text-heading hover-card'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user && (
            <div className="flex items-center gap-3 ml-2 pl-3 border-l" style={{ borderColor: 'var(--color-card-border)' }}>
              <img src={user.avatarUrl} alt={user.login} className="w-7 h-7 rounded-full ring-2 ring-gray-200 dark:ring-gray-700" />
              <span className="text-sm text-label font-medium">{user.login}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-muted hover:text-secondary transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

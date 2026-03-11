import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

const navItems = [
  { path: '/', label: 'Dashboard' },
  { path: '/submit', label: 'New Run' },
  { path: '/settings', label: 'Settings' },
];

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
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold text-hive-700">
          Distributed Hive
        </Link>
        <div className="flex items-center gap-4">
          <nav className="flex gap-4">
            {navItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  location.pathname === item.path
                    ? 'bg-hive-100 text-hive-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {user && (
            <div className="flex items-center gap-3 ml-4 pl-4 border-l border-gray-200">
              <img
                src={user.avatarUrl}
                alt={user.login}
                className="w-7 h-7 rounded-full"
              />
              <span className="text-sm text-gray-700 font-medium">{user.login}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
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

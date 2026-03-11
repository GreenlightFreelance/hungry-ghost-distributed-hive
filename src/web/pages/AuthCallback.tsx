import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.distributed-hive.com';

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const login = useAuthStore(state => state.login);
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef(false);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('No authorization code received from GitHub');
      return;
    }

    if (exchanged.current) return;
    exchanged.current = true;

    async function exchangeCode(code: string) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/github`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!res.ok) {
          const data = (await res.json()) as { error: string };
          setError(data.error || 'Authentication failed');
          return;
        }

        const data = (await res.json()) as {
          token: string;
          user: { login: string; avatarUrl: string; name: string | null };
        };

        login(data.token, data.user);
        navigate('/', { replace: true });
      } catch {
        setError('Failed to complete authentication');
      }
    }

    exchangeCode(code);
  }, [searchParams, login, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-sm w-full bg-white rounded-lg border border-gray-200 p-8 text-center">
          <h1 className="text-lg font-semibold text-red-600 mb-2">Authentication Failed</h1>
          <p className="text-gray-600 text-sm mb-4">{error}</p>
          <a href="/login" className="text-sm text-hive-600 hover:text-hive-800 font-medium">
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="text-gray-500 text-sm">Signing you in...</p>
      </div>
    </div>
  );
}

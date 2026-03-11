import { create } from 'zustand';

export interface AuthUser {
  login: string;
  avatarUrl: string;
  name: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;

  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  loadSession: () => void;
}

const STORAGE_KEY = 'hive_auth';

/** Storage abstraction for testability */
export const storage = {
  get(): { token: string; user: AuthUser } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as { token: string; user: AuthUser };
      if (data.token && data.user?.login) return data;
      return null;
    } catch {
      return null;
    }
  },
  set(token: string, user: AuthUser): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    } catch {
      // Storage unavailable
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable
    }
  },
};

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  login: (token, user) => {
    storage.set(token, user);
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    storage.clear();
    set({ token: null, user: null, isAuthenticated: false });
  },

  loadSession: () => {
    const session = storage.get();
    if (session) {
      set({ token: session.token, user: session.user, isAuthenticated: true });
    }
  },
}));

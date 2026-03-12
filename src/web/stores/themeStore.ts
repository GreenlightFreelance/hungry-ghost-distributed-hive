import { create } from 'zustand';

type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  localStorage.setItem('hive_theme', theme);
}

const stored = (localStorage.getItem('hive_theme') as Theme) || 'dark';
applyTheme(stored);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: stored,
  toggle: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return { theme: next };
    }),
}));

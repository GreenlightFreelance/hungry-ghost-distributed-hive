/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './main.tsx',
    './App.tsx',
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './stores/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  safelist: [
    'dark:bg-surface-800',
    'dark:bg-surface-850',
    'dark:bg-surface-900',
    'dark:bg-surface-950',
    'dark:border-gray-700',
    'dark:border-gray-800',
  ],
  theme: {
    extend: {
      colors: {
        hive: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          700: '#1e293b',
          800: '#1a2234',
          850: '#151d2e',
          900: '#111827',
          950: '#0b1120',
        },
      },
    },
  },
  plugins: [],
};

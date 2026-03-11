import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthCallback } from './pages/AuthCallback';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { RunView } from './pages/RunView';
import { Settings } from './pages/Settings';
import { SubmitRun } from './pages/SubmitRun';
import { useAuthStore } from './stores/authStore';

export function App() {
  const loadSession = useAuthStore(state => state.loadSession);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/submit" element={<SubmitRun />} />
          <Route path="/run/:id" element={<RunView />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
    </Routes>
  );
}

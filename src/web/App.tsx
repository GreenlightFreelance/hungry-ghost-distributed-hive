import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { RunView } from './pages/RunView';
import { Settings } from './pages/Settings';
import { SubmitRun } from './pages/SubmitRun';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/submit" element={<SubmitRun />} />
        <Route path="/run/:id" element={<RunView />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

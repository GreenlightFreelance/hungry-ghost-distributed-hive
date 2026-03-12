import { Link } from 'react-router-dom';
import { useRunStore } from '../stores/runStore';
import type { Run } from '../types';

function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function formatDuration(startIso: string, endIso: string): string {
  const diffMin = Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
  if (diffMin < 60) return `${diffMin}m`;
  const hr = Math.floor(diffMin / 60);
  const min = diffMin % 60;
  return min > 0 ? `${hr}h ${min}m` : `${hr}h`;
}

const statusStyles: Record<string, string> = {
  running: 'bg-green-500',
  pending: 'bg-yellow-500',
  completed: 'bg-gray-400',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
};

function RunCard({ run }: { run: Run }) {
  const isActive = run.status === 'running' || run.status === 'pending';
  const storiesDone = run.stories.filter(s => s.status === 'done' || s.status === 'merged').length;
  const agentsActive = run.agents.filter(a => a.status === 'working').length;

  return (
    <Link
      to={`/run/${run.id}`}
      className="block p-4 card rounded-xl border hover:border-hive-400 transition-all hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2 h-2 rounded-full ${statusStyles[run.status] || 'bg-gray-400'} ${isActive ? 'animate-pulse' : ''}`}
          />
          <h3 className="font-semibold text-heading">{run.title}</h3>
        </div>
        <span className="text-sm text-secondary font-mono">
          {storiesDone}/{run.stories.length} stories
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-4 text-sm text-secondary">
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
          {run.repositories.length} repos
        </span>
        {isActive && <span>{agentsActive} agents active</span>}
        {isActive && run.startedAt && <span>Started {formatTimeAgo(run.startedAt)}</span>}
        {isActive && run.estimatedCost != null && (
          <span>~${run.estimatedCost.toFixed(2)} est.</span>
        )}
        {!isActive && run.startedAt && run.completedAt && (
          <span>Duration: {formatDuration(run.startedAt, run.completedAt)}</span>
        )}
        {!isActive && run.actualCost != null && <span>Cost: ${run.actualCost.toFixed(2)}</span>}
        {!isActive && run.completedAt && <span>{formatTimeAgo(run.completedAt)}</span>}
      </div>
    </Link>
  );
}

export function Dashboard() {
  const runs = useRunStore(s => s.runs);
  const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'pending');
  const completedRuns = runs.filter(
    r => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled'
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-heading">Dashboard</h1>
          <p className="text-sm text-secondary mt-1">Monitor your hive runs and agent activity</p>
        </div>
        <Link
          to="/submit"
          className="px-4 py-2 bg-hive-600 text-white rounded-lg hover:bg-hive-700 transition-colors text-sm font-medium shadow-sm"
        >
          + New Run
        </Link>
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-section mb-3">Active Runs</h2>
        {activeRuns.length === 0 ? (
          <div className="card rounded-xl border p-8 text-center">
            <p className="text-muted text-sm">No active runs.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeRuns.map(run => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-section mb-3">Recent Completed</h2>
        {completedRuns.length === 0 ? (
          <div className="card rounded-xl border p-8 text-center">
            <p className="text-muted text-sm">No completed runs yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {completedRuns.map(run => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

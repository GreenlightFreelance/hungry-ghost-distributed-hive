import { Link } from "react-router-dom";
import { useRunStore } from "../stores/runStore";
import type { Run } from "../types";

function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function formatDuration(startIso: string, endIso: string): string {
  const diffMin = Math.floor(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000,
  );
  if (diffMin < 60) return `${diffMin} min`;
  const hr = Math.floor(diffMin / 60);
  const min = diffMin % 60;
  return min > 0 ? `${hr}h ${min}min` : `${hr}h`;
}

function RunCard({ run }: { run: Run }) {
  const isActive = run.status === "running" || run.status === "pending";
  const storiesDone = run.stories.filter(
    (s) => s.status === "done" || s.status === "merged",
  ).length;
  const agentsActive = run.agents.filter((a) => a.status === "working").length;

  return (
    <Link
      to={`/run/${run.id}`}
      className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-hive-300 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isActive ? "bg-green-500 animate-pulse" : "bg-gray-400"
            }`}
          />
          <h3 className="font-medium text-gray-900">{run.title}</h3>
        </div>
        <span className="text-sm text-gray-500">
          {storiesDone}/{run.stories.length} stories
        </span>
      </div>
      <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
        <span>{run.repositories.length} repos</span>
        {isActive && <span>{agentsActive} agents active</span>}
        {isActive && run.startedAt && (
          <span>Started {formatTimeAgo(run.startedAt)}</span>
        )}
        {isActive && run.estimatedCost != null && (
          <span>~${run.estimatedCost.toFixed(2)} est.</span>
        )}
        {!isActive && run.startedAt && run.completedAt && (
          <span>Duration: {formatDuration(run.startedAt, run.completedAt)}</span>
        )}
        {!isActive && run.actualCost != null && (
          <span>Cost: ${run.actualCost.toFixed(2)}</span>
        )}
        {!isActive && run.completedAt && (
          <span>Completed {formatTimeAgo(run.completedAt)}</span>
        )}
      </div>
    </Link>
  );
}

export function Dashboard() {
  const runs = useRunStore((s) => s.runs);
  const activeRuns = runs.filter(
    (r) => r.status === "running" || r.status === "pending",
  );
  const completedRuns = runs.filter(
    (r) =>
      r.status === "completed" ||
      r.status === "failed" ||
      r.status === "cancelled",
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link
          to="/submit"
          className="px-4 py-2 bg-hive-600 text-white rounded-md hover:bg-hive-700 transition-colors text-sm font-medium"
        >
          + New Run
        </Link>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Active Runs</h2>
        {activeRuns.length === 0 ? (
          <p className="text-gray-500 text-sm">No active runs.</p>
        ) : (
          <div className="space-y-3">
            {activeRuns.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent Completed</h2>
        {completedRuns.length === 0 ? (
          <p className="text-gray-500 text-sm">No completed runs yet.</p>
        ) : (
          <div className="space-y-3">
            {completedRuns.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

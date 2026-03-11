import { Link, useParams } from 'react-router-dom';
import { useRunStore } from '../stores/runStore';

const statusColors: Record<string, string> = {
  done: 'text-green-600',
  merged: 'text-green-600',
  in_progress: 'text-blue-600',
  review: 'text-yellow-600',
  todo: 'text-gray-400',
};

const statusIcons: Record<string, string> = {
  done: '\u2713',
  merged: '\u2713',
  in_progress: '\u25CF',
  review: '\u25CF',
  todo: '\u25CB',
};

const agentStatusColors: Record<string, string> = {
  working: 'bg-green-500',
  done: 'bg-green-500',
  waiting: 'bg-yellow-500',
  idle: 'bg-gray-300',
  error: 'bg-red-500',
};

export function RunView() {
  const { id } = useParams<{ id: string }>();
  const { activeRun, stories, agents, logs, escalations } = useRunStore();

  if (!activeRun || activeRun.id !== id) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link to="/" className="text-hive-600 hover:text-hive-700">
            &larr; Back
          </Link>
        </div>
        <p className="text-gray-500">Loading run {id}...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-hive-600 hover:text-hive-700">
            &larr; Back
          </Link>
          <h1 className="text-xl font-bold">{activeRun.title}</h1>
        </div>
        {activeRun.status === 'running' && (
          <button className="px-4 py-2 text-red-600 border border-red-300 rounded-md hover:bg-red-50 text-sm font-medium">
            Cancel
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Stories + Agents */}
        <div className="space-y-6">
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="font-semibold mb-3">Stories</h2>
            {stories.length === 0 ? (
              <p className="text-sm text-gray-500">No stories yet.</p>
            ) : (
              <ul className="space-y-2">
                {stories.map(story => (
                  <li key={story.id} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className={statusColors[story.status] ?? 'text-gray-400'}>
                        {statusIcons[story.status] ?? '\u25CB'}
                      </span>
                      <div>
                        <span className="text-gray-600">{story.id}</span>
                        <span className="text-gray-400 ml-1">({story.points}pts)</span>
                        <p className="text-gray-800">{story.title}</p>
                        {story.assignee && (
                          <p className="text-gray-500 text-xs">Agent: {story.assignee}</p>
                        )}
                        {story.prUrl && (
                          <a
                            href={story.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-hive-600 text-xs hover:underline"
                          >
                            PR #{story.prNumber}
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="font-semibold mb-3">Agents</h2>
            {agents.length === 0 ? (
              <p className="text-sm text-gray-500">No agents yet.</p>
            ) : (
              <ul className="space-y-2">
                {agents.map(agent => (
                  <li key={agent.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={`w-2 h-2 rounded-full ${agentStatusColors[agent.status] ?? 'bg-gray-300'}`}
                    />
                    <span className="text-gray-800">{agent.role}</span>
                    <span className="text-gray-400">({agent.status})</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right column: Activity Feed */}
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="font-semibold mb-3">Activity Feed</h2>
            {logs.length === 0 ? (
              <p className="text-sm text-gray-500">No activity yet.</p>
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {[...logs].reverse().map(log => (
                  <li key={log.id} className="text-sm flex gap-3">
                    <span className="text-gray-400 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        log.level === 'error'
                          ? 'text-red-600'
                          : log.level === 'warn'
                            ? 'text-yellow-600'
                            : 'text-gray-700'
                      }
                    >
                      {log.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {escalations.length > 0 && (
            <section className="bg-white rounded-lg border border-yellow-200 p-4">
              <h2 className="font-semibold mb-3">Escalations</h2>
              <ul className="space-y-2">
                {escalations.map(esc => (
                  <li key={esc.id} className="text-sm">
                    <span className="text-yellow-600 mr-2">!</span>
                    <span className="text-gray-600">{esc.storyId}:</span>{' '}
                    <span className="text-gray-800">{esc.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

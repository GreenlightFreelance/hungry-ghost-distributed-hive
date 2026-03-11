import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { type ConnectionStatus, useRunUpdates } from '../hooks/useRunUpdates';
import { useRunStore } from '../stores/runStore';
import type { Agent, Escalation, LogEntry, Run, Story } from '../types';

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

const connectionStatusLabel: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting…',
};

const connectionStatusColor: Record<ConnectionStatus, string> = {
  connecting: 'text-yellow-600',
  connected: 'text-green-600',
  disconnected: 'text-red-600',
  reconnecting: 'text-yellow-600',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(startIso: string, endIso: string): string {
  const diff = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function RunView() {
  const { id } = useParams<{ id: string }>();
  const {
    activeRun,
    stories,
    agents,
    logs,
    escalations,
    setActiveRun,
    setStories,
    setAgents,
    setLogs,
    setEscalations,
  } = useRunStore();
  const { get, post, del } = useApi();
  const { status: wsStatus } = useRunUpdates(id ?? null);
  const feedRef = useRef<HTMLUListElement>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch initial data on mount
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function fetchRunData() {
      try {
        const [run, storiesData, agentsData, logsData] = await Promise.all([
          get<Run>(`/runs/${id}`),
          get<Story[]>(`/runs/${id}/stories`),
          get<Agent[]>(`/runs/${id}/agents`),
          get<LogEntry[]>(`/runs/${id}/logs`),
        ]);
        if (cancelled) return;
        setActiveRun(run);
        setStories(storiesData);
        setAgents(agentsData);
        setLogs(logsData);
        setFetchError(null);
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setFetchError('Failed to load run data');
        }
      }
    }

    fetchRunData();
    return () => {
      cancelled = true;
    };
  }, [id, get, setActiveRun, setStories, setAgents, setLogs]);

  // Fetch escalations separately (may not exist for all runs)
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function fetchEscalations() {
      try {
        const data = await get<Escalation[]>(`/runs/${id}/escalations`);
        if (!cancelled) setEscalations(data);
      } catch {
        // Escalations endpoint may not exist yet — silently ignore
      }
    }

    fetchEscalations();
    return () => {
      cancelled = true;
    };
  }, [id, get, setEscalations]);

  // Auto-scroll activity feed when new logs arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCancel = useCallback(async () => {
    if (!id || cancelling) return;
    setCancelling(true);
    try {
      await del(`/runs/${id}`);
      setActiveRun({ ...activeRun!, status: 'cancelled' });
    } catch {
      // Error handled by useApi
    } finally {
      setCancelling(false);
    }
  }, [id, cancelling, del, activeRun, setActiveRun]);

  const handleReply = useCallback(
    async (escalationId: string, storyId: string) => {
      if (!id || !replyText.trim() || replyLoading) return;
      setReplyLoading(true);
      try {
        await post(`/runs/${id}/message`, {
          message: replyText.trim(),
          sender: 'user',
          escalationId,
          storyId,
        });
        setReplyText('');
        setReplyingTo(null);
      } catch {
        // Error handled by useApi
      } finally {
        setReplyLoading(false);
      }
    },
    [id, replyText, replyLoading, post]
  );

  if (fetchError) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link to="/" className="text-hive-600 hover:text-hive-700">
            &larr; Back
          </Link>
        </div>
        <p className="text-red-600">{fetchError}</p>
      </div>
    );
  }

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

  const doneCount = stories.filter(s => s.status === 'done' || s.status === 'merged').length;
  const isRunning = activeRun.status === 'running';
  const connectionLabel = connectionStatusLabel[wsStatus.current];
  const connectionColor = connectionStatusColor[wsStatus.current];

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-hive-600 hover:text-hive-700">
            &larr; Back
          </Link>
          <h1 className="text-xl font-bold">{activeRun.title}</h1>
          <span className={`text-xs font-medium ${connectionColor}`}>{connectionLabel}</span>
        </div>
        {isRunning && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="px-4 py-2 text-red-600 border border-red-300 rounded-md hover:bg-red-50 text-sm font-medium disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>

      {/* Run progress summary */}
      <div className="flex flex-wrap gap-4 mb-6 text-sm text-gray-600">
        <span>
          {doneCount}/{stories.length} stories
        </span>
        {activeRun.startedAt && isRunning && <span>Started {timeAgo(activeRun.startedAt)}</span>}
        {activeRun.startedAt && activeRun.completedAt && (
          <span>Duration: {formatDuration(activeRun.startedAt, activeRun.completedAt)}</span>
        )}
        {isRunning && activeRun.estimatedCost != null && (
          <span>~${activeRun.estimatedCost.toFixed(2)} est.</span>
        )}
        {activeRun.actualCost != null && <span>Cost: ${activeRun.actualCost.toFixed(2)}</span>}
        {!isRunning && (
          <span className="capitalize font-medium text-gray-700">{activeRun.status}</span>
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
                    {agent.currentStory && (
                      <span className="text-gray-500 text-xs ml-1">{agent.currentStory}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right column: Activity Feed + Escalations */}
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="font-semibold mb-3">Activity Feed</h2>
            {logs.length === 0 ? (
              <p className="text-sm text-gray-500">No activity yet.</p>
            ) : (
              <ul ref={feedRef} className="space-y-2 max-h-96 overflow-y-auto">
                {[...logs].reverse().map(log => (
                  <li key={log.id} className="text-sm flex gap-3">
                    <span className="text-gray-400 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-gray-500 text-xs whitespace-nowrap">{log.source}</span>
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
              <ul className="space-y-3">
                {escalations
                  .filter(esc => !esc.resolved)
                  .map(esc => (
                    <li key={esc.id} className="text-sm">
                      <div className="flex items-start gap-2">
                        <span className="text-yellow-600 mt-0.5">!</span>
                        <div className="flex-1">
                          <span className="text-gray-600 font-medium">{esc.storyId}:</span>{' '}
                          <span className="text-gray-800">{esc.message}</span>
                          <div className="mt-1">
                            {replyingTo === esc.id ? (
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={replyText}
                                  onChange={e => setReplyText(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleReply(esc.id, esc.storyId);
                                  }}
                                  placeholder="Type your reply…"
                                  className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleReply(esc.id, esc.storyId)}
                                  disabled={replyLoading || !replyText.trim()}
                                  className="px-2 py-1 text-xs bg-hive-600 text-white rounded hover:bg-hive-700 disabled:opacity-50"
                                >
                                  {replyLoading ? 'Sending…' : 'Send'}
                                </button>
                                <button
                                  onClick={() => {
                                    setReplyingTo(null);
                                    setReplyText('');
                                  }}
                                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setReplyingTo(esc.id)}
                                className="text-xs text-hive-600 hover:underline"
                              >
                                Reply
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
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

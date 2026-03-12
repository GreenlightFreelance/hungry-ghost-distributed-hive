import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { type ConnectionStatus, useRunUpdates } from '../hooks/useRunUpdates';
import { useRunStore } from '../stores/runStore';
import type { Agent, LogEntry, Run, Story } from '../types';
import { KanbanBoard } from '../components/KanbanBoard';
import { DependencyGraph } from '../components/DependencyGraph';

const agentStatusColors: Record<string, string> = {
  working: 'bg-green-500',
  done: 'bg-green-500',
  waiting: 'bg-yellow-500',
  idle: 'bg-gray-400',
  error: 'bg-red-500',
};

const connectionStatusLabel: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting…',
};

const connectionStatusColor: Record<ConnectionStatus, string> = {
  connecting: 'text-yellow-500',
  connected: 'text-green-500',
  disconnected: 'text-red-500',
  reconnecting: 'text-yellow-500',
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
    activeRun, stories, agents, logs, escalations,
    setActiveRun, setStories, setAgents, setLogs,
  } = useRunStore();
  const { get, post, del } = useApi();
  const { status: wsStatus } = useRunUpdates(id ?? null);
  const feedRef = useRef<HTMLUListElement>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function fetchRunData() {
      try {
        const run = await get<Run & { stories?: Story[]; agents?: Agent[]; logs?: LogEntry[] }>(`/api/runs/${id}`);
        if (cancelled) return;
        setActiveRun(run);
        setStories(run.stories || []);
        setAgents(run.agents || []);
        setLogs(run.logs || []);
        setFetchError(null);
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError'))
          setFetchError('Failed to load run data');
      }
    }
    fetchRunData();
    const interval = setInterval(fetchRunData, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id, get, setActiveRun, setStories, setAgents, setLogs]);

  // Escalations are not served by a separate endpoint yet

  const isAtBottomRef = useRef(true);
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const onScroll = () => { isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (isAtBottomRef.current && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [logs]);

  const handleCancel = useCallback(async () => {
    if (!id || cancelling) return;
    setCancelling(true);
    try { await del(`/api/runs/${id}`); setActiveRun({ ...activeRun!, status: 'cancelled' }); } catch {} finally { setCancelling(false); }
  }, [id, cancelling, del, activeRun, setActiveRun]);

  const handleReply = useCallback(
    async (escalationId: string, storyId: string) => {
      if (!id || !replyText.trim() || replyLoading) return;
      setReplyLoading(true);
      try { await post(`/api/runs/${id}/message`, { message: replyText.trim(), sender: 'user', escalationId, storyId }); setReplyText(''); setReplyingTo(null); } catch {} finally { setReplyLoading(false); }
    }, [id, replyText, replyLoading, post]
  );

  if (fetchError) {
    return (
      <div className="max-w-6xl mx-auto">
        <Link to="/" className="text-hive-500 hover:text-hive-400 text-sm">&larr; Back</Link>
        <p className="text-red-500 mt-4">{fetchError}</p>
      </div>
    );
  }

  if (!activeRun || activeRun.id !== id) {
    return (
      <div className="max-w-6xl mx-auto">
        <Link to="/" className="text-hive-500 hover:text-hive-400 text-sm">&larr; Back</Link>
        <p className="text-secondary mt-4">Loading run {id}...</p>
      </div>
    );
  }

  const doneCount = stories.filter(s => s.status === 'done' || s.status === 'merged').length;
  const isRunning = activeRun.status === 'running';
  const isPollingMode = !import.meta.env.VITE_WS_URL;
  const connectionLabel = isPollingMode ? 'Live' : connectionStatusLabel[wsStatus.current];
  const connectionColor = isPollingMode ? 'text-green-500' : connectionStatusColor[wsStatus.current];

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-hive-500 hover:text-hive-400 text-sm">&larr; Back</Link>
          <h1 className="text-xl font-bold text-heading">{activeRun.title}</h1>
          <span className={`flex items-center gap-1.5 text-xs font-medium ${connectionColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isPollingMode || wsStatus.current === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {connectionLabel}
          </span>
        </div>
        {isRunning && (
          <button onClick={handleCancel} disabled={cancelling}
            className="px-4 py-2 text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/10 text-sm font-medium disabled:opacity-50 transition-colors">
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>

      {/* Run progress summary */}
      <div className="flex flex-wrap gap-4 mb-6 text-sm text-secondary">
        <span className="font-mono">{doneCount}/{stories.length} stories</span>
        {activeRun.startedAt && isRunning && <span>Started {timeAgo(activeRun.startedAt)}</span>}
        {activeRun.startedAt && activeRun.completedAt && <span>Duration: {formatDuration(activeRun.startedAt, activeRun.completedAt)}</span>}
        {isRunning && activeRun.estimatedCost != null && <span>~${activeRun.estimatedCost.toFixed(2)} est.</span>}
        {activeRun.actualCost != null && <span>Cost: ${activeRun.actualCost.toFixed(2)}</span>}
        {!isRunning && <span className="capitalize font-medium text-muted">{activeRun.status}</span>}
      </div>

      {/* Kanban Board */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-section mb-3">Stories</h2>
        <KanbanBoard stories={stories} />
      </section>

      {/* Dependency Graph */}
      {stories.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-section mb-3">Dependency Graph</h2>
          <DependencyGraph stories={stories} />
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agents */}
        <div>
          <section className="card rounded-xl border p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-section mb-3">Agents</h2>
            {agents.length === 0 ? (
              <p className="text-sm text-muted">No agents yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {agents.map(agent => (
                  <li key={agent.id} className="flex items-center gap-2.5 text-sm">
                    <span className={`w-2 h-2 rounded-full ${agentStatusColors[agent.status] ?? 'bg-gray-500'} ${agent.status === 'working' ? 'animate-pulse' : ''}`} />
                    <span className="text-heading font-medium">{agent.role}</span>
                    <span className="text-muted">({agent.status})</span>
                    {agent.currentStory && <span className="text-secondary text-xs ml-1 font-mono">{agent.currentStory}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Activity Feed + Escalations */}
        <div className="lg:col-span-2 space-y-6">
          <section className="card rounded-xl border p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-section mb-3">Activity Feed</h2>
            {logs.length === 0 ? (
              <p className="text-sm text-muted">No activity yet.</p>
            ) : (
              <ul ref={feedRef} className="space-y-1.5 max-h-96 overflow-y-auto font-mono text-xs">
                {logs.map((log, i) => (
                  <li key={log.id ?? `log-${i}`} className={`flex gap-3 py-0.5 ${log.isMilestone ? 'font-semibold' : ''}`}>
                    <span className="text-muted whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-muted whitespace-nowrap truncate max-w-[120px]">
                      {log.source ?? log.agentId ?? ''}
                    </span>
                    <span className={
                      log.level === 'error' || log.eventType === 'ERROR' ? 'text-red-500'
                        : log.level === 'warn' ? 'text-yellow-500'
                        : log.isMilestone ? 'text-hive-400'
                        : 'text-label'
                    }>
                      {log.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {escalations.length > 0 && (
            <section className="card rounded-xl border border-yellow-500/30 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-yellow-500 mb-3">Escalations</h2>
              <ul className="space-y-3">
                {escalations.filter(esc => !esc.resolved).map(esc => (
                  <li key={esc.id} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-yellow-500 mt-0.5">!</span>
                      <div className="flex-1">
                        <span className="text-muted font-medium font-mono">{esc.storyId}:</span>{' '}
                        <span className="text-heading">{esc.message}</span>
                        <div className="mt-1.5">
                          {replyingTo === esc.id ? (
                            <div className="flex gap-2">
                              <input type="text" value={replyText}
                                onChange={e => setReplyText(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleReply(esc.id, esc.storyId); }}
                                placeholder="Type your reply…"
                                className="flex-1 px-2 py-1 text-xs card-input border rounded-lg"
                                autoFocus />
                              <button onClick={() => handleReply(esc.id, esc.storyId)}
                                disabled={replyLoading || !replyText.trim()}
                                className="px-2 py-1 text-xs bg-hive-600 text-white rounded-lg hover:bg-hive-700 disabled:opacity-50">
                                {replyLoading ? 'Sending…' : 'Send'}
                              </button>
                              <button onClick={() => { setReplyingTo(null); setReplyText(''); }}
                                className="px-2 py-1 text-xs text-muted hover:text-secondary">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setReplyingTo(esc.id)}
                              className="text-xs text-hive-500 hover:underline">Reply</button>
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

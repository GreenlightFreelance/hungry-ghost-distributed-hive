import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunView } from '../pages/RunView';
import { useRunStore } from '../stores/runStore';
import type { Agent, Escalation, LogEntry, Run, Story } from '../types';

// Mock useApi
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDel = vi.fn();
vi.mock('../hooks/useApi', () => ({
  useApi: () => ({ get: mockGet, post: mockPost, del: mockDel, loading: false, error: null }),
  ApiError: class ApiError extends Error {
    statusCode: number;
    constructor(code: number, msg: string) {
      super(msg);
      this.statusCode = code;
    }
  },
}));

// Mock useRunUpdates
const mockStatus = { current: 'connected' as const };
const mockDisconnect = vi.fn();
vi.mock('../hooks/useRunUpdates', () => ({
  useRunUpdates: () => ({ status: mockStatus, disconnect: mockDisconnect }),
}));

const testRun: Run = {
  id: 'run-1',
  title: 'Add OAuth login',
  description: 'OAuth feature',
  status: 'running',
  repositories: ['service-a'],
  stories: [],
  agents: [],
  createdAt: new Date(Date.now() - 120 * 60_000).toISOString(),
  startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  estimatedCost: 2.3,
  sizeTier: 'medium',
  model: 'claude-opus-4-6',
};

const testStories: Story[] = [
  {
    id: 'STR-001',
    title: 'Create OAuth flow',
    points: 3,
    status: 'done',
    assignee: 'junior-1',
    prNumber: 142,
    prUrl: 'https://github.com/org/repo/pull/142',
  },
  {
    id: 'STR-002',
    title: 'Add token refresh',
    points: 5,
    status: 'in_progress',
    assignee: 'senior-1',
  },
  { id: 'STR-003', title: 'Add logout button', points: 2, status: 'todo' },
];

const testAgents: Agent[] = [
  { id: 'a1', role: 'tech-lead', status: 'done' },
  { id: 'a2', role: 'senior-1', status: 'working', currentStory: 'STR-002' },
  { id: 'a3', role: 'junior-1', status: 'waiting' },
  { id: 'a4', role: 'qa-1', status: 'idle' },
];

const testLogs: LogEntry[] = [
  {
    id: 'log-1',
    timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
    message: 'Run started',
    source: 'system',
    level: 'info',
  },
  {
    id: 'log-2',
    timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
    message: 'Senior started STR-002',
    source: 'senior-1',
    level: 'info',
  },
  {
    id: 'log-3',
    timestamp: new Date(Date.now() - 2 * 60_000).toISOString(),
    message: 'Build failed for STR-003',
    source: 'junior-1',
    level: 'error',
  },
];

const testEscalations: Escalation[] = [
  {
    id: 'esc-1',
    storyId: 'STR-004',
    message: 'Ambiguous requirement - which OAuth provider?',
    timestamp: new Date().toISOString(),
    resolved: false,
  },
];

function renderRunView(runId = 'run-1') {
  return render(
    <MemoryRouter initialEntries={[`/run/${runId}`]}>
      <Routes>
        <Route path="/run/:id" element={<RunView />} />
      </Routes>
    </MemoryRouter>
  );
}

function seedStore() {
  const store = useRunStore.getState();
  store.setActiveRun(testRun);
  store.setStories(testStories);
  store.setAgents(testAgents);
  store.setLogs(testLogs);
  store.setEscalations(testEscalations);
}

describe('RunView', () => {
  beforeEach(() => {
    useRunStore.getState().reset();
    vi.clearAllMocks();
    mockGet.mockRejectedValue(new Error('not mocked'));
    mockStatus.current = 'connected';
  });

  describe('loading and error states', () => {
    it('shows loading state when run data is not yet loaded', () => {
      mockGet.mockReturnValue(new Promise(() => {})); // never resolves
      renderRunView();
      expect(screen.getByText('Loading run run-1...')).toBeInTheDocument();
    });

    it('shows error state when fetch fails', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      renderRunView();
      await waitFor(() => {
        expect(screen.getByText('Failed to load run data')).toBeInTheDocument();
      });
    });

    it('renders back link on loading state', () => {
      mockGet.mockReturnValue(new Promise(() => {}));
      renderRunView();
      expect(screen.getByText(/Back/)).toBeInTheDocument();
    });
  });

  describe('data fetching', () => {
    it('fetches run, stories, agents, and logs on mount', () => {
      mockGet.mockReturnValue(new Promise(() => {}));
      renderRunView('run-1');
      expect(mockGet).toHaveBeenCalledWith('/runs/run-1');
      expect(mockGet).toHaveBeenCalledWith('/runs/run-1/stories');
      expect(mockGet).toHaveBeenCalledWith('/runs/run-1/agents');
      expect(mockGet).toHaveBeenCalledWith('/runs/run-1/logs');
    });
  });

  describe('header', () => {
    it('renders run title', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('Add OAuth login')).toBeInTheDocument();
    });

    it('shows connection status', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('shows Cancel button for running runs', () => {
      seedStore();
      renderRunView();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('hides Cancel button for completed runs', () => {
      seedStore();
      useRunStore.getState().setActiveRun({ ...testRun, status: 'completed' });
      renderRunView();
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });
  });

  describe('progress summary', () => {
    it('shows story progress count', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('1/3 stories')).toBeInTheDocument();
    });

    it('shows started time for running run', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText(/Started .+ ago/)).toBeInTheDocument();
    });

    it('shows estimated cost for running run', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('~$2.30 est.')).toBeInTheDocument();
    });

    it('shows status for non-running run', () => {
      seedStore();
      useRunStore.getState().setActiveRun({ ...testRun, status: 'completed' });
      renderRunView();
      expect(screen.getByText('completed')).toBeInTheDocument();
    });

    it('shows duration for completed run', () => {
      seedStore();
      const completed = {
        ...testRun,
        status: 'completed' as const,
        startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        completedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
      };
      useRunStore.getState().setActiveRun(completed);
      renderRunView();
      expect(screen.getByText(/Duration:/)).toBeInTheDocument();
    });
  });

  describe('stories panel', () => {
    it('renders all stories', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('Create OAuth flow')).toBeInTheDocument();
      expect(screen.getByText('Add token refresh')).toBeInTheDocument();
      expect(screen.getByText('Add logout button')).toBeInTheDocument();
    });

    it('shows story IDs and points', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('STR-001')).toBeInTheDocument();
      expect(screen.getByText('(3pts)')).toBeInTheDocument();
    });

    it('shows assignee for assigned stories', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('Agent: senior-1')).toBeInTheDocument();
    });

    it('shows PR link for stories with PRs', () => {
      seedStore();
      renderRunView();
      const prLink = screen.getByText('PR #142');
      expect(prLink).toHaveAttribute('href', 'https://github.com/org/repo/pull/142');
      expect(prLink).toHaveAttribute('target', '_blank');
    });

    it('shows empty state when no stories', () => {
      useRunStore.getState().setActiveRun(testRun);
      renderRunView();
      expect(screen.getByText('No stories yet.')).toBeInTheDocument();
    });
  });

  describe('agents panel', () => {
    it('renders all agents', () => {
      seedStore();
      renderRunView();
      const agentsSection = screen.getByRole('heading', { name: 'Agents' }).closest('section')!;
      expect(agentsSection).toHaveTextContent('tech-lead');
      expect(agentsSection).toHaveTextContent('senior-1');
      expect(agentsSection).toHaveTextContent('junior-1');
      expect(agentsSection).toHaveTextContent('qa-1');
    });

    it('shows agent status', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('(working)')).toBeInTheDocument();
      expect(screen.getByText('(idle)')).toBeInTheDocument();
    });

    it('shows current story for working agents', () => {
      seedStore();
      renderRunView();
      const agentsSection = screen.getByRole('heading', { name: 'Agents' }).closest('section')!;
      expect(agentsSection).toHaveTextContent('STR-002');
    });

    it('shows empty state when no agents', () => {
      useRunStore.getState().setActiveRun(testRun);
      renderRunView();
      expect(screen.getByText('No agents yet.')).toBeInTheDocument();
    });
  });

  describe('activity feed', () => {
    it('renders log entries', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('Run started')).toBeInTheDocument();
      expect(screen.getByText('Senior started STR-002')).toBeInTheDocument();
    });

    it('shows log source', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('system')).toBeInTheDocument();
    });

    it('applies error styling to error logs', () => {
      seedStore();
      renderRunView();
      const errorMsg = screen.getByText('Build failed for STR-003');
      expect(errorMsg).toHaveClass('text-red-600');
    });

    it('shows empty state when no logs', () => {
      useRunStore.getState().setActiveRun(testRun);
      renderRunView();
      expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    });
  });

  describe('escalations', () => {
    it('renders escalation messages', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText(/Ambiguous requirement/)).toBeInTheDocument();
    });

    it('shows story ID for escalation', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('STR-004:')).toBeInTheDocument();
    });

    it('shows Reply button', () => {
      seedStore();
      renderRunView();
      expect(screen.getByText('Reply')).toBeInTheDocument();
    });

    it('opens reply input when Reply is clicked', () => {
      seedStore();
      renderRunView();
      fireEvent.click(screen.getByText('Reply'));
      expect(screen.getByPlaceholderText('Type your reply…')).toBeInTheDocument();
    });

    it('sends reply and clears input', async () => {
      mockPost.mockResolvedValue({ messageId: 'msg-1', status: 'sent' });
      seedStore();
      renderRunView();

      fireEvent.click(screen.getByText('Reply'));
      const input = screen.getByPlaceholderText('Type your reply…');
      fireEvent.change(input, { target: { value: 'Use GitHub OAuth' } });
      fireEvent.click(screen.getByText('Send'));

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/runs/run-1/message', {
          message: 'Use GitHub OAuth',
          sender: 'user',
          escalationId: 'esc-1',
          storyId: 'STR-004',
        });
      });
    });

    it('hides escalation section when no escalations', () => {
      useRunStore.getState().setActiveRun(testRun);
      useRunStore.getState().setStories(testStories);
      useRunStore.getState().setAgents(testAgents);
      useRunStore.getState().setLogs(testLogs);
      renderRunView();
      expect(screen.queryByText('Escalations')).not.toBeInTheDocument();
    });

    it('hides resolved escalations', () => {
      seedStore();
      useRunStore.getState().setEscalations([
        {
          id: 'esc-1',
          storyId: 'STR-004',
          message: 'Ambiguous requirement - which OAuth provider?',
          timestamp: new Date().toISOString(),
          resolved: true,
        },
      ]);
      renderRunView();
      expect(screen.queryByText(/Ambiguous requirement/)).not.toBeInTheDocument();
    });

    it('closes reply form when Cancel is clicked', () => {
      seedStore();
      renderRunView();
      fireEvent.click(screen.getByText('Reply'));
      expect(screen.getByPlaceholderText('Type your reply…')).toBeInTheDocument();

      // The Cancel button in the reply form
      const cancelButtons = screen.getAllByText('Cancel');
      const replyCancelBtn = cancelButtons.find(btn => btn.classList.contains('text-xs'));
      fireEvent.click(replyCancelBtn!);
      expect(screen.queryByPlaceholderText('Type your reply…')).not.toBeInTheDocument();
    });
  });

  describe('cancel run', () => {
    it('calls delete API when Cancel is clicked', async () => {
      mockDel.mockResolvedValue({});
      seedStore();
      renderRunView();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(mockDel).toHaveBeenCalledWith('/runs/run-1');
      });
    });

    it('updates run status to cancelled after successful cancel', async () => {
      mockDel.mockResolvedValue({});
      seedStore();
      renderRunView();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(useRunStore.getState().activeRun?.status).toBe('cancelled');
      });
    });
  });
});

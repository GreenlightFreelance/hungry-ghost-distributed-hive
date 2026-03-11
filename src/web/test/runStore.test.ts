import { beforeEach, describe, expect, it } from 'vitest';
import { useRunStore } from '../stores/runStore';
import type { Agent, LogEntry, Run, Story } from '../types';

const mockRun: Run = {
  id: 'run-1',
  title: 'Test Run',
  description: 'A test run',
  status: 'running',
  repositories: ['https://github.com/org/repo'],
  stories: [],
  agents: [],
  createdAt: '2024-01-01T00:00:00Z',
  sizeTier: 'medium',
  model: 'Claude Opus 4.6',
};

const mockStory: Story = {
  id: 'STR-001',
  title: 'Test story',
  points: 3,
  status: 'in_progress',
  assignee: 'senior-1',
};

const mockAgent: Agent = {
  id: 'agent-1',
  role: 'senior',
  status: 'working',
  currentStory: 'STR-001',
};

const mockLog: LogEntry = {
  id: 'log-1',
  timestamp: '2024-01-01T00:00:00Z',
  message: 'Run started',
  source: 'system',
  level: 'info',
};

describe('runStore', () => {
  beforeEach(() => {
    useRunStore.getState().reset();
  });

  it('sets and retrieves runs', () => {
    useRunStore.getState().setRuns([mockRun]);
    expect(useRunStore.getState().runs).toHaveLength(1);
    expect(useRunStore.getState().runs[0]?.id).toBe('run-1');
  });

  it('sets active run', () => {
    useRunStore.getState().setActiveRun(mockRun);
    expect(useRunStore.getState().activeRun?.id).toBe('run-1');
  });

  it('manages stories', () => {
    useRunStore.getState().setStories([mockStory]);
    expect(useRunStore.getState().stories).toHaveLength(1);

    useRunStore.getState().updateStory({ ...mockStory, status: 'done' });
    expect(useRunStore.getState().stories[0]?.status).toBe('done');
  });

  it('manages agents', () => {
    useRunStore.getState().setAgents([mockAgent]);
    expect(useRunStore.getState().agents).toHaveLength(1);

    useRunStore.getState().updateAgent({ ...mockAgent, status: 'idle' });
    expect(useRunStore.getState().agents[0]?.status).toBe('idle');
  });

  it('adds logs', () => {
    useRunStore.getState().addLog(mockLog);
    expect(useRunStore.getState().logs).toHaveLength(1);
    expect(useRunStore.getState().logs[0]?.message).toBe('Run started');
  });

  it('resets state', () => {
    useRunStore.getState().setRuns([mockRun]);
    useRunStore.getState().setActiveRun(mockRun);
    useRunStore.getState().reset();
    expect(useRunStore.getState().runs).toHaveLength(0);
    expect(useRunStore.getState().activeRun).toBeNull();
  });
});

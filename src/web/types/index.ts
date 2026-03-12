export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type StoryStatus = 'draft' | 'estimated' | 'planned' | 'in_progress' | 'review' | 'qa' | 'qa_failed' | 'pr_submitted' | 'merged' | 'done' | 'todo';

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'done' | 'error';

export interface Run {
  id: string;
  title: string;
  description: string;
  status: RunStatus;
  repositories: string[];
  stories: Story[];
  agents: Agent[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedCost?: number;
  actualCost?: number;
  sizeTier: 'small' | 'medium' | 'large';
  model: string;
}

export interface Story {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  points?: number;
  complexityScore?: number;
  status: StoryStatus;
  assignee?: string;
  assignedAgentId?: string;
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
  dependencies?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Agent {
  id: string;
  role: string;
  status: AgentStatus;
  currentStory?: string;
}

export interface LogEntry {
  id?: string;
  timestamp: string;
  message: string;
  source?: string;
  level?: 'info' | 'warn' | 'error';
  eventType?: string;
  agentId?: string;
  storyId?: string;
  isMilestone?: boolean;
}

export interface Escalation {
  id: string;
  storyId: string;
  message: string;
  timestamp: string;
  resolved: boolean;
}

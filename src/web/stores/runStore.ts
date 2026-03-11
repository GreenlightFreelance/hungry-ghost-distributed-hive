import { create } from "zustand";
import type { Agent, Escalation, LogEntry, Run, Story } from "../types";

interface RunState {
  runs: Run[];
  activeRun: Run | null;
  stories: Story[];
  agents: Agent[];
  logs: LogEntry[];
  escalations: Escalation[];

  setRuns: (runs: Run[]) => void;
  setActiveRun: (run: Run | null) => void;
  setStories: (stories: Story[]) => void;
  setAgents: (agents: Agent[]) => void;
  addLog: (log: LogEntry) => void;
  setLogs: (logs: LogEntry[]) => void;
  addEscalation: (escalation: Escalation) => void;
  setEscalations: (escalations: Escalation[]) => void;
  updateStory: (story: Story) => void;
  updateAgent: (agent: Agent) => void;
  reset: () => void;
}

const initialState = {
  runs: [],
  activeRun: null,
  stories: [],
  agents: [],
  logs: [],
  escalations: [],
};

export const useRunStore = create<RunState>((set) => ({
  ...initialState,

  setRuns: (runs) => set({ runs }),
  setActiveRun: (run) => set({ activeRun: run }),
  setStories: (stories) => set({ stories }),
  setAgents: (agents) => set({ agents }),

  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  setLogs: (logs) => set({ logs }),

  addEscalation: (escalation) =>
    set((state) => ({ escalations: [...state.escalations, escalation] })),
  setEscalations: (escalations) => set({ escalations }),

  updateStory: (story) =>
    set((state) => ({
      stories: state.stories.map((s) => (s.id === story.id ? story : s)),
    })),

  updateAgent: (agent) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === agent.id ? agent : a)),
    })),

  reset: () => set(initialState),
}));

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../pages/Dashboard";
import { useRunStore } from "../stores/runStore";
import type { Run } from "../types";

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
const twoHoursAgo = new Date(Date.now() - 120 * 60_000).toISOString();

const activeRun: Run = {
  id: "run-active",
  title: "Add OAuth login",
  description: "OAuth feature",
  status: "running",
  repositories: ["service-a", "service-b"],
  stories: [
    { id: "STR-001", title: "s1", points: 3, status: "done" },
    { id: "STR-002", title: "s2", points: 5, status: "in_progress" },
    { id: "STR-003", title: "s3", points: 2, status: "todo" },
  ],
  agents: [
    { id: "a1", role: "senior", status: "working" },
    { id: "a2", role: "junior", status: "idle" },
  ],
  createdAt: twoHoursAgo,
  startedAt: oneHourAgo,
  estimatedCost: 2.3,
  sizeTier: "medium",
  model: "claude-opus-4-6",
};

const completedRun: Run = {
  id: "run-done",
  title: "Fix pagination bug",
  description: "Pagination fix",
  status: "completed",
  repositories: ["service-a"],
  stories: [
    { id: "STR-010", title: "s10", points: 2, status: "merged" },
    { id: "STR-011", title: "s11", points: 2, status: "merged" },
  ],
  agents: [{ id: "a3", role: "senior", status: "done" }],
  createdAt: twoHoursAgo,
  startedAt: twoHoursAgo,
  completedAt: oneHourAgo,
  actualCost: 0.85,
  sizeTier: "small",
  model: "claude-opus-4-6",
};

describe("Dashboard", () => {
  beforeEach(() => {
    useRunStore.getState().reset();
  });

  it("renders heading and new run link", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ New Run" })).toBeInTheDocument();
  });

  it("shows empty state when no runs", () => {
    renderDashboard();
    expect(screen.getByText("No active runs.")).toBeInTheDocument();
    expect(screen.getByText("No completed runs yet.")).toBeInTheDocument();
  });

  it("renders active run card with status indicator", () => {
    useRunStore.getState().setRuns([activeRun]);
    renderDashboard();
    expect(screen.getByText("Add OAuth login")).toBeInTheDocument();
    expect(screen.getByText("1/3 stories")).toBeInTheDocument();
    expect(screen.getByText("2 repos")).toBeInTheDocument();
  });

  it("shows agents active count for active run", () => {
    useRunStore.getState().setRuns([activeRun]);
    renderDashboard();
    expect(screen.getByText("1 agents active")).toBeInTheDocument();
  });

  it("shows estimated cost for active run", () => {
    useRunStore.getState().setRuns([activeRun]);
    renderDashboard();
    expect(screen.getByText("~$2.30 est.")).toBeInTheDocument();
  });

  it("shows started time ago for active run", () => {
    useRunStore.getState().setRuns([activeRun]);
    renderDashboard();
    expect(screen.getByText(/Started .+ ago/)).toBeInTheDocument();
  });

  it("renders completed run card", () => {
    useRunStore.getState().setRuns([completedRun]);
    renderDashboard();
    expect(screen.getByText("Fix pagination bug")).toBeInTheDocument();
    expect(screen.getByText("2/2 stories")).toBeInTheDocument();
  });

  it("shows duration for completed run", () => {
    useRunStore.getState().setRuns([completedRun]);
    renderDashboard();
    expect(screen.getByText(/Duration:/)).toBeInTheDocument();
  });

  it("shows actual cost for completed run", () => {
    useRunStore.getState().setRuns([completedRun]);
    renderDashboard();
    expect(screen.getByText("Cost: $0.85")).toBeInTheDocument();
  });

  it("shows completed time ago for completed run", () => {
    useRunStore.getState().setRuns([completedRun]);
    renderDashboard();
    expect(screen.getByText(/Completed .+ ago/)).toBeInTheDocument();
  });

  it("separates active and completed runs into correct sections", () => {
    useRunStore.getState().setRuns([activeRun, completedRun]);
    renderDashboard();

    const activeSection = screen.getByRole("heading", { name: "Active Runs" }).closest("section")!;
    const completedSection = screen.getByRole("heading", { name: "Recent Completed" }).closest("section")!;

    expect(activeSection).toHaveTextContent("Add OAuth login");
    expect(activeSection).not.toHaveTextContent("Fix pagination bug");
    expect(completedSection).toHaveTextContent("Fix pagination bug");
    expect(completedSection).not.toHaveTextContent("Add OAuth login");
  });

  it("active run card links to /run/:id", () => {
    useRunStore.getState().setRuns([activeRun]);
    renderDashboard();
    const link = screen.getByRole("link", { name: /Add OAuth login/ });
    expect(link).toHaveAttribute("href", "/run/run-active");
  });
});

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";

function renderApp(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  it("renders dashboard at /", () => {
    renderApp("/");
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Active Runs")).toBeInTheDocument();
  });

  it("renders submit run page at /submit", () => {
    renderApp("/submit");
    expect(screen.getByRole("heading", { name: "New Run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit Run" })).toBeInTheDocument();
  });

  it("renders run view at /run/:id", () => {
    renderApp("/run/test-123");
    expect(screen.getByText(/Loading run/)).toBeInTheDocument();
  });

  it("renders settings at /settings", () => {
    renderApp("/settings");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders navigation links", () => {
    renderApp("/");
    expect(screen.getByText("Distributed Hive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New Run" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });
});

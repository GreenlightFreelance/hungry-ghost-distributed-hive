import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitRun } from "../pages/SubmitRun";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderSubmitRun() {
  return render(
    <MemoryRouter>
      <SubmitRun />
    </MemoryRouter>,
  );
}

describe("SubmitRun", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("rendering", () => {
    it("renders page heading", () => {
      renderSubmitRun();
      expect(screen.getByRole("heading", { name: "New Run" })).toBeInTheDocument();
    });

    it("renders title input", () => {
      renderSubmitRun();
      expect(screen.getByLabelText("Requirement Title")).toBeInTheDocument();
    });

    it("renders description textarea", () => {
      renderSubmitRun();
      expect(screen.getByLabelText("Description")).toBeInTheDocument();
    });

    it("renders one repository input by default", () => {
      renderSubmitRun();
      const repoInputs = screen.getAllByPlaceholderText("https://github.com/org/repo");
      expect(repoInputs).toHaveLength(1);
    });

    it("renders submit button", () => {
      renderSubmitRun();
      expect(screen.getByRole("button", { name: "Submit Run" })).toBeInTheDocument();
    });

    it("submit button is disabled when title is empty", () => {
      renderSubmitRun();
      expect(screen.getByRole("button", { name: "Submit Run" })).toBeDisabled();
    });

    it("submit button is enabled when title is filled", async () => {
      renderSubmitRun();
      await userEvent.type(screen.getByLabelText("Requirement Title"), "My Feature");
      expect(screen.getByRole("button", { name: "Submit Run" })).toBeEnabled();
    });
  });

  describe("repository management", () => {
    it("adds a repository input when clicking Add repository", async () => {
      renderSubmitRun();
      await userEvent.click(screen.getByText("+ Add repository"));
      const repoInputs = screen.getAllByPlaceholderText("https://github.com/org/repo");
      expect(repoInputs).toHaveLength(2);
    });

    it("does not show Remove button when only one repository", () => {
      renderSubmitRun();
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    });

    it("shows Remove button when multiple repositories exist", async () => {
      renderSubmitRun();
      await userEvent.click(screen.getByText("+ Add repository"));
      expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    });

    it("removes a repository when clicking Remove", async () => {
      renderSubmitRun();
      await userEvent.click(screen.getByText("+ Add repository"));
      const removeButtons = screen.getAllByRole("button", { name: "Remove" });
      await userEvent.click(removeButtons[0]!);
      const repoInputs = screen.getAllByPlaceholderText("https://github.com/org/repo");
      expect(repoInputs).toHaveLength(1);
    });

    it("updates repository value on input", async () => {
      renderSubmitRun();
      const repoInput = screen.getByPlaceholderText("https://github.com/org/repo");
      await userEvent.type(repoInput, "https://github.com/org/repo1");
      expect(repoInput).toHaveValue("https://github.com/org/repo1");
    });
  });

  describe("advanced options", () => {
    it("hides advanced options by default", () => {
      renderSubmitRun();
      expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Size Tier")).not.toBeInTheDocument();
    });

    it("toggles advanced options visibility", async () => {
      renderSubmitRun();
      await userEvent.click(screen.getByText("Show Advanced Options"));
      expect(screen.getByLabelText("Model")).toBeInTheDocument();
      expect(screen.getByLabelText("Size Tier")).toBeInTheDocument();
    });

    it("hides advanced options when toggled again", async () => {
      renderSubmitRun();
      await userEvent.click(screen.getByText("Show Advanced Options"));
      await userEvent.click(screen.getByText("Hide Advanced Options"));
      expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
    });

    it("renders model options", async () => {
      renderSubmitRun();
      await userEvent.click(screen.getByText("Show Advanced Options"));
      const modelSelect = screen.getByLabelText("Model");
      expect(modelSelect).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Claude Opus 4.6" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Claude Sonnet 4.6" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Claude Haiku 4.5" })).toBeInTheDocument();
    });

    it("renders size tier options", async () => {
      renderSubmitRun();
      await userEvent.click(screen.getByText("Show Advanced Options"));
      expect(screen.getByRole("option", { name: "Small (2 vCPU, 8GB)" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Medium (4 vCPU, 16GB)" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Large (8 vCPU, 32GB)" })).toBeInTheDocument();
    });

    it("defaults model to Claude Opus 4.6", async () => {
      renderSubmitRun();
      await userEvent.click(screen.getByText("Show Advanced Options"));
      expect(screen.getByLabelText("Model")).toHaveValue("Claude Opus 4.6");
    });

    it("defaults size tier to medium", async () => {
      renderSubmitRun();
      await userEvent.click(screen.getByText("Show Advanced Options"));
      expect(screen.getByLabelText("Size Tier")).toHaveValue("medium");
    });
  });

  describe("form submission", () => {
    it("submits form with correct payload", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "run-123" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      renderSubmitRun();
      await userEvent.type(screen.getByLabelText("Requirement Title"), "Add auth");
      await userEvent.type(screen.getByLabelText("Description"), "OAuth2 support");
      const repoInput = screen.getByPlaceholderText("https://github.com/org/repo");
      await userEvent.type(repoInput, "https://github.com/org/repo1");

      fireEvent.submit(screen.getByRole("button", { name: "Submit Run" }).closest("form")!);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Add auth",
            description: "OAuth2 support",
            repositories: ["https://github.com/org/repo1"],
            model: "Claude Opus 4.6",
            sizeTier: "medium",
          }),
        });
      });
    });

    it("navigates to run view on successful submission", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ id: "run-abc" }),
        }),
      );

      renderSubmitRun();
      await userEvent.type(screen.getByLabelText("Requirement Title"), "My title");
      fireEvent.submit(screen.getByRole("button", { name: "Submit Run" }).closest("form")!);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith("/run/run-abc");
      });
    });

    it("shows submitting state during fetch", async () => {
      let resolvePromise!: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockReturnValue(pendingPromise),
      );

      renderSubmitRun();
      await userEvent.type(screen.getByLabelText("Requirement Title"), "My title");
      fireEvent.submit(screen.getByRole("button", { name: "Submit Run" }).closest("form")!);

      expect(await screen.findByRole("button", { name: "Submitting..." })).toBeInTheDocument();

      resolvePromise({ ok: false, json: async () => ({}) });
    });

    it("filters empty repository URLs from submission", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "run-xyz" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      renderSubmitRun();
      await userEvent.type(screen.getByLabelText("Requirement Title"), "Test");
      await userEvent.click(screen.getByText("+ Add repository"));
      const repoInputs = screen.getAllByPlaceholderText("https://github.com/org/repo");
      await userEvent.type(repoInputs[0]!, "https://github.com/org/main-repo");
      // second repo left empty

      fireEvent.submit(screen.getByRole("button", { name: "Submit Run" }).closest("form")!);

      await waitFor(() => {
        const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1]?.body as string);
        expect(body.repositories).toEqual(["https://github.com/org/main-repo"]);
      });
    });

    it("does not navigate when response is not ok", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({}),
        }),
      );

      renderSubmitRun();
      await userEvent.type(screen.getByLabelText("Requirement Title"), "My title");
      fireEvent.submit(screen.getByRole("button", { name: "Submit Run" }).closest("form")!);

      await waitFor(() => {
        expect(mockNavigate).not.toHaveBeenCalled();
      });
    });
  });
});

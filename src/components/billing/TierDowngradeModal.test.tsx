// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const M = vi.hoisted(() => ({
  preview: vi.fn(),
  archive: vi.fn(),
  exportThenArchive: vi.fn(),
}));

vi.mock("../../services/billing/tierDowngradeClient", () => ({
  loadTierDowngradePreview: M.preview,
  archiveTierDowngrade: M.archive,
  exportThenArchiveTierDowngrade: M.exportThenArchive,
}));

import { TierDowngradeModal } from "./TierDowngradeModal";

const overagePreview = {
  sourceTier: "oro",
  targetTier: "gratis",
  overages: {
    projects: {
      count: 2,
      current: 3,
      cap: 1,
      candidateIds: ["p-oldest", "p-middle"],
    },
    workers: {
      count: 2,
      capPerProject: 3,
      projects: [
        {
          projectId: "p-owned",
          current: 5,
          cap: 3,
          count: 2,
          candidateIds: ["p-owned/w-oldest", "p-owned/w-middle"],
        },
      ],
    },
  },
};

const noOveragePreview = {
  sourceTier: "oro",
  targetTier: "gratis",
  overages: {
    projects: { count: 0, current: 1, cap: 1, candidateIds: [] },
    workers: { count: 0, capPerProject: 3, projects: [] },
  },
};

function renderModal(
  overrides: Partial<React.ComponentProps<typeof TierDowngradeModal>> = {},
) {
  const props: React.ComponentProps<typeof TierDowngradeModal> = {
    fromTier: "oro",
    toTier: "gratis",
    toTierLabel: "Gratis",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<TierDowngradeModal {...props} />);
  return props;
}

describe("TierDowngradeModal", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    M.preview.mockResolvedValue(overagePreview);
    M.archive.mockResolvedValue({ success: true, archivedCount: 2 });
    M.exportThenArchive.mockResolvedValue({ success: true, archivedCount: 2 });
  });

  it("renders authoritative per-faena worker and active-project overages from the server", async () => {
    renderModal();

    expect(screen.getByTestId("tier-downgrade-loading")).toBeTruthy();
    const workers = await screen.findByTestId(
      "tier-downgrade-category-workers",
    );
    expect(workers.textContent).toContain("2 trabajadores");
    expect(workers.textContent).toContain("1 faena");
    expect(workers.textContent).toContain("3 por faena");

    const projects = screen.getByTestId("tier-downgrade-category-projects");
    expect(projects.textContent).toContain("3 proyectos activos");
    expect(projects.textContent).toContain("1");
    expect(projects.textContent).toContain("Sobran 2");
    expect(M.preview).toHaveBeenCalledWith("gratis");
    expect(
      (screen.getByTestId("tier-downgrade-confirm") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("calls the real archive action, refreshes preview, and only then enables confirm", async () => {
    M.preview
      .mockResolvedValueOnce(overagePreview)
      .mockResolvedValueOnce(noOveragePreview);
    renderModal();

    fireEvent.click(
      await screen.findByTestId("tier-downgrade-archive-workers"),
    );

    await waitFor(() =>
      expect(M.archive).toHaveBeenCalledWith("workers", "gratis"),
    );
    await screen.findByTestId("tier-downgrade-no-overages");
    expect(screen.getByRole("status").textContent).toContain("2");
    expect(
      (screen.getByTestId("tier-downgrade-confirm") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("uses export-then-archive for the download action and refreshes from the server", async () => {
    M.preview
      .mockResolvedValueOnce(overagePreview)
      .mockResolvedValueOnce(noOveragePreview);
    renderModal();

    fireEvent.click(
      await screen.findByTestId("tier-downgrade-export-projects"),
    );

    await waitFor(() =>
      expect(M.exportThenArchive).toHaveBeenCalledWith("projects", "gratis"),
    );
    await screen.findByTestId("tier-downgrade-no-overages");
  });

  it("surfaces a real server failure and never enables confirm or reports success", async () => {
    M.archive.mockRejectedValue(new Error("downgrade_candidates_changed"));
    renderModal();

    fireEvent.click(
      await screen.findByTestId("tier-downgrade-archive-workers"),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("downgrade_candidates_changed");
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      (screen.getByTestId("tier-downgrade-confirm") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("enables confirm and calls onConfirm when the authoritative preview has no overages", async () => {
    M.preview.mockResolvedValue(noOveragePreview);
    const onConfirm = vi.fn();
    renderModal({ onConfirm });

    await screen.findByTestId("tier-downgrade-no-overages");
    const confirm = screen.getByTestId(
      "tier-downgrade-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

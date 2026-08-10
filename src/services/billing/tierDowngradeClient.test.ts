// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/apiAuth", () => ({
  apiAuthHeaderOrThrow: vi.fn(async () => "Bearer test-token"),
}));

import {
  archiveTierDowngrade,
  exportThenArchiveTierDowngrade,
  loadTierDowngradePreview,
} from "./tierDowngradeClient";

const previewBody = {
  sourceTier: "oro",
  targetTier: "gratis",
  overages: {
    projects: { count: 2, candidateIds: ["p-1", "p-2"] },
    workers: { count: 0, projects: [] },
  },
};

const exportBody = {
  fingerprint: "a".repeat(64),
  backup: {
    version: 1,
    generatedAt: "2026-08-09T00:00:00.000Z",
    sourceTier: "oro",
    targetTier: "gratis",
    category: "projects",
    count: 2,
    records: [],
  },
};

describe("tierDowngradeClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:tier-downgrade"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("loads the server-authoritative preview with an authenticated strict payload", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(previewBody), { status: 200 }),
      );

    await expect(loadTierDowngradePreview("gratis")).resolves.toEqual(
      previewBody,
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/tier-downgrade/preview", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetTier: "gratis" }),
    });
  });

  it("starts the real JSON download before archiving the fingerprinted candidate set", async () => {
    const anchor = document.createElement("a");
    const clickSpy = vi
      .spyOn(anchor, "click")
      .mockImplementation(() => undefined);
    vi.spyOn(document, "createElement").mockImplementation((tag) =>
      tag === "a" ? anchor : document.createElement(tag),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exportBody), { status: 200 }),
      )
      .mockImplementationOnce(async () => {
        expect(clickSpy).toHaveBeenCalledTimes(1);
        return new Response(
          JSON.stringify({ success: true, archivedCount: 2 }),
          {
            status: 200,
          },
        );
      });

    await expect(
      exportThenArchiveTierDowngrade("projects", "gratis"),
    ).resolves.toEqual({
      success: true,
      archivedCount: 2,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/tier-downgrade/archive",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          targetTier: "gratis",
          category: "projects",
          expectedFingerprint: "a".repeat(64),
        }),
      }),
    );
    expect(anchor.download).toContain("praeventio-downgrade-projects-");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:tier-downgrade");
  });

  it("archives without claiming an export when the user chose archive-only", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, archivedCount: 2 }), {
        status: 200,
      }),
    );

    await archiveTierDowngrade("workers", "gratis");

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tier-downgrade/archive",
      expect.objectContaining({
        body: JSON.stringify({ targetTier: "gratis", category: "workers" }),
      }),
    );
  });
});

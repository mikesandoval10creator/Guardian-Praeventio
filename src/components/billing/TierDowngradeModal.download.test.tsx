// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("../../lib/apiAuth", () => ({
  apiAuthHeaderOrThrow: vi.fn(async () => "Bearer test-token"),
}));

import { TierDowngradeModal } from "./TierDowngradeModal";

const preview = {
  sourceTier: "oro",
  targetTier: "gratis",
  overages: {
    projects: { count: 1, current: 2, cap: 1, candidateIds: ["p-1"] },
    workers: { count: 0, capPerProject: 3, projects: [] },
  },
};
const exported = {
  fingerprint: "b".repeat(64),
  backup: {
    version: 1,
    generatedAt: "2026-08-09T00:00:00.000Z",
    sourceTier: "oro",
    targetTier: "gratis",
    category: "projects",
    count: 1,
    records: [
      { kind: "project", projectId: "p-1", data: { name: "Original" } },
    ],
  },
};

// Only auth and browser/network boundaries are mocked; the client and modal are real.
describe("TierDowngradeModal export download integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:tier-backup"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(["invalid export", "blocked click", "URL creation failure"] as const)(
    "keeps the downgrade unconfirmed after %s and permits a successful retry",
    async (failure) => {
      let payload: unknown =
        failure === "invalid export" ? { backup: exported.backup } : exported;
      let archived = false;
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input, init) => {
          expect(init?.headers).toMatchObject({
            Authorization: "Bearer test-token",
          });
          if (input === "/api/tier-downgrade/preview") {
            const body = archived
              ? {
                  ...preview,
                  overages: {
                    ...preview.overages,
                    projects: {
                      count: 0,
                      current: 1,
                      cap: 1,
                      candidateIds: [],
                    },
                  },
                }
              : preview;
            return new Response(JSON.stringify(body), { status: 200 });
          }
          if (input === "/api/tier-downgrade/export") {
            return new Response(JSON.stringify(payload), { status: 200 });
          }
          if (input === "/api/tier-downgrade/archive") {
            expect(JSON.parse(String(init?.body))).toEqual({
              category: "projects",
              targetTier: "gratis",
              expectedFingerprint: exported.fingerprint,
            });
            archived = true;
            return new Response(
              JSON.stringify({ success: true, archivedCount: 1 }),
              { status: 200 },
            );
          }
          throw new Error("unexpected_endpoint");
        });
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      if (failure === "blocked click") {
        clickSpy.mockImplementationOnce(() => {
          throw new Error("download_blocked");
        });
      } else if (failure === "URL creation failure") {
        vi.mocked(URL.createObjectURL).mockImplementationOnce(() => {
          throw new Error("download_blocked");
        });
      }
      const onConfirm = vi.fn();
      render(
        <TierDowngradeModal
          fromTier="oro"
          toTier="gratis"
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        />,
      );
      fireEvent.click(
        await screen.findByTestId("tier-downgrade-export-projects"),
      );

      await screen.findByRole("alert");
      await waitFor(() =>
        expect(
          (
            screen.getByTestId(
              "tier-downgrade-export-projects",
            ) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      );
      expect(archived).toBe(false);
      expect(
        fetchMock.mock.calls.filter(
          ([path]) => path === "/api/tier-downgrade/archive",
        ),
      ).toHaveLength(0);
      expect(screen.queryByRole("status")).toBeNull();
      expect(
        (screen.getByTestId("tier-downgrade-confirm") as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(document.querySelectorAll("a[download]")).toHaveLength(0);
      expect(onConfirm).not.toHaveBeenCalled();
      if (failure === "blocked click") {
        expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
          "blob:tier-backup",
        );
      } else {
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      }
      if (failure === "invalid export")
        expect(URL.createObjectURL).not.toHaveBeenCalled();

      payload = exported;
      fireEvent.click(screen.getByTestId("tier-downgrade-export-projects"));
      await screen.findByTestId("tier-downgrade-no-overages");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("status").textContent).toContain(
        "1 registros archivados",
      );
      expect(
        fetchMock.mock.calls.filter(
          ([path]) => path === "/api/tier-downgrade/archive",
        ),
      ).toHaveLength(1);
      expect(document.querySelectorAll("a[download]")).toHaveLength(0);
      fireEvent.click(screen.getByTestId("tier-downgrade-confirm"));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    },
  );
});

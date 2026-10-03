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
    records: [
      { kind: "project", projectId: "p-1", data: { name: "First" } },
      { kind: "project", projectId: "p-2", data: { name: "Second" } },
    ],
  },
};

function mockDownload() {
  const anchor = document.createElement("a");
  const clickSpy = vi
    .spyOn(anchor, "click")
    .mockImplementation(() => undefined);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag) =>
    tag === "a" ? anchor : createElement(tag),
  );
  return { anchor, clickSpy };
}

function withBackup(changes: Record<string, unknown>) {
  return { ...exportBody, backup: { ...exportBody.backup, ...changes } };
}

async function readBackup(blob: Blob): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(JSON.parse(String(reader.result)));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

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
    const { anchor, clickSpy } = mockDownload();
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

  it("rejects an export without a fingerprint before downloading or archiving", async () => {
    mockDownload();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ backup: exportBody.backup }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, archivedCount: 2 }), {
          status: 200,
        }),
      );

    await expect(
      exportThenArchiveTierDowngrade("projects", "gratis"),
    ).rejects.toThrow("downgrade_export_invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    ["null response", null],
    ["array response", []],
    ["empty response", {}],
    ["missing backup", { fingerprint: exportBody.fingerprint }],
    ["null backup", { ...exportBody, backup: null }],
    ["empty fingerprint", { ...exportBody, fingerprint: "" }],
    ["null fingerprint", { ...exportBody, fingerprint: null }],
    ["non-string fingerprint", { ...exportBody, fingerprint: 42 }],
    ["short fingerprint", { ...exportBody, fingerprint: "a".repeat(63) }],
    ["long fingerprint", { ...exportBody, fingerprint: "a".repeat(65) }],
    ["uppercase fingerprint", { ...exportBody, fingerprint: "A".repeat(64) }],
    ["non-hex fingerprint", { ...exportBody, fingerprint: "g".repeat(64) }],
    ["missing version", withBackup({ version: undefined })],
    ["unsupported version", withBackup({ version: 2 })],
    ["missing time", withBackup({ generatedAt: undefined })],
    ["invalid time", withBackup({ generatedAt: "not-a-date" })],
    ["non-ISO time", withBackup({ generatedAt: "2026/08/09" })],
    ["invalid source tier", withBackup({ sourceTier: "unknown" })],
    ["invalid target tier", withBackup({ targetTier: "unknown" })],
    ["other target tier", withBackup({ targetTier: "cobre" })],
    ["invalid category", withBackup({ category: "unknown" })],
    ["other category", withBackup({ category: "workers" })],
    ["missing count", withBackup({ count: undefined })],
    ["negative count", withBackup({ count: -1 })],
    ["fractional count", withBackup({ count: 1.5 })],
    ["string count", withBackup({ count: "2" })],
    ["record count mismatch", withBackup({ count: 3 })],
    ["missing records", withBackup({ records: undefined })],
    ["object records", withBackup({ records: {} })],
    ["null record", withBackup({ count: 1, records: [null] })],
    ["scalar record", withBackup({ count: 1, records: ["p-1"] })],
    ["empty record", withBackup({ count: 1, records: [{}] })],
    [
      "missing project id",
      withBackup({ count: 1, records: [{ kind: "project", data: {} }] }),
    ],
    [
      "empty project id",
      withBackup({
        count: 1,
        records: [{ kind: "project", projectId: "", data: {} }],
      }),
    ],
    [
      "missing record data",
      withBackup({
        count: 1,
        records: [{ kind: "project", projectId: "p-1" }],
      }),
    ],
    [
      "array record data",
      withBackup({
        count: 1,
        records: [{ kind: "project", projectId: "p-1", data: [] }],
      }),
    ],
    [
      "wrong record category",
      withBackup({
        count: 1,
        records: [
          { kind: "worker", projectId: "p-1", workerId: "w-1", data: {} },
        ],
      }),
    ],
  ])("rejects %s before any download or archive", async (_name, payload) => {
    mockDownload();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, archivedCount: 2 }), {
          status: 200,
        }),
      );

    await expect(
      exportThenArchiveTierDowngrade("projects", "gratis"),
    ).rejects.toThrow("downgrade_export_invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it.each(["projects", "workers"] as const)(
    "preserves the complete %s backup before archiving",
    async (category) => {
      mockDownload();
      const backup = {
        ...exportBody.backup,
        category,
        count: 1,
        extraMetadata: { retained: true },
        records: [
          {
            kind: category === "projects" ? "project" : "worker",
            projectId: "p-1",
            ...(category === "workers" ? { workerId: "w-1" } : {}),
            data: {
              name: "Original",
              nested: { status: "active", note: null },
              values: [1, "two"],
            },
            extraRecordMetadata: "retained",
          },
        ],
      };
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ fingerprint: exportBody.fingerprint, backup }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true, archivedCount: 1 }), {
            status: 200,
          }),
        );

      await exportThenArchiveTierDowngrade(category, "gratis");
      const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
      await expect(readBackup(blob)).resolves.toEqual(backup);
      expect(blob.type).toBe("application/json;charset=utf-8");
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/tier-downgrade/archive",
        expect.objectContaining({
          body: JSON.stringify({
            targetTier: "gratis",
            category,
            expectedFingerprint: exportBody.fingerprint,
          }),
        }),
      );
    },
  );

  it("accepts an empty authoritative backup without inventing records", async () => {
    mockDownload();
    const payload = withBackup({ count: 0, records: [] });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, archivedCount: 0 }), {
          status: 200,
        }),
      );

    await expect(
      exportThenArchiveTierDowngrade("projects", "gratis"),
    ).resolves.toEqual({ success: true, archivedCount: 0 });
    await expect(
      readBackup(vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob),
    ).resolves.toEqual(payload.backup);
  });

  it("attaches the download link before clicking and removes it afterwards", async () => {
    const { anchor, clickSpy } = mockDownload();
    clickSpy.mockImplementation(() => {
      expect(anchor.isConnected).toBe(true);
      expect(anchor.hidden).toBe(true);
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exportBody), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, archivedCount: 2 }), {
          status: 200,
        }),
      );

    await exportThenArchiveTierDowngrade("projects", "gratis");
    expect(anchor.isConnected).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it.each(["creation", "attachment", "click"] as const)(
    "cleans the acquired URL after anchor %s failure without archiving",
    async (stage) => {
      const { anchor, clickSpy } = mockDownload();
      if (stage === "creation") {
        vi.mocked(document.createElement).mockImplementation(() => {
          throw new Error("download_blocked");
        });
      } else if (stage === "attachment") {
        vi.spyOn(document.body, "appendChild").mockImplementation(() => {
          throw new Error("download_blocked");
        });
      } else {
        clickSpy.mockImplementation(() => {
          throw new Error("download_blocked");
        });
      }
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify(exportBody), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true, archivedCount: 2 }), {
            status: 200,
          }),
        );

      await expect(
        exportThenArchiveTierDowngrade("projects", "gratis"),
      ).rejects.toThrow("download_blocked");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(anchor.isConnected).toBe(false);
      expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:tier-downgrade",
      );
    },
  );

  it.each(["Blob", "object URL"] as const)(
    "stops before archiving when %s creation fails",
    async (stage) => {
      mockDownload();
      if (stage === "Blob") {
        vi.spyOn(globalThis, "Blob").mockImplementation(function () {
          throw new Error("download_blocked");
        });
      } else {
        vi.mocked(URL.createObjectURL).mockImplementation(() => {
          throw new Error("download_blocked");
        });
      }
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify(exportBody), { status: 200 }),
        );

      await expect(
        exportThenArchiveTierDowngrade("projects", "gratis"),
      ).rejects.toThrow("download_blocked");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    },
  );

  it.each([
    ["missing worker id", { kind: "worker", projectId: "p-1", data: {} }],
    [
      "empty worker id",
      { kind: "worker", projectId: "p-1", workerId: "", data: {} },
    ],
    [
      "null worker data",
      { kind: "worker", projectId: "p-1", workerId: "w-1", data: null },
    ],
    [
      "project in worker backup",
      { kind: "project", projectId: "p-1", data: {} },
    ],
  ])(
    "rejects %s in a worker backup before side effects",
    async (_name, record) => {
      const payload = withBackup({
        category: "workers",
        count: 1,
        records: [record],
      });
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify(payload), { status: 200 }),
        );

      await expect(
        exportThenArchiveTierDowngrade("workers", "gratis"),
      ).rejects.toThrow("downgrade_export_invalid");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed successful JSON before side effects", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{invalid", { status: 200 }));

    await expect(
      exportThenArchiveTierDowngrade("projects", "gratis"),
    ).rejects.toThrow("downgrade_export_invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("propagates export HTTP failure before any download or archive", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "tier_downgrade_failed" }), {
        status: 503,
      }),
    );

    await expect(
      exportThenArchiveTierDowngrade("projects", "gratis"),
    ).rejects.toThrow("tier_downgrade_failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
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

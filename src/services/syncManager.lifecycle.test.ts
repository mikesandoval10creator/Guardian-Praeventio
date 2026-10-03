import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeType, type RiskNode } from "../types";

type BatchAck = { failedOps: { id: string }[] };
const h = vi.hoisted(() => ({
  syncBatch: vi.fn(async (): Promise<BatchAck> => ({ failedOps: [] })),
}));

vi.mock("./geminiService", () => ({
  generateEmbeddingsBatch: vi.fn(async () => []),
  syncBatchToNetwork: h.syncBatch,
}));
vi.mock("idb-keyval", () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
}));
vi.mock("firebase/firestore", () => ({
  writeBatch: vi.fn(),
  doc: vi.fn((_db: unknown, collection: string, id: string) => ({
    collection,
    id,
  })),
  getDoc: vi.fn(async () => ({ exists: () => false })),
}));
vi.mock("./firebase", () => ({ db: {} }));
vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { matrixSyncManager } = await import("./syncManager");
type SyncManager = typeof matrixSyncManager;
const Manager = matrixSyncManager.constructor as new () => SyncManager;
matrixSyncManager.dispose();
const pendingAcknowledgements: ((result: BatchAck) => void)[] = [];

function node(id: string): RiskNode {
  return {
    id,
    type: NodeType.FINDING,
    title: "initial finding",
    description: "pending sync",
    tags: [],
    metadata: { authorId: "user-1" },
    connections: [],
    embedding: [],
    projectId: "project-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function pendingSync() {
  let acknowledge!: (result: BatchAck) => void;
  const promise = new Promise<BatchAck>((resolve) => {
    acknowledge = resolve;
  });
  h.syncBatch.mockReturnValueOnce(promise);
  pendingAcknowledgements.push(acknowledge);
  return acknowledge;
}

describe("MatrixSyncManager follow-up timer ownership", () => {
  let manager: SyncManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    h.syncBatch.mockReset().mockResolvedValue({ failedOps: [] });
    pendingAcknowledgements.length = 0;
    vi.stubGlobal("navigator", { onLine: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
    manager = new Manager();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  afterEach(async () => {
    // Settle deferred IO even if an assertion fails; inspect cleanup before
    // clearing fake timers so a lost timeout cannot be hidden by the harness.
    for (const acknowledge of pendingAcknowledgements)
      acknowledge({ failedOps: [] });
    try {
      await vi.advanceTimersByTimeAsync(0);
      manager.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("keeps exactly one tracked follow-up when the same finding changes during an ACK", async () => {
    const acknowledge = pendingSync();
    await manager.enqueueSet(node("doc-1"));
    const flush = manager.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.syncBatch).toHaveBeenCalledTimes(1);

    await manager.enqueueUpdate("doc-1", { title: "newest edit" });
    acknowledge({ failedOps: [] });
    await flush;

    expect(manager.getPendingOperations()).toMatchObject([
      { id: "doc-1", type: "set", data: { title: "newest edit" } },
    ]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["set", "update", "delete"] as const)(
    "defers a concurrent %s to the single follow-up cycle",
    async (operation) => {
      const acknowledge = pendingSync();
      await manager.enqueueSet(node("doc-1"));
      const flush = manager.flush();
      await vi.advanceTimersByTimeAsync(0);

      if (operation === "set") await manager.enqueueSet(node("doc-2"));
      if (operation === "update")
        await manager.enqueueUpdate("doc-2", { title: "new edit" });
      if (operation === "delete") await manager.enqueueDelete("doc-2");
      expect(vi.getTimerCount()).toBe(0);
      acknowledge({ failedOps: [] });
      await flush;
      expect(vi.getTimerCount()).toBe(1);
      expect(manager.getPendingOperations()).toMatchObject([
        { id: "doc-2", type: operation },
      ]);

      await vi.advanceTimersByTimeAsync(5000);
      expect(h.syncBatch).toHaveBeenCalledTimes(2);
      expect(h.syncBatch).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: "doc-2", type: operation }),
      ]);
      expect(manager.getPendingOperations()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("preserves the newest edit across an ACK slower than the batching window", async () => {
    const acknowledge = pendingSync();
    await manager.enqueueSet(node("doc-1"));
    const flush = manager.flush();
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 20; index += 1) {
      await manager.enqueueUpdate("doc-1", { title: `edit-${index}` });
    }
    await vi.advanceTimersByTimeAsync(5001);
    expect(h.syncBatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    acknowledge({ failedOps: [] });
    await flush;
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.syncBatch).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: "doc-1",
        data: expect.objectContaining({ title: "edit-19" }),
      }),
    ]);
    expect(manager.getPendingOperations()).toEqual([]);
  });

  it("does not let a concurrent edit bypass partial-failure backoff", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const acknowledge = pendingSync();
    await manager.enqueueSet(node("doc-1"));
    const flush = manager.flush();
    await vi.advanceTimersByTimeAsync(0);
    await manager.enqueueSet(node("doc-2"));

    acknowledge({ failedOps: [{ id: "doc-1" }] });
    await flush;
    expect(manager.getPendingOperations().map((op) => op.id)).toEqual([
      "doc-1",
      "doc-2",
    ]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(h.syncBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.syncBatch).toHaveBeenCalledTimes(2);
    expect(manager.getPendingOperations()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets dispose cancel every follow-up without losing the queued edit", async () => {
    const acknowledge = pendingSync();
    await manager.enqueueSet(node("doc-1"));
    const flush = manager.flush();
    await vi.advanceTimersByTimeAsync(0);
    await manager.enqueueSet(node("doc-2"));
    acknowledge({ failedOps: [] });
    await flush;

    manager.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.syncBatch).toHaveBeenCalledTimes(1);
    expect(manager.getPendingOperations()).toMatchObject([{ id: "doc-2" }]);
  });

  it("retains the follow-up write when its timer fires offline", async () => {
    const acknowledge = pendingSync();
    await manager.enqueueSet(node("doc-1"));
    const flush = manager.flush();
    await vi.advanceTimersByTimeAsync(0);
    await manager.enqueueSet(node("doc-2"));
    acknowledge({ failedOps: [] });
    await flush;

    vi.stubGlobal("navigator", { onLine: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.syncBatch).toHaveBeenCalledTimes(1);
    expect(manager.getPendingOperations()).toMatchObject([{ id: "doc-2" }]);
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal("navigator", { onLine: true });
    await manager.flush();
    expect(h.syncBatch).toHaveBeenCalledTimes(2);
    expect(manager.getPendingOperations()).toEqual([]);
  });

  it("does not start another batch when manually flushed during an active ACK", async () => {
    const acknowledge = pendingSync();
    await manager.enqueueSet(node("doc-1"));
    const flush = manager.flush();
    await vi.advanceTimersByTimeAsync(0);
    await manager.enqueueSet(node("doc-2"));
    await manager.flush();
    expect(h.syncBatch).toHaveBeenCalledTimes(1);

    acknowledge({ failedOps: [] });
    await flush;
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.syncBatch).toHaveBeenCalledTimes(2);
    expect(manager.getPendingOperations()).toEqual([]);
  });

  it("still batches idle enqueues in the original five-second window", async () => {
    await manager.enqueueSet(node("doc-1"));
    await manager.enqueueSet(node("doc-2"));
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.syncBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.syncBatch).toHaveBeenCalledTimes(1);
    expect(manager.getPendingOperations()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { del, get } from "idb-keyval";
import {
  createIndexedDbIncidentAdapter,
  type IncidentReportPayload,
} from "./incidentOutbox";
import {
  GenericOutboxEngine,
  type OutboxEntry,
} from "../sync/genericOutboxEngine";

vi.mock("../../lib/apiAuth", () => ({ apiAuthHeader: vi.fn() }));
vi.mock("../../utils/logger", () => ({ logger: { warn: vi.fn() } }));

const STORAGE_KEY = "praeventio:incident-outbox:v1";

function entry(id: string): OutboxEntry<IncidentReportPayload> {
  return {
    event: {
      clientEventId: id,
      kind: "incident",
      priority: "normal",
      payload: {
        id,
        projectId: "test-project",
        incidentType: "near_miss",
        severity: "med",
        description: "Synthetic regression report",
        ts: "2026-10-22T00:00:00Z",
      },
      occurredAt: "2026-10-22T00:00:00Z",
    },
    queuedAt: "2026-10-22T00:00:00Z",
    retryCount: 0,
    nextRetryAt: 0,
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await del(STORAGE_KEY);
});

describe("incident outbox with real idb-keyval and simulated IndexedDB transactions", () => {
  it("treats a missing key as an empty queue", async () => {
    await expect(
      createIndexedDbIncidentAdapter().listEntries(),
    ).resolves.toEqual([]);
  });

  it("updates retry and dead-letter metadata without duplicating the event", async () => {
    const adapter = createIndexedDbIncidentAdapter();
    await adapter.saveEntry(entry("existing"));
    const retried = {
      ...entry("existing"),
      retryCount: 3,
      nextRetryAt: 1234,
      lastError: "permanent",
      deadLettered: true,
    };
    await adapter.saveEntry(retried);
    await expect(adapter.listEntries()).resolves.toEqual([retried]);
  });

  it("preserves an unrelated report when acknowledgement overlaps retry metadata", async () => {
    const first = createIndexedDbIncidentAdapter();
    const second = createIndexedDbIncidentAdapter();
    await first.saveEntry(entry("acknowledged"));
    await first.saveEntry(entry("retrying"));
    await Promise.all([
      first.deleteEntry("acknowledged"),
      second.saveEntry({
        ...entry("retrying"),
        retryCount: 2,
        nextRetryAt: 500,
      }),
    ]);
    await expect(first.listEntries()).resolves.toEqual([
      { ...entry("retrying"), retryCount: 2, nextRetryAt: 500 },
    ]);
  });

  it("rejects failed transactional reads without replacing the queue", async () => {
    const adapter = createIndexedDbIncidentAdapter();
    await adapter.saveEntry(entry("retained"));
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(() => {
      throw new DOMException(
        "Injected transaction read failure",
        "UnknownError",
      );
    });
    await expect(adapter.saveEntry(entry("new-report"))).rejects.toThrow(
      "Injected transaction read failure",
    );
    await expect(adapter.listEntries()).resolves.toEqual([entry("retained")]);
  });

  it("rejects a failed write, retains earlier reports, and recovers", async () => {
    const adapter = createIndexedDbIncidentAdapter();
    await adapter.saveEntry(entry("retained"));
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Injected quota failure", "QuotaExceededError");
    });
    await expect(adapter.saveEntry(entry("new-report"))).rejects.toThrow(
      "Injected quota failure",
    );
    await expect(adapter.listEntries()).resolves.toEqual([entry("retained")]);
    await adapter.saveEntry(entry("recovered"));
    expect(
      (await adapter.listEntries())
        .map((item) => item.event.clientEventId)
        .sort(),
    ).toEqual(["recovered", "retained"]);
  });

  it("rejects an aborted transaction instead of acknowledging durable enqueue", async () => {
    const adapter = createIndexedDbIncidentAdapter();
    await adapter.saveEntry(entry("retained"));
    const engine = new GenericOutboxEngine({
      adapter,
      sender: async () => ({ kind: "success" as const }),
    });
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = originalPut.apply(this, args);
      this.transaction.abort();
      return request;
    });

    // Explicit abort leaves transaction.error null in IndexedDB.
    await expect(engine.enqueue(entry("new-report").event)).rejects.toBeNull();
    await expect(adapter.listEntries()).resolves.toEqual([entry("retained")]);
    await expect(engine.enqueue(entry("recovered").event)).resolves.toBe(true);
    expect(
      (await adapter.listEntries())
        .map((item) => item.event.clientEventId)
        .sort(),
    ).toEqual(["recovered", "retained"]);
  });

  it("rejects a failed acknowledgement write without losing the report", async () => {
    const adapter = createIndexedDbIncidentAdapter();
    await adapter.saveEntry(entry("retained"));
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException(
        "Injected acknowledgement failure",
        "UnknownError",
      );
    });
    await expect(adapter.deleteEntry("retained")).rejects.toThrow(
      "Injected acknowledgement failure",
    );
    await expect(adapter.listEntries()).resolves.toEqual([entry("retained")]);
    await adapter.deleteEntry("retained");
    await expect(adapter.listEntries()).resolves.toEqual([]);
  });

  it("rejects enqueue on a failed read without modifying retained reports", async () => {
    const adapter = createIndexedDbIncidentAdapter();
    await adapter.saveEntry(entry("retained"));
    const engine = new GenericOutboxEngine({
      adapter,
      sender: async () => ({ kind: "success" as const }),
    });
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(() => {
      throw new DOMException("Injected storage read failure", "UnknownError");
    });

    await expect(engine.enqueue(entry("new-report").event)).rejects.toThrow(
      "Injected storage read failure",
    );
    expect(
      (await adapter.listEntries()).map((item) => item.event.clientEventId),
    ).toEqual(["retained"]);
    // The rejected mutation must not poison later enqueues.
    await expect(engine.enqueue(entry("recovered").event)).resolves.toBe(true);
    expect(
      (await adapter.listEntries())
        .map((item) => item.event.clientEventId)
        .sort(),
    ).toEqual(["recovered", "retained"]);
  });

  it("does not erase a concurrent save while acknowledging another report", async () => {
    const first = createIndexedDbIncidentAdapter();
    const second = createIndexedDbIncidentAdapter();
    await first.saveEntry(entry("acknowledged"));

    await Promise.all([
      first.deleteEntry("acknowledged"),
      second.saveEntry(entry("new-report")),
    ]);

    expect(
      (await second.listEntries()).map((item) => item.event.clientEventId),
    ).toEqual(["new-report"]);
  });

  it("preserves reports accepted concurrently by independent engine instances", async () => {
    const first = new GenericOutboxEngine({
      adapter: createIndexedDbIncidentAdapter(),
      sender: async () => ({ kind: "success" as const }),
    });
    const second = new GenericOutboxEngine({
      adapter: createIndexedDbIncidentAdapter(),
      sender: async () => ({ kind: "success" as const }),
    });

    expect(
      await Promise.all([
        first.enqueue(entry("first").event),
        second.enqueue(entry("second").event),
      ]),
    ).toEqual([true, true]);

    const persisted =
      await get<OutboxEntry<IncidentReportPayload>[]>(STORAGE_KEY);
    expect(persisted?.map((item) => item.event.clientEventId).sort()).toEqual([
      "first",
      "second",
    ]);
  });
});

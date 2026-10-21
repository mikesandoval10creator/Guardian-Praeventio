import { describe, it, expect, vi } from "vitest";
import {
  claimEscalationMarker,
  markEscalationDelivered,
  markEscalationWithoutNotifier,
} from "./escalationMarker.js";

interface FakeRef {
  path: string;
  set: ReturnType<typeof vi.fn>;
}

function fakeRef(path = "projects/p/man_down_events/e/escalations/k"): FakeRef {
  return { path, set: vi.fn().mockResolvedValue(undefined) };
}

function fakeDb(store: Map<string, Record<string, unknown>>) {
  return {
    async runTransaction<T>(
      fn: (tx: {
        get: (ref: FakeRef) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        }>;
        create: (ref: FakeRef, data: Record<string, unknown>) => void;
        set: (
          ref: FakeRef,
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => void;
      }) => Promise<T>,
    ): Promise<T> {
      return fn({
        async get(ref) {
          const data = store.get(ref.path);
          return { exists: data !== undefined, data: () => data };
        },
        create(ref, data) {
          if (store.has(ref.path)) throw new Error("Document already exists");
          store.set(ref.path, data);
        },
        set(ref, data, options) {
          const previous = options?.merge ? store.get(ref.path) ?? {} : {};
          store.set(ref.path, { ...previous, ...data });
        },
      });
    },
  };
}

const NOW = new Date("2026-05-12T12:00:00Z");

describe("claimEscalationMarker", () => {
  it("claims an absent marker before any notification", async () => {
    const store = new Map<string, Record<string, unknown>>();
    const ref = fakeRef();
    const outcome = await claimEscalationMarker({
      db: fakeDb(store) as never,
      markerRef: ref as never,
      payload: { eventId: "e", level: "supervisor" },
      now: NOW,
    });
    expect(outcome).toBe("claimed");
    expect(store.get(ref.path)).toMatchObject({
      eventId: "e",
      level: "supervisor",
      notified: false,
      deliverySkipped: false,
      claimedAtIso: NOW.toISOString(),
    });
  });

  it("does not re-page an already delivered marker", async () => {
    const store = new Map<string, Record<string, unknown>>();
    const ref = fakeRef();
    store.set(ref.path, { notified: true });
    const outcome = await claimEscalationMarker({
      db: fakeDb(store) as never,
      markerRef: ref as never,
      payload: { eventId: "e" },
      now: NOW,
    });
    expect(outcome).toBe("already-delivered");
  });

  it("treats an intentionally skipped marker as final", async () => {
    const store = new Map<string, Record<string, unknown>>();
    const ref = fakeRef();
    store.set(ref.path, { notified: false, deliverySkipped: true });
    const outcome = await claimEscalationMarker({
      db: fakeDb(store) as never,
      markerRef: ref as never,
      payload: { eventId: "e" },
      now: NOW,
    });
    expect(outcome).toBe("already-delivered");
  });

  it("keeps a recent in-flight claim", async () => {
    const store = new Map<string, Record<string, unknown>>();
    const ref = fakeRef();
    store.set(ref.path, {
      notified: false,
      claimedAtIso: new Date(NOW.getTime() - 30_000).toISOString(),
    });
    const outcome = await claimEscalationMarker({
      db: fakeDb(store) as never,
      markerRef: ref as never,
      payload: { eventId: "e" },
      now: NOW,
    });
    expect(outcome).toBe("in-flight");
  });

  it("re-claims an expired lease so a failed delivery can retry", async () => {
    const store = new Map<string, Record<string, unknown>>();
    const ref = fakeRef();
    store.set(ref.path, {
      notified: false,
      claimedAtIso: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
    });
    const outcome = await claimEscalationMarker({
      db: fakeDb(store) as never,
      markerRef: ref as never,
      payload: { eventId: "e" },
      now: NOW,
    });
    expect(outcome).toBe("claimed");
    expect(store.get(ref.path)?.notified).toBe(false);
  });

  it("maps an ALREADY_EXISTS race to in-flight instead of an error", async () => {
    const db = {
      async runTransaction(): Promise<never> {
        const e = new Error("Document already exists") as Error & { code?: number };
        e.code = 6;
        throw e;
      },
    };
    const outcome = await claimEscalationMarker({
      db: db as never,
      markerRef: fakeRef() as never,
      payload: { eventId: "e" },
      now: NOW,
    });
    expect(outcome).toBe("in-flight");
  });
});

describe("markEscalationDelivered", () => {
  it("writes notified:true and a delivery timestamp", async () => {
    const ref = fakeRef();
    await markEscalationDelivered(ref as never, { eventId: "e" }, NOW);
    expect(ref.set).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "e",
        notified: true,
        deliverySkipped: false,
        notifiedAtIso: NOW.toISOString(),
      }),
      { merge: true },
    );
  });
});

describe("markEscalationWithoutNotifier", () => {
  it("records the gap without pretending delivery succeeded", async () => {
    const ref = fakeRef();
    await markEscalationWithoutNotifier(ref as never, { eventId: "e" }, NOW);
    expect(ref.set).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "e",
        notified: false,
        deliverySkipped: true,
        skipReason: "no_notify_hook",
      }),
      { merge: true },
    );
  });
});

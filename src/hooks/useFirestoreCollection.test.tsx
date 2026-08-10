// @vitest-environment jsdom
//
// P2 VIDA/offline — Firestore SnapshotMetadata.fromCache surface.
// The hook must not discard QuerySnapshot.metadata: critical lists need to show
// "possibly stale" when Firestore serves cached data in a low-signal faena.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let snapshotCb: ((snapshot: any) => void) | null = null;
let snapshotErr: ((err: Error) => void) | null = null;
const unsubscribe = vi.fn();

vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  query: vi.fn((col: unknown, ...constraints: unknown[]) => ({
    col,
    constraints,
  })),
  onSnapshot: vi.fn(
    (_q: unknown, cb: (snapshot: any) => void, err: (error: Error) => void) => {
      snapshotCb = cb;
      snapshotErr = err;
      return unsubscribe;
    },
  ),
}));

vi.mock("../services/firebase", () => ({ db: {} }));
vi.mock("./usePendingActions", () => ({ usePendingActions: () => [] }));
vi.mock("../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useFirestoreCollection } from "./useFirestoreCollection";

beforeEach(() => {
  snapshotCb = null;
  snapshotErr = null;
  unsubscribe.mockClear();
});

describe("useFirestoreCollection — SnapshotMetadata", () => {
  it("exposes fromCache and hasPendingWrites from the Firestore snapshot", async () => {
    const { result } = renderHook(() =>
      useFirestoreCollection<{ id: string; name: string }>(
        "projects/proj-1/epp_items",
      ),
    );

    expect(snapshotCb).not.toBeNull();

    act(() => {
      snapshotCb?.({
        metadata: { fromCache: true, hasPendingWrites: true },
        docs: [
          {
            id: "epp-casco",
            data: () => ({ name: "Casco clase B" }),
          },
        ],
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([
      { id: "epp-casco", name: "Casco clase B" },
    ]);
    expect(result.current.fromCache).toBe(true);
    expect(result.current.hasPendingWrites).toBe(true);
  });

  it("resets stale metadata when the collection path is cleared", async () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useFirestoreCollection(path),
      { initialProps: { path: "projects/proj-1/epp_items" as string | null } },
    );

    act(() => {
      snapshotCb?.({
        metadata: { fromCache: true, hasPendingWrites: false },
        docs: [],
      });
    });
    await waitFor(() => expect(result.current.fromCache).toBe(true));

    rerender({ path: null });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(result.current.fromCache).toBe(false);
    expect(result.current.hasPendingWrites).toBe(false);
  });
});

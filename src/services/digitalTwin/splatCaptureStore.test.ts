import { describe, expect, it, vi } from "vitest";

const onSnapshotMock = vi.fn();

vi.mock("../firebase", () => ({
  db: {},
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({
    path: segments.join("/"),
  })),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
  query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({
    ref,
    constraints,
  })),
}));

import {
  choosePreferredSplatCapture,
  subscribePreferredSplatCapture,
} from "./splatCaptureStore";
import type { SplatCapture } from "./gaussianSplatRegistry";

function capture(over: Partial<SplatCapture> = {}): SplatCapture {
  return {
    id: "recent",
    projectId: "p1",
    capturedAt: "2026-08-12T12:00:00.000Z",
    capturedByUid: "u1",
    format: "splat",
    storageUrl: "https://storage.example/recent.splat",
    sizeBytes: 100 * 1024,
    splatCount: 500_000,
    extentMeters: 50,
    centerCoords: { lat: -33.45, lng: -70.66 },
    isCanonical: false,
    ...over,
  };
}

describe("choosePreferredSplatCapture", () => {
  it("prefiere la captura canónica aunque no sea la más reciente", () => {
    const canonical = capture({
      id: "canonical",
      capturedAt: "2026-08-01T12:00:00.000Z",
      isCanonical: true,
    });
    expect(choosePreferredSplatCapture([capture(), canonical])).toEqual(
      canonical,
    );
  });

  it("usa la más reciente si no hay captura canónica", () => {
    const older = capture({
      id: "older",
      capturedAt: "2026-08-01T12:00:00.000Z",
    });
    const recent = capture({
      id: "recent",
      capturedAt: "2026-08-12T12:00:00.000Z",
    });
    expect(choosePreferredSplatCapture([older, recent])).toEqual(recent);
  });

  it("devuelve null si la colección está vacía", () => {
    expect(choosePreferredSplatCapture([])).toBeNull();
  });
});

describe("subscribePreferredSplatCapture", () => {
  it("no abre Firestore sin tenant o proyecto y entrega null", () => {
    const onCapture = vi.fn();
    const unsubscribe = subscribePreferredSplatCapture("", "p1", onCapture);

    expect(onCapture).toHaveBeenCalledWith(null);
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(unsubscribe).toBeTypeOf("function");
  });

  it("rehidrata documentos, prefiere el canónico y preserva cleanup", () => {
    const onCapture = vi.fn();
    const onError = vi.fn();
    const unsubscribe = vi.fn();
    onSnapshotMock.mockImplementationOnce((_query, onNext) => {
      onNext({
        forEach: (
          visit: (doc: {
            id: string;
            data: () => Partial<SplatCapture>;
          }) => void,
        ) => {
          visit({ id: "recent", data: () => capture() });
          visit({
            id: "canonical",
            data: () => capture({ isCanonical: true }),
          });
        },
      });
      return unsubscribe;
    });

    const received = subscribePreferredSplatCapture(
      "t1",
      "p1",
      onCapture,
      onError,
    );

    expect(onCapture).toHaveBeenCalledWith(
      expect.objectContaining({ id: "canonical", isCanonical: true }),
    );
    expect(onError).not.toHaveBeenCalled();
    expect(received).toBe(unsubscribe);
  });
});

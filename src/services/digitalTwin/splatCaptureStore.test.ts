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

  it.each([
    { capturedAt: "not-a-date" },
    { capturedAt: "2026-02-29T12:00:00Z" },
    { capturedAt: "2026-08-12T12:00:00" },
    { format: "obj" },
    { splatCount: -1 },
    { sizeBytes: Number.NaN },
    { extentMeters: Infinity },
    { isCanonical: "false" },
    { projectId: "other-project" },
    { tenantId: "other-tenant" },
    { centerCoords: { lat: 91, lng: 0 } },
  ])("ignora metadatos inválidos o de otro proyecto: %j", (invalid) => {
    const onCapture = vi.fn();
    onSnapshotMock.mockImplementationOnce((_query, _options, onNext) => {
      onNext({ metadata: { fromCache: false }, forEach: (visit: (doc: { id: string; data: () => unknown }) => void) => {
        visit({ id: "invalid", data: () => ({ ...capture({ isCanonical: true }), ...invalid }) });
        visit({ id: "valid", data: () => capture() });
      } });
      return vi.fn();
    });

    subscribePreferredSplatCapture("t1", "p1", onCapture);
    expect(onCapture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "valid", projectId: "p1" }), false);
  });

  it("reports a terminal listener error without emitting an empty snapshot", () => {
    const onCapture = vi.fn();
    const onError = vi.fn();
    const error = new Error("Snapshot listener failed");
    const unsubscribe = vi.fn();
    onSnapshotMock.mockImplementationOnce((_query, _options, _onNext, fail) => {
      fail(error);
      return unsubscribe;
    });

    expect(subscribePreferredSplatCapture("t1", "p1", onCapture, onError)).toBe(unsubscribe);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("distinguishes a cache miss from a server-confirmed empty result", () => {
    const onCapture = vi.fn();
    const forEach = vi.fn();
    onSnapshotMock.mockImplementationOnce((_query, options, onNext) => {
      expect(options).toEqual({ includeMetadataChanges: true });
      onNext({ metadata: { fromCache: true }, forEach });
      onNext({ metadata: { fromCache: false }, forEach });
      return vi.fn();
    });
    subscribePreferredSplatCapture("t1", "p1", onCapture);
    expect(onCapture.mock.calls).toEqual([[null, true], [null, false]]);
  });

  it("rehidrata documentos, prefiere el canónico y preserva cleanup", () => {
    const onCapture = vi.fn();
    const capturedAt = "2024-02-29T09:00:00-03:00";
    const onError = vi.fn();
    const unsubscribe = vi.fn();
    onSnapshotMock.mockImplementationOnce((_query, _options, onNext) => {
      onNext({
        metadata: { fromCache: true },
        forEach: (
          visit: (doc: {
            id: string;
            data: () => Partial<SplatCapture>;
          }) => void,
        ) => {
          visit({ id: "recent", data: () => capture() });
          visit({
            id: "canonical",
            data: () => capture({ isCanonical: true, capturedAt }),
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
      expect.objectContaining({ id: "canonical", isCanonical: true, capturedAt }),
      true,
    );
    expect(onError).not.toHaveBeenCalled();
    expect(received).toBe(unsubscribe);
  });
});

// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
//
// P2 VIDA/offline — geo-anchored Digital Twin history must visibly mark cached
// Firestore data as possibly stale. The source hook reads SnapshotMetadata.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacedObject } from "../../services/digitalTwin/photogrammetry/types";

let mockHistoryFromCache = false;
let mockHistoryHasPendingWrites = false;

vi.mock("../../hooks/useGeoAnchoredNodes", () => ({
  useGeoAnchoredNodes: () => ({
    nodes: [],
    loading: false,
    error: null,
    fromCache: mockHistoryFromCache,
    hasPendingWrites: mockHistoryHasPendingWrites,
  }),
}));

vi.mock("../../hooks/useFirestoreCollection", () => ({
  useFirestoreCollection: () => ({
    data: [],
    loading: false,
    error: null,
    fromCache: false,
    hasPendingWrites: false,
  }),
}));

vi.mock("firebase/firestore", () => ({
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
}));

import { MaintenanceStatusPanel } from "./MaintenanceStatusPanel";

const placedObject: PlacedObject = {
  id: "ext-1",
  kind: "extinguisher_pqs",
  position: { x: 0, y: 0, z: 0 },
  geo: { lat: -33.45, lng: -70.66 },
  lifecycle: "active",
  createdAt: Date.parse("2026-08-01T00:00:00.000Z"),
  updatedAt: Date.parse("2026-08-01T00:00:00.000Z"),
};

beforeEach(() => {
  mockHistoryFromCache = false;
  mockHistoryHasPendingWrites = false;
});

describe("<MaintenanceStatusPanel /> — fromCache indicator", () => {
  it("marks geo-anchored history as possibly stale when Firestore serves it from cache", () => {
    mockHistoryFromCache = true;

    render(
      <MaintenanceStatusPanel placedObject={placedObject} projectId="proj-1" />,
    );

    const warning = screen.getByTestId("maintenance-history-cache-warning");
    expect(warning).toHaveTextContent(/posiblemente desactualizado/i);
    expect(warning).toHaveTextContent(/caché|sin conexión/i);
  });

  it("does not show the stale-data warning for a fresh server snapshot", () => {
    render(
      <MaintenanceStatusPanel placedObject={placedObject} projectId="proj-1" />,
    );

    expect(
      screen.queryByTestId("maintenance-history-cache-warning"),
    ).toBeNull();
  });
});

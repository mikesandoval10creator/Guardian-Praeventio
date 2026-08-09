// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const H = vi.hoisted(() => ({
  selectedProject: null as null | {
    id: string;
    name: string;
    coordinates?: { lat: number; lng: number };
  },
  fetchEnvironmentContext: vi.fn(),
}));

vi.mock("./FirebaseContext", () => ({
  useFirebase: () => ({ isAuthReady: false, user: null, userIndustry: null }),
}));
vi.mock("./ProjectContext", () => ({
  useProject: () => ({ selectedProject: H.selectedProject }),
}));
vi.mock("../services/orchestratorService", () => ({
  fetchEnvironmentContext: H.fetchEnvironmentContext,
}));
vi.mock("../services/firebase", () => ({
  db: {},
  collection: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  handleFirestoreError: vi.fn(),
  OperationType: {},
}));
vi.mock("../services/zettelkasten/graphMutations", () => ({
  connectGraphNodes: vi.fn(),
  createGraphNode: vi.fn(),
  migrateGraphNodes: vi.fn(),
}));
vi.mock("idb-keyval", () => ({ get: vi.fn(), set: vi.fn() }));

import {
  UniversalKnowledgeProvider,
  useUniversalKnowledge,
} from "./UniversalKnowledgeContext";

function Probe() {
  const { environment } = useUniversalKnowledge();
  return (
    <span data-testid="source">
      {environment?.weather?.location ?? "unavailable"}
    </span>
  );
}

function renderProvider(key: string) {
  return render(
    <UniversalKnowledgeProvider key={key}>
      <Probe />
    </UniversalKnowledgeProvider>,
  );
}

beforeEach(() => {
  H.fetchEnvironmentContext.mockReset();
  H.fetchEnvironmentContext.mockImplementation(
    async (lat: number, lng: number) => ({
      weather: {
        location: `${lat},${lng}`,
        temp: 10,
        condition: "Despejado",
        humidity: 50,
        uv: 1,
        airQuality: null,
        altitude: null,
        recommendations: [],
        sourceCoordinates: { lat, lng },
        measuredAt: 123,
      },
      seismic: null,
      lastUpdated: 123,
    }),
  );
});

afterEach(() => {
  cleanup();
});

describe("UniversalKnowledgeProvider project-scoped environment", () => {
  it("fetches environment with the selected project coordinates", async () => {
    H.selectedProject = {
      id: "site-lima",
      name: "Lima",
      coordinates: { lat: -12.05, lng: -77.04 },
    };

    renderProvider("lima");

    await waitFor(() => {
      expect(H.fetchEnvironmentContext).toHaveBeenCalledWith(-12.05, -77.04);
    });
  });

  it("refetches with distinct coordinates after switching projects", async () => {
    H.selectedProject = {
      id: "site-santiago",
      name: "Santiago",
      coordinates: { lat: -33.45, lng: -70.67 },
    };
    const first = renderProvider("santiago");
    await waitFor(() =>
      expect(H.fetchEnvironmentContext).toHaveBeenCalledTimes(1),
    );
    first.unmount();

    H.selectedProject = {
      id: "site-lima",
      name: "Lima",
      coordinates: { lat: -12.05, lng: -77.04 },
    };
    renderProvider("lima");

    await waitFor(() => {
      expect(H.fetchEnvironmentContext).toHaveBeenLastCalledWith(
        -12.05,
        -77.04,
      );
    });
  });

  it("does not fetch or relabel weather when the project has no coordinates", async () => {
    H.selectedProject = { id: "site-no-coords", name: "Sin ubicación" };
    renderProvider("missing");

    await waitFor(() => {
      expect(H.fetchEnvironmentContext).not.toHaveBeenCalled();
    });
  });
});

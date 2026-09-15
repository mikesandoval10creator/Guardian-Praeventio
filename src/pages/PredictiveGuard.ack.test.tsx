// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  evaluateProbes: vi.fn(),
  fetchStructuralLoadProbes: vi.fn(),
  ackPredictiveAlert: vi.fn(),
  getDocs: vi.fn(),
  generatePredictiveForecast: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? "",
  }),
}));

vi.mock("../contexts/ProjectContext", () => ({
  useProject: () => ({ selectedProject: { id: "project-1", name: "Faena" } }),
}));
vi.mock("../hooks/useRiskEngine", () => ({
  useRiskEngine: () => ({ nodes: [] }),
}));
vi.mock("../contexts/UniversalKnowledgeContext", () => ({
  useUniversalKnowledge: () => ({ environment: { weather: null } }),
}));
vi.mock("../hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));
vi.mock("../lib/apiAuth", () => ({
  apiAuthHeaders: vi.fn(async () => ({ "Content-Type": "application/json" })),
}));
vi.mock("../services/geminiService", () => ({
  generatePredictiveForecast: H.generatePredictiveForecast,
}));
vi.mock("../lib/structuralLoadProbesClient", () => ({
  fetchStructuralLoadProbes: H.fetchStructuralLoadProbes,
}));
vi.mock("../services/predictiveAlerts/alertScheduler", () => ({
  evaluateProbes: H.evaluateProbes,
}));
vi.mock("../components/predictive/AlertSchedulerMount", () => ({
  ackPredictiveAlert: H.ackPredictiveAlert,
}));
vi.mock("../services/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => "crews-collection"),
  getDocs: H.getDocs,
  limit: vi.fn(() => "limit-1"),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn(() => "project-filter"),
}));
vi.mock("../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../components/predictiveAlerts/PredictiveAlertsList", () => ({
  PredictiveAlertsList: ({
    alerts,
    onAcknowledge,
  }: {
    alerts: Array<{ generatorId: string }>;
    onAcknowledge: (alert: { generatorId: string }) => void;
  }) => (
    <div data-testid="predictive-alerts-list">
      {alerts.map((alert) => (
        <button
          key={alert.generatorId}
          type="button"
          data-testid={`ack-${alert.generatorId}`}
          onClick={() => onAcknowledge(alert)}
        >
          Atendido
        </button>
      ))}
    </div>
  ),
}));

import { PredictiveGuard } from "./PredictiveGuard";

const alert = {
  generatorId: "structural-wind",
  decision: {
    fire: true,
    leadTimeMin: 5,
    recommendedAction: "Asegurar la estructura.",
  },
  body: "Alerta predictiva (5 min)",
  scheduledAt: "2026-09-15T20:00:00.000Z",
};

beforeEach(() => {
  H.evaluateProbes.mockReturnValue([alert]);
  H.fetchStructuralLoadProbes.mockResolvedValue({
    probes: [{ id: "structural-wind" }],
    window: { windowMinutes: 60, minLeadTimeMin: 5 },
  });
  H.generatePredictiveForecast.mockResolvedValue(null);
  H.getDocs.mockResolvedValue({
    empty: false,
    docs: [{ id: "crew-real" }],
  });
  H.ackPredictiveAlert.mockResolvedValue(30);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PredictiveGuard acknowledgement", () => {
  it("resolves a real project crew before sending the ACK", async () => {
    render(<PredictiveGuard />);

    const button = await screen.findByTestId("ack-structural-wind");
    fireEvent.click(button);

    await waitFor(() =>
      expect(H.ackPredictiveAlert).toHaveBeenCalledWith({
        projectId: "project-1",
        crewId: "crew-real",
        generatorId: "structural-wind",
      }),
    );
    expect(screen.queryByTestId("ack-structural-wind")).not.toBeInTheDocument();
  });

  it("keeps the alert visible when the ACK has no successful effect", async () => {
    H.ackPredictiveAlert.mockResolvedValueOnce(0);
    render(<PredictiveGuard />);

    fireEvent.click(await screen.findByTestId("ack-structural-wind"));

    await waitFor(() => expect(H.ackPredictiveAlert).toHaveBeenCalledOnce());
    expect(screen.getByTestId("ack-structural-wind")).toBeInTheDocument();
  });
});

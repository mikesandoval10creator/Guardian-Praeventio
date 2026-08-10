// @vitest-environment jsdom
// Ticket 39aaa66d-73fe-8133-97ad-fed934835513 [P2]:
// "Deteccion EPP en tiempo real" exagera (heuristica HSV de una foto, sin
// modelo real). La UI NO puede afirmar "tiempo real" ni "prueba de
// cumplimiento": el detector analiza una foto puntual con heurística HSV.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../hooks/useRiskEngine", () => ({
  useRiskEngine: () => ({ addNode: vi.fn() }),
}));
vi.mock("../../contexts/ProjectContext", () => ({
  useProject: () => ({ selectedProject: { id: "p1" } }),
}));
vi.mock("../../contexts/FirebaseContext", () => ({
  useFirebase: () => ({ user: { uid: "u1" } }),
}));
vi.mock("../../hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));
vi.mock("../../contexts/NotificationContext", () => ({
  useNotifications: () => ({ addNotification: vi.fn() }),
}));
vi.mock("../../services/geminiService", () => ({
  analyzeVisionImage: vi.fn(async () => ({
    eppDetected: [],
    risksDetected: [],
    recommendations: [],
    summary: "",
  })),
}));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../services/ai/eppDetectorOnDevice", () => ({
  getEppDetectorImpl: vi.fn(async () => ({})),
  inspectImage: vi.fn(async () => ({
    detected: [],
    missing: [],
    lowConfidence: [],
    metrics: { processingMs: 10, framesAnalyzed: 1 },
  })),
  buildEppInspectionNode: vi.fn(() => ({ type: "epp_inspection" })),
}));
vi.mock("../../services/zettelkasten/persistence/writeNode", () => ({
  writeNodesDebounced: vi.fn(),
}));
vi.mock("../medical/MedicalIcon", () => ({ MedicalIcon: () => null }));

import { VisionAnalyzer } from "./VisionAnalyzer";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<VisionAnalyzer /> — honest EPP detector labeling", () => {
  it('etiqueta el detector como análisis de imagen experimental, NO "tiempo real"', () => {
    render(<VisionAnalyzer />);

    // El claim exagerado "tiempo real" NO debe aparecer.
    expect(screen.queryByText(/tiempo real/i)).toBeNull();

    // La UI debe comunicar que es análisis puntual de imagen / experimental.
    const subtitle = screen.getByText(/experimental \(foto puntual\)/i);
    expect(subtitle).toBeTruthy();
  });
});

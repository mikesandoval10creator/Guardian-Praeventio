// @vitest-environment jsdom
//
// Phase 5 remediation — Hygiene page renders REAL derived metrics.
//
// We mock the DATA BOUNDARIES (useRiskEngine snapshot, the legal-obligations
// store subscription, ProjectContext) but let the real Hygiene component and
// the real hygieneMetrics derivations run. The assertions prove the rendered
// numbers come from the seeded data — not the old hardcoded 92% / 78% / fixed
// bar array.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { NodeType, type RiskNode } from '../types';
import type { LegalObligation } from '../services/legalCalendar/legalObligationsCalendar';

// ─── Per-test data holders (mutated before each render) ────────────────────
let nodesData: RiskNode[] = [];
let obligationsData: LegalObligation[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => fb ?? k }),
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return { motion: new Proxy({}, { get: () => Pass }), AnimatePresence: ({ children }: any) => children };
});

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-1', name: 'Faena' } }),
}));

vi.mock('../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ nodes: nodesData, loading: false, addNode: vi.fn() }),
}));

// The store subscription: synchronously hand the seeded obligations to the
// page's callback and return a no-op unsubscribe.
vi.mock('../services/legalCalendar/legalCalendarStore', () => ({
  subscribeObligations: (
    _projectId: string,
    onSnap: (list: LegalObligation[]) => void,
  ) => {
    onSnap(obligationsData);
    return () => {};
  },
}));

// Child widgets in the right rail are not under test — stub to keep the DOM lean.
vi.mock('../components/hygiene/AddHygieneModal', () => ({ AddHygieneModal: () => null }));
vi.mock('../components/hygiene/NoiseMonitor', () => ({ NoiseMonitor: () => null }));
vi.mock('../components/hygiene/SensoryFatigueMonitor', () => ({ SensoryFatigueMonitor: () => null }));
vi.mock('../components/hygiene/BreathingExercise', () => ({ BreathingExercise: () => null }));
vi.mock('../components/hygiene/VitalityMonitor', () => ({ VitalityMonitor: () => null }));
vi.mock('../components/hygiene/FloraFaunaCatalog', () => ({ FloraFaunaCatalog: () => null }));
vi.mock('../components/hygiene/MorningRoutine', () => ({ MorningRoutine: () => null }));
vi.mock('../components/hygiene/NutritionLog', () => ({ NutritionLog: () => null }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { Hygiene } from './Hygiene';

function hygieneNode(id: string, value: number, limit: number): RiskNode {
  return {
    id,
    type: NodeType.HYGIENE,
    title: id,
    description: '',
    tags: [],
    connections: [],
    projectId: 'proj-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: { value, limit, parameter: 'Ruido Ambiental', unit: 'dB', status: value <= limit ? 'safe' : 'warning', location: 'Patio' },
  };
}

function medicalObligation(id: string, daysOffset: number): LegalObligation {
  return {
    id,
    kind: 'medical_exam',
    label: id,
    legalCitation: 'DS 109',
    recurrence: 'annual',
    alertLeadDays: 30,
    nextDueAt: new Date(Date.now() + daysOffset * 86_400_000).toISOString(),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  nodesData = [];
  obligationsData = [];
});

describe('Hygiene page — real derived metrics', () => {
  it('shows honest empty states (no data) when there are no nodes or obligations', () => {
    nodesData = [];
    obligationsData = [];
    render(<Hygiene />);
    // The i18n mock echoes the key when no fallback is given, so we assert on
    // the keys the page resolves — proving the empty-state branches render.
    expect(screen.getByText('hygiene.trend_empty')).toBeInTheDocument();
    // Both occupational-health gauges read "Sin datos", never 92% / 78%.
    expect(screen.queryByText('92%')).toBeNull();
    expect(screen.queryByText('78%')).toBeNull();
    expect(screen.getAllByText('hygiene.no_data').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the real medical-exam compliance % from obligations', () => {
    nodesData = [];
    obligationsData = [
      medicalObligation('m1', 40), // future → compliant
      medicalObligation('m2', 40), // compliant
      medicalObligation('m3', 40), // compliant
      medicalObligation('m4', -5), // overdue
    ];
    render(<Hygiene />);
    // 3 of 4 compliant → 75%. (The old hardcoded value was 92%.)
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.queryByText('92%')).toBeNull();
    // Vaccination still has no source → "Sin datos" (key echoed by the mock).
    expect(screen.getAllByText('hygiene.no_data').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a real trend with month labels when hygiene nodes exist', () => {
    nodesData = [hygieneNode('h1', 85, 85), hygieneNode('h2', 60, 85)];
    obligationsData = [];
    render(<Hygiene />);
    // Real trend shown → empty-state branch absent, caption branch present.
    expect(screen.queryByText('hygiene.trend_empty')).toBeNull();
    expect(screen.getByText('hygiene.trend_caption')).toBeInTheDocument();
  });
});

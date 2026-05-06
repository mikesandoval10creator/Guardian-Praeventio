// @vitest-environment jsdom
//
// Sprint 37 — Brecha B (SLM offline fallback) — wire integration test
// para `Evacuation.handleGenerateEmergencyPlan`.
//
// Cubre el contrato: cuando el device está offline y el SLM on-device
// está disponible, generar plan llama al path `useSlmOffline.generate`
// (no a `geminiService.generateEmergencyPlan` directamente) y la UI
// surface el badge `evacuation-plan-offline-badge`.
//
// Mockear toda la cadena Google Maps / Firebase / contextos para
// aislar el wire. El SLM/Gemini se mockean a nivel de hook + service.
//
// Ver `docs/slm-offline.md` + `product_strategic_gaps_2026-05-04.md`.

import React from 'react';
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
} from 'vitest';
import {
  render,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';

// --- Mock chain ---------------------------------------------------------

// Hoisted state — `vi.mock` factories run BEFORE module-level vars are
// assigned, así que envolvemos los spies en `vi.hoisted` para que estén
// disponibles cuando los factories ejecutan.
const mocks = vi.hoisted(() => ({
  slmGenerate: vi.fn(async (_prompt: string) => 'PLAN_OFFLINE_SLM'),
  geminiGenerateEmergencyPlan: vi.fn(async () => {
    throw new Error('test-fail: Gemini path called instead of SLM hook');
  }),
}));

vi.mock('../hooks/useSlmOffline', () => ({
  useSlmOffline: (opts: { online: (p: string) => Promise<string> }) => ({
    generate: mocks.slmGenerate,
    status: 'slm-ready' as const,
    error: null,
    warmup: vi.fn(),
    slmAvailable: true,
    __onlineCallback: opts.online,
  }),
}));

vi.mock('../services/geminiService', () => ({
  generateEmergencyPlan: mocks.geminiGenerateEmergencyPlan,
  calculateDynamicEvacuationRoute: vi.fn(async () => null),
}));

vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => false,
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: { id: 'p-1', name: 'Faena Norte', industry: 'minería' },
  }),
}));

vi.mock('../contexts/UniversalKnowledgeContext', () => ({
  useUniversalKnowledge: () => ({ nodes: [], loading: false }),
}));

vi.mock('../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ nodes: [], addNode: vi.fn() }),
}));

vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [], loading: false }),
}));

vi.mock('../contexts/EmergencyContext', () => ({
  useEmergency: () => ({ triggerEmergency: vi.fn() }),
}));

vi.mock('../hooks/useSeismicMonitor', () => ({
  useSeismicMonitor: () => ({ criticalAlert: null }),
}));

vi.mock('../services/firebase', () => ({
  db: {},
  collection: vi.fn(),
  addDoc: vi.fn(async () => ({ id: 'doc-1' })),
  serverTimestamp: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => null),
}));

vi.mock('@react-google-maps/api', () => ({
  useJsApiLoader: () => ({ isLoaded: false }),
  GoogleMap: ({ children }: any) =>
    React.createElement('div', { 'data-testid': 'google-map' }, children),
  OverlayView: ({ children }: any) =>
    React.createElement('div', null, children),
  DirectionsService: () => null,
  DirectionsRenderer: () => null,
}));

vi.mock('../components/maps/mapConfig', () => ({
  getMapLoaderConfig: () => ({ id: 'test', googleMapsApiKey: 'test' }),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { Evacuation } from './Evacuation';

beforeEach(() => {
  mocks.slmGenerate.mockClear();
  mocks.geminiGenerateEmergencyPlan.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('Evacuation — Brecha B SLM offline wire', () => {
  it('routes plan generation through useSlmOffline.generate when offline + SLM available, not Gemini directly', async () => {
    const { getByText, queryByTestId } = render(<Evacuation />);

    // Botón debe estar habilitado y reetiquetado a la variante offline.
    const button = getByText(/generar plan \(offline\)/i);
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mocks.slmGenerate).toHaveBeenCalledTimes(1);
    });

    // Gemini NO fue llamado directamente — la ruta pasó por el hook.
    expect(mocks.geminiGenerateEmergencyPlan).not.toHaveBeenCalled();

    // Badge "Modo Offline" en el modal del plan generado.
    await waitFor(() => {
      expect(
        queryByTestId('evacuation-plan-offline-badge'),
      ).toBeInTheDocument();
    });
  });
});

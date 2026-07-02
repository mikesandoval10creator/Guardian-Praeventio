// @vitest-environment jsdom
//
// Praeventio Guard — de-fabrication of the Evacuation.tsx side panels.
// Audit 2026-07-02 §3.1 bugs 8-9 (docs/audits/AUDITORIA-END-TO-END-2026-07-02.md):
//   - "Estado Crítico" hardcoded 'Online' for smoke sensors / fire network with
//     zero real telemetry source. Now honest-empty ("Sin telemetría", gray dot)
//     with a visible note that sensor integration is pending.
//   - "Rutas Disponibles" invented capacity ('120 personas') and time
//     ('2.5 min') per route. Removed; panel now labeled "Referencial" since
//     the route names themselves are illustrative, not from a real named-route
//     catalog.
//
// This test mirrors the mock chain of the sibling `Evacuation.slm.test.tsx`
// (same component, same dependency surface) to isolate the wire without
// standing up Google Maps / Firebase / real contexts.

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../hooks/useSlmOffline', () => ({
  useSlmOffline: () => ({
    generate: vi.fn(),
    status: 'idle' as const,
    error: null,
    warmup: vi.fn(),
    slmAvailable: false,
  }),
}));

vi.mock('../services/geminiService', () => ({
  generateEmergencyPlan: vi.fn(),
  calculateDynamicEvacuationRoute: vi.fn(async () => null),
}));

vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
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
  useSeismicMonitor: () => ({ criticalAlert: null, earthquakes: [], loading: false, error: null }),
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
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Evacuation — "Estado Crítico" panel is honest-empty (no fabricated sensor status)', () => {
  it('does NOT render a hardcoded "Online" status for any item', () => {
    const { queryByText } = render(<Evacuation />);
    expect(queryByText('Online')).not.toBeInTheDocument();
  });

  it('renders "Sin telemetría" for every item instead', () => {
    const { getAllByText, getByText } = render(<Evacuation />);
    expect(getByText('Sensores de Humo')).toBeInTheDocument();
    expect(getByText('Red de Incendio')).toBeInTheDocument();
    // 4 items in the panel, all honest-empty.
    expect(getAllByText('Sin telemetría')).toHaveLength(4);
  });

  it('shows a visible note that sensor integration is pending', () => {
    const { getByText } = render(<Evacuation />);
    expect(
      getByText(/integración de sensores de campo.*está pendiente/i),
    ).toBeInTheDocument();
  });
});

describe('Evacuation — "Rutas Disponibles" panel has no fabricated capacity/time', () => {
  it('does NOT render the previously-hardcoded fabricated capacity literal', () => {
    const { queryByText } = render(<Evacuation />);
    expect(queryByText('120 personas')).not.toBeInTheDocument();
    expect(queryByText('80 personas')).not.toBeInTheDocument();
    expect(queryByText('50 personas')).not.toBeInTheDocument();
  });

  it('does NOT render the previously-hardcoded fabricated time literal', () => {
    const { queryByText } = render(<Evacuation />);
    expect(queryByText('2.5 min')).not.toBeInTheDocument();
    expect(queryByText('3.1 min')).not.toBeInTheDocument();
  });

  it('labels the panel "Referencial" so it does not claim to be live route telemetry', () => {
    const { getByText } = render(<Evacuation />);
    expect(getByText('Referencial')).toBeInTheDocument();
  });

  it('still renders the route ids/status (the real part of the panel)', () => {
    const { getByText, getAllByText } = render(<Evacuation />);
    expect(getByText('R1')).toBeInTheDocument();
    expect(getByText('R2')).toBeInTheDocument();
    expect(getByText('R3')).toBeInTheDocument();
    // All clear by default (no aiRoute.rutasBloqueadas from the mocked service).
    expect(getAllByText('Despejada')).toHaveLength(3);
  });
});

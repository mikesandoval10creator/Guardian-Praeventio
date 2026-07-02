// @vitest-environment jsdom
//
// Praeventio Guard — de-fabrication of EmergenciaAvanzada.tsx.
// Audit 2026-07-02 §3.4 (docs/audits/AUDITORIA-END-TO-END-2026-07-02.md):
//   #1 — both onSnapshot listeners (chat + emergency_safety) had no error
//        callback; a Firestore permission failure was indistinguishable
//        from "no activity". Now both surface an honest error banner.
//   #3 — "Estado de Zonas" had an unconditional 'Zona de Seguridad: ACTIVA'
//        literal with no real source. Removed; only the two entries derived
//        from `activeEmergency` (real state) remain.
//   #4 — `â— EN VIVO` mojibake fixed to `● EN VIVO`.
// Also pins the useSeismicMonitor consumer fix (bug 10): the eternal
// "Cargando datos sísmicos..." now distinguishes loading vs error vs
// genuinely-empty.
//
// NOTE (merge 2026-07-02): this file is deliberately SEPARATE from
// EmergenciaAvanzada.test.tsx (the B.3 worker-SOS suite). The two suites
// need incompatible hermetic mock sets — that one mocks react-i18next and
// captures onSnapshot onNext handlers by path; this one uses real i18n and
// captures the onError callbacks. vi.mock is file-scoped, so merging them
// would silently break one side's assumptions.

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

/** Return shape of the mocked useSeismicMonitor — `error` is a union (not the
 *  inferred `null`) so per-test overrides like `error: 'network down'` type. */
type SeismicMonitorState = {
  earthquakes: unknown[];
  criticalAlert: unknown;
  loading: boolean;
  error: string | null;
};

const mocks = vi.hoisted(() => ({
  seismicMonitor: vi.fn(
    (): {
      earthquakes: unknown[];
      criticalAlert: unknown;
      loading: boolean;
      error: string | null;
    } => ({ earthquakes: [], criticalAlert: null, loading: false, error: null }),
  ),
  // Mutable per-test override for the `emergency_events` collection — most
  // tests want no active emergency (default []); the mojibake test needs
  // one active event to actually exercise the "● EN VIVO" render path.
  emergencyEvents: [] as any[],
  // Captured error callbacks from the two onSnapshot listeners this
  // component owns (emergency_chat, emergency_safety) — set by the mocked
  // onSnapshot below, read by the tests to simulate a Firestore failure.
  chatErrorCb: null as null | ((err: Error) => void),
  safetyErrorCb: null as null | ((err: Error) => void),
}));

vi.mock('../hooks/useAcousticSOS', () => ({
  useAcousticSOS: () => ({ isActive: false, start: vi.fn(), stop: vi.fn() }),
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: { id: 'p-1', name: 'Faena Norte', coordinates: { lat: -33.45, lng: -70.66 } },
  }),
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({
    user: { uid: 'u-1', displayName: 'Ana', email: 'ana@test.cl' },
    isAdmin: true,
  }),
}));

// The component calls useSeismicMonitor(lat, lng); the mock ignores the args
// (no test asserts them) — a plain zero-arg call keeps tsc happy (TS2556:
// spreading unknown[] into the zero-arg vi.fn is not assignable).
vi.mock('../hooks/useSeismicMonitor', () => ({
  useSeismicMonitor: () => mocks.seismicMonitor(),
}));

vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string | null) => {
    if (path && path.endsWith('/emergency_events')) return { data: mocks.emergencyEvents };
    if (path && path.endsWith('/workers')) return { data: [{ id: 'w-1', name: 'Pedro', role: 'Operador' }] };
    return { data: [] };
  },
}));

// Each of the two listeners this component owns (emergency_chat,
// emergency_safety) is distinguished by collection path in the mocked
// `onSnapshot()` call below so the test can trigger each error callback
// independently. The B.3 SOS listener (tenants/{tid}/emergency_alerts,
// merged from main) falls through to the generic branch: it gets an empty
// snapshot and its error callback is never fired here — its behavior is
// pinned by EmergenciaAvanzada.test.tsx.
vi.mock('../services/firebase', () => ({
  db: {},
  serverTimestamp: vi.fn(),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  addDoc: vi.fn(async () => ({ id: 'doc-1' })),
  updateDoc: vi.fn(async () => undefined),
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ path, id })),
  setDoc: vi.fn(async () => undefined),
  onSnapshot: vi.fn((ref: { path: string }, onNext: (snap: any) => void, onError: (err: Error) => void) => {
    if (ref.path.endsWith('/emergency_chat')) {
      mocks.chatErrorCb = onError;
      onNext({ docs: [] });
      return () => {};
    }
    if (ref.path.endsWith('/emergency_safety')) {
      mocks.safetyErrorCb = onError;
      onNext({ docs: [] });
      return () => {};
    }
    onNext({ docs: [] });
    return () => {};
  }),
  query: vi.fn((ref: unknown) => ref),
  orderBy: vi.fn(),
  limit: vi.fn(),
  // Required by the merged page: the B.3 SOS subscription filters with
  // where('projectId','==',...). The mocked query() above ignores
  // constraints, so a plain stub is enough.
  where: vi.fn(),
}));

vi.mock('../components/shared/Card', () => ({
  Card: ({ children, className }: any) => React.createElement('div', { className }, children),
}));

vi.mock('../components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ isOpen, title }: any) =>
    isOpen ? React.createElement('div', { role: 'dialog' }, title) : null,
}));

vi.mock('../components/shared/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
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

import { EmergenciaAvanzada } from './EmergenciaAvanzada';
import { logger } from '../utils/logger';

const seismicState = (over: Partial<SeismicMonitorState> = {}): SeismicMonitorState => ({
  earthquakes: [],
  criticalAlert: null,
  loading: false,
  error: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.seismicMonitor.mockReturnValue(seismicState());
  mocks.emergencyEvents = [];
  mocks.chatErrorCb = null;
  mocks.safetyErrorCb = null;
});

afterEach(() => {
  cleanup();
});

describe('EmergenciaAvanzada — chat onSnapshot error is surfaced (not silent)', () => {
  it('renders an error banner when the chat listener fails', async () => {
    const { getByText, queryByRole } = render(<EmergenciaAvanzada />);
    // Switch to the "comms" tab to see the chat panel.
    fireEvent.click(getByText('Canal de Emergencia'));

    expect(mocks.chatErrorCb).toBeTypeOf('function');
    mocks.chatErrorCb!(new Error('permission-denied'));

    await waitFor(() => {
      expect(queryByRole('alert')).toBeInTheDocument();
    });
    expect(logger.error).toHaveBeenCalledWith(
      'EmergenciaAvanzada: emergency_chat onSnapshot failed',
      expect.any(Error),
      expect.objectContaining({ projectId: 'p-1' }),
    );
  });
});

describe('EmergenciaAvanzada — worker safety onSnapshot error is surfaced (not silent)', () => {
  it('renders an error banner when the safety listener fails', async () => {
    const { getByText, queryByRole } = render(<EmergenciaAvanzada />);
    fireEvent.click(getByText('Brigadas y Recursos'));

    expect(mocks.safetyErrorCb).toBeTypeOf('function');
    mocks.safetyErrorCb!(new Error('permission-denied'));

    await waitFor(() => {
      expect(queryByRole('alert')).toBeInTheDocument();
    });
    expect(logger.error).toHaveBeenCalledWith(
      'EmergenciaAvanzada: emergency_safety onSnapshot failed',
      expect.any(Error),
      expect.objectContaining({ projectId: 'p-1' }),
    );
  });
});

describe('EmergenciaAvanzada — mojibake fix', () => {
  it('renders the correct "● EN VIVO" indicator (not the mojibake) when an emergency is active', () => {
    // The "EN VIVO" badge only renders on the comms tab while
    // activeEmergency is truthy — an inactive-emergency render (the
    // default in every other test in this file) never reaches this
    // branch at all, so this test deliberately seeds an active event to
    // actually exercise the fixed line.
    mocks.emergencyEvents = [{ id: 'ev-1', status: 'active', active: true, startedBy: 'Ana', type: 'Sismo' }];
    const { getByText, container } = render(<EmergenciaAvanzada />);
    fireEvent.click(getByText('Canal de Emergencia'));

    expect(container.innerHTML).toContain('EN VIVO');
    expect(container.innerHTML).toContain('●');
    // No stray mojibake byte sequence anywhere in the DOM.
    expect(container.innerHTML.includes('â—')).toBe(false);
  });
});

describe('EmergenciaAvanzada — "Estado de Zonas" has no fabricated unconditional entry', () => {
  it('does NOT render "Zona de Seguridad" (the previously-unconditional fake entry)', () => {
    const { queryByText } = render(<EmergenciaAvanzada />);
    expect(queryByText('Zona de Seguridad')).not.toBeInTheDocument();
  });

  it('still renders the two real, activeEmergency-derived zone entries', () => {
    const { getByText, getAllByText } = render(<EmergenciaAvanzada />);
    expect(getByText('Área de Trabajo')).toBeInTheDocument();
    expect(getByText('Planta / Faena')).toBeInTheDocument();
    // No active emergency in this test's mocked data → both entries read
    // OPERATIVO (2 separate <span> elements, one per zone).
    expect(getAllByText('OPERATIVO')).toHaveLength(2);
  });
});

describe('EmergenciaAvanzada — seismic panel is honest about loading/error/empty (bug 10)', () => {
  it('shows the loading state only while useSeismicMonitor reports loading:true', () => {
    mocks.seismicMonitor.mockReturnValue(seismicState({ loading: true }));
    const { getByText } = render(<EmergenciaAvanzada />);
    expect(getByText('Cargando datos sísmicos...')).toBeInTheDocument();
  });

  it('shows an honest error state instead of an eternal spinner when USGS fails', () => {
    mocks.seismicMonitor.mockReturnValue(seismicState({ error: 'network down' }));
    const { getByText, queryByText } = render(<EmergenciaAvanzada />);
    expect(queryByText('Cargando datos sísmicos...')).not.toBeInTheDocument();
    expect(getByText(/no se pudo conectar con la red sismológica/i)).toBeInTheDocument();
  });

  it('shows an honest empty state (not "Cargando...") when loading finished with zero quakes', () => {
    mocks.seismicMonitor.mockReturnValue(seismicState());
    const { getByText, queryByText } = render(<EmergenciaAvanzada />);
    expect(queryByText('Cargando datos sísmicos...')).not.toBeInTheDocument();
    expect(getByText(/sin actividad sísmica registrada/i)).toBeInTheDocument();
  });
});

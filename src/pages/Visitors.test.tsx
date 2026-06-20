// @vitest-environment jsdom
//
// Praeventio Guard — §23-24 Visitor Control page wrapper tests.
//
// Covers the wiring added in feat/mount-visitor-checkin: the page now sources
// the active-visit list from `useActiveVisitors` (which fetches the canonical
// `GET /api/visitors?projectId=…` and returns the REAL `Visitor[]` shape).
//
// Scenarios:
//   1. No project selected → select-project empty card.
//   2. Loading → loading placeholder, no empty card.
//   3. Real visitors from the hook → rendered as cards with real fields.
//   4. Empty (loaded, zero visitors) → honest empty state.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Visitors } from './Visitors';
import type { Visitor } from '../services/visitorControl/visitorRegistry';
import type { ActiveVisitorsResponse } from '../hooks/useActiveVisitors';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;

type HookState = {
  data: ActiveVisitorsResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
let mockHook: HookState;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [] as never[], loading: false, error: null }),
}));
vi.mock('../hooks/useActiveVisitors', () => ({
  useActiveVisitors: () => mockHook,
}));
vi.mock('../components/QRScannerModal', () => ({
  QRScannerModal: () => null,
}));
vi.mock('../services/firebase', () => ({
  auth: { currentUser: { uid: 'host-1' } },
}));
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeader: async () => 'Bearer test-token',
}));

function makeVisitor(overrides: Partial<Visitor> = {}): Visitor {
  return {
    id: 'vis_1',
    fullName: 'Ana Visitante',
    rut: '12.345.678-9',
    company: 'Auditora SpA',
    hostUid: 'host-1',
    reason: 'Auditoría ISO 45001',
    inductionVersionId: '',
    checkInAt: '2026-06-20T10:00:00.000Z',
    projectId: 'proj-alpha',
    tenantId: 'tenant-x',
    ...overrides,
  };
}

beforeEach(() => {
  mockSelectedProject = { id: 'proj-alpha', name: 'Faena Alpha' };
  mockIsOnline = true;
  mockHook = { data: null, loading: false, error: null, refetch: vi.fn() };
});

describe('<Visitors />', () => {
  it('muestra selector de proyecto cuando no hay proyecto activo', () => {
    mockSelectedProject = null;
    render(<Visitors />);
    expect(screen.getByTestId('visitors-page-empty')).toBeInTheDocument();
  });

  it('muestra placeholder de carga mientras el hook resuelve', () => {
    mockHook = { data: null, loading: true, error: null, refetch: vi.fn() };
    render(<Visitors />);
    expect(screen.getByTestId('visitors-loading')).toBeInTheDocument();
    // El empty honesto NO debe aparecer durante la carga.
    expect(screen.queryByTestId('visitors-empty')).not.toBeInTheDocument();
  });

  it('renderiza las visitas activas reales devueltas por el hook', () => {
    mockHook = {
      data: { ok: true, visitors: [makeVisitor()] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<Visitors />);
    const list = screen.getByTestId('visitors-list');
    expect(list).toBeInTheDocument();
    // Campos REALES del contrato del backend (Visitor), no inventados.
    expect(screen.getByText('Ana Visitante')).toBeInTheDocument();
    expect(screen.getByText(/Auditora SpA/)).toBeInTheDocument();
    expect(screen.getByText('Auditoría ISO 45001')).toBeInTheDocument();
    expect(screen.queryByTestId('visitors-empty')).not.toBeInTheDocument();
  });

  it('muestra empty-state honesto cuando no hay visitas activas', () => {
    mockHook = {
      data: { ok: true, visitors: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<Visitors />);
    expect(screen.getByTestId('visitors-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('visitors-list')).not.toBeInTheDocument();
  });
});

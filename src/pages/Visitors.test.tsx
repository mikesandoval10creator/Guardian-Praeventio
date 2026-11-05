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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
const H = vi.hoisted(() => ({ authHeader: vi.fn(), fetch: vi.fn() }));
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
let mockUser: { uid: string } | null = { uid: 'host-1' };
vi.mock('../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: mockUser, isAuthReady: true }) }));

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
let mockInductions: Array<{ id: string; title: string }> = [];
vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: mockInductions, loading: false, error: null }),
}));
vi.mock('../hooks/useActiveVisitors', () => ({
  useActiveVisitors: () => mockHook,
}));
let mockRoster: Array<{ uid: string; fullName: string }> = [];
vi.mock('../hooks/useProjectRoster', () => ({
  useProjectRoster: () => ({ roster: mockRoster, loading: false }),
}));
vi.mock('../components/QRScannerModal', () => ({
  QRScannerModal: () => null,
}));
vi.mock('../services/firebase', () => ({
  auth: { get currentUser() { return mockUser; } },
}));
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeader: H.authHeader,
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
  H.authHeader.mockReset().mockResolvedValue('Bearer test-token');
  H.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', H.fetch);
  mockSelectedProject = { id: 'proj-alpha', name: 'Faena Alpha' };
  mockIsOnline = true;
  mockUser = { uid: 'host-1' };
  mockHook = { data: null, loading: false, error: null, refetch: vi.fn() };
  mockRoster = [];
  mockInductions = [];
});

afterEach(() => vi.unstubAllGlobals());

function startOperation(kind: 'checkin' | 'checkout' | 'ack') {
  mockInductions = [{ id: 'ind-1', title: 'Inducción actual' }];
  mockRoster = [{ uid: 'w-1', fullName: 'Acompañante actual' }];
  mockHook = { data: { ok: true, visitors: kind === 'checkin' ? [] : [makeVisitor()] }, loading: false, error: null, refetch: vi.fn() };
  const view = render(<Visitors />);
  if (kind === 'checkin') {
    fireEvent.click(screen.getByTestId('visitors-new-button'));
    fireEvent.change(screen.getByTestId('visitor-fullname'), { target: { value: 'Ana Visitante' } });
    fireEvent.change(screen.getByTestId('visitor-document'), { target: { value: '12345678-5' } });
    fireEvent.change(screen.getByTestId('visitor-organization'), { target: { value: 'Auditora SpA' } });
    fireEvent.submit(screen.getByTestId('visitor-checkin-form'));
  } else if (kind === 'checkout') fireEvent.click(screen.getByTestId('visitor-checkout-btn'));
  else {
    fireEvent.click(screen.getByTestId('visitor-induct-btn'));
    fireEvent.click(screen.getByTestId('visitor-ack-checkbox'));
    fireEvent.change(screen.getByTestId('visitor-ack-signature'), { target: { value: 'Ana Visitante' } });
    fireEvent.click(screen.getByTestId('visitor-ack-submit'));
  }
  return view;
}

describe('<Visitors />', () => {
  it('does not register a foreign-project check-in response in the active page', async () => {
    H.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, visitor: makeVisitor({ projectId: 'proj-beta', fullName: 'Foreign response' }) }) });
    startOperation('checkin');
    await screen.findByRole('alert');
    expect(screen.queryByText('Foreign response')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visitor-ack-modal')).not.toBeInTheDocument();
  });
  it.each(['checkin', 'checkout', 'ack'] as const)('does not rebind %s credentials to a new account', async (kind) => {
    let release!: (value: string) => void;
    H.authHeader.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    const view = startOperation(kind);
    expect(H.authHeader).toHaveBeenCalledTimes(1);
    mockUser = { uid: 'host-2' };
    mockHook = { data: null, loading: false, error: null, refetch: vi.fn() };
    view.rerender(<Visitors />);
    await act(async () => release('Bearer new-synthetic-account'));
    expect(H.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('visitors-error')).not.toBeInTheDocument();
  });
  it.each(['checkin', 'checkout', 'ack'] as const)('aborts %s and ignores its delayed body after switching project', async (kind) => {
    let release!: (value: unknown) => void;
    const json = vi.fn(() => new Promise<unknown>((resolve) => { release = resolve; }));
    H.fetch.mockResolvedValueOnce({ ok: true, json });
    const view = startOperation(kind);
    await waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    const signal = H.fetch.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    mockSelectedProject = { id: 'proj-beta', name: 'Faena Beta' };
    mockHook = { data: { ok: true, visitors: [makeVisitor({ fullName: 'Current B visitor', projectId: 'proj-beta' })] }, loading: false, error: null, refetch: vi.fn() };
    view.rerender(<Visitors />);
    expect(signal.aborted).toBe(true);
    await act(async () => release({ ok: true, visitor: makeVisitor(), inductionVersionId: 'ind-1', inductedAt: '2026-01-01T00:00:00Z' }));
    expect(screen.getByText('Current B visitor')).toBeInTheDocument();
    expect(screen.queryByText('Ana Visitante')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visitor-ack-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visitor-induct-ok')).not.toBeInTheDocument();
  });
  it('rejects foreign-project snapshots before exposing a visitor or its controls', () => {
    mockHook = { data: { ok: true, visitors: [makeVisitor(), makeVisitor({ id: 'foreign', fullName: 'Foreign private visitor', projectId: 'proj-beta' })] }, loading: false, error: null, refetch: vi.fn() };
    render(<Visitors />);
    expect(screen.getByText('Ana Visitante')).toBeInTheDocument();
    expect(screen.queryByText('Foreign private visitor')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('visitor-checkout-btn')).toHaveLength(1);
  });
  it('cancels check-in credentials when its form is closed without changing project', async () => {
    H.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, visitor: makeVisitor() }) });
    let release!: (value: string) => void;
    H.authHeader.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    mockRoster = [{ uid: 'w-1', fullName: 'Acompañante actual' }];
    render(<Visitors />);
    fireEvent.click(screen.getByTestId('visitors-new-button'));
    fireEvent.change(screen.getByTestId('visitor-fullname'), { target: { value: 'Ana Visitante' } });
    fireEvent.change(screen.getByTestId('visitor-document'), { target: { value: '12345678-5' } });
    fireEvent.change(screen.getByTestId('visitor-organization'), { target: { value: 'Auditora SpA' } });
    fireEvent.submit(screen.getByTestId('visitor-checkin-form'));
    expect(H.authHeader).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('visitors-new-button'));
    await act(async () => release('Bearer test-token'));
    expect(H.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('visitor-ack-modal')).not.toBeInTheDocument();
  });
  it('cancels acknowledgement credentials when only the induction modal is closed', async () => {
    let release!: (value: string) => void;
    H.authHeader.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    mockInductions = [{ id: 'ind-1', title: 'Inducción actual' }];
    mockHook = { data: { ok: true, visitors: [makeVisitor()] }, loading: false, error: null, refetch: vi.fn() };
    render(<Visitors />);
    fireEvent.click(screen.getByTestId('visitor-induct-btn'));
    fireEvent.click(screen.getByTestId('visitor-ack-checkbox'));
    fireEvent.change(screen.getByTestId('visitor-ack-signature'), { target: { value: 'Ana Visitante' } });
    fireEvent.click(screen.getByTestId('visitor-ack-submit'));
    expect(H.authHeader).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('visitor-ack-cancel'));
    await act(async () => release('Bearer test-token'));
    expect(H.fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Ana Visitante')).toBeInTheDocument();
    expect(screen.queryByTestId('visitor-induct-ok')).not.toBeInTheDocument();
  });
  it('does not send a checkout after its project changes while credentials resolve', async () => {
    let release!: (value: string) => void;
    H.authHeader.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    mockHook = { data: { ok: true, visitors: [makeVisitor()] }, loading: false, error: null, refetch: vi.fn() };
    const view = render(<Visitors />);
    fireEvent.click(screen.getByTestId('visitor-checkout-btn'));
    expect(H.authHeader).toHaveBeenCalledTimes(1);
    mockSelectedProject = { id: 'proj-beta', name: 'Faena Beta' };
    mockHook = { data: null, loading: false, error: null, refetch: vi.fn() };
    view.rerender(<Visitors />);
    await act(async () => release('Bearer test-token'));
    expect(H.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('visitors-error')).not.toBeInTheDocument();
  });
  it('returns to valid A data after A to no-project to failed B without leaking forms or modals', () => {
    mockHook = { data: { ok: true, visitors: [makeVisitor()] }, loading: false, error: null, refetch: vi.fn() };
    const view = render(<Visitors />);
    fireEvent.click(screen.getByTestId('visitors-new-button'));
    mockSelectedProject = null;
    mockHook = { data: null, loading: false, error: null, refetch: vi.fn() };
    view.rerender(<Visitors />);
    expect(screen.queryByTestId('visitor-checkin-form')).not.toBeInTheDocument();
    mockSelectedProject = { id: 'proj-beta', name: 'Faena Beta' };
    mockHook = { data: null, loading: false, error: new Error('timeout'), refetch: vi.fn() };
    view.rerender(<Visitors />);
    expect(screen.queryByText('Ana Visitante')).not.toBeInTheDocument();
    mockSelectedProject = { id: 'proj-alpha', name: 'Faena Alpha' };
    mockHook = { data: { ok: true, visitors: [makeVisitor()] }, loading: false, error: null, refetch: vi.fn() };
    view.rerender(<Visitors />);
    expect(screen.getByText('Ana Visitante')).toBeInTheDocument();
    expect(screen.queryByTestId('visitor-checkin-form')).not.toBeInTheDocument();
  });
  it('resets the prior actor state on the same project when another user signs in', () => {
    mockHook = { data: { ok: true, visitors: [makeVisitor()] }, loading: false, error: null, refetch: vi.fn() };
    const view = render(<Visitors />);
    fireEvent.click(screen.getByTestId('visitor-induct-btn'));
    mockUser = { uid: 'host-2' };
    mockHook = { data: null, loading: true, error: null, refetch: vi.fn() };
    view.rerender(<Visitors />);
    expect(screen.queryByText('Ana Visitante')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visitor-ack-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('visitors-loading')).toBeInTheDocument();
  });
  it('removes private visits and controls on logout even if the selected project persists', () => {
    mockHook = { data: { ok: true, visitors: [makeVisitor()] }, loading: false, error: null, refetch: vi.fn() };
    const view = render(<Visitors />);
    fireEvent.click(screen.getByTestId('visitors-new-button'));
    expect(screen.getByText('Ana Visitante')).toBeInTheDocument();
    mockUser = null;
    view.rerender(<Visitors />);
    expect(screen.queryByText('Ana Visitante')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visitor-checkin-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visitors-new-button')).not.toBeInTheDocument();
  });
  it('does not retain project A visits or induction controls after B fails to load', () => {
    mockHook = { data: { ok: true, visitors: [makeVisitor()] }, loading: false, error: null, refetch: vi.fn() };
    const view = render(<Visitors />);
    expect(screen.getByText('Ana Visitante')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('visitor-induct-btn'));
    expect(screen.getByTestId('visitor-ack-modal')).toBeInTheDocument();
    mockSelectedProject = { id: 'proj-beta', name: 'Faena Beta' };
    mockHook = { data: null, loading: false, error: new Error('HTTP 403'), refetch: vi.fn() };
    view.rerender(<Visitors />);
    expect(screen.queryByText('Ana Visitante')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visitor-ack-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visitor-checkout-btn')).not.toBeInTheDocument();
  });
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

  it('monta <VisitorCheckInForm/> con hosts reales del roster al abrir "Nueva visita"', () => {
    mockHook = {
      data: { ok: true, visitors: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    mockRoster = [
      { uid: 'w-1', fullName: 'Pedro Capataz' },
      { uid: 'w-2', fullName: 'Ana Prevencionista' },
    ];
    render(<Visitors />);
    // El form orphan no está montado hasta abrir el CTA.
    expect(screen.queryByTestId('visitor-checkin-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('visitors-new-button'));
    // El form REAL (componente antes huérfano) ahora se renderiza.
    expect(screen.getByTestId('visitor-checkin-form')).toBeInTheDocument();
    // El selector de acompañante usa los nombres REALES del roster, no inventados.
    const hostSelect = screen.getByTestId('visitor-host') as HTMLSelectElement;
    const optionLabels = Array.from(hostSelect.options).map((o) => o.textContent);
    expect(optionLabels).toContain('Pedro Capataz');
    expect(optionLabels).toContain('Ana Prevencionista');
  });
});

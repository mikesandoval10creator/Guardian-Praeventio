// @vitest-environment jsdom
//
// Praeventio Guard — page wrapper tests for <WasteInventoryPage />.
//
// Smoke tests:
//   1. Empty state when no project is selected.
//   2. Loading state while the real waste-inventory endpoint is in flight.
//   3. Error state surfaces the endpoint error message.
//   4. Real data → WasteInventoryPanel renders the inventory computed by the
//      real buildWasteInventoryReport engine (totals + per-kind), a pending
//      manifest, and an expiring permit (detectPermitExpirations, 90d window).
//
// Only the network/context frontier is mocked (useWaste endpoint hook,
// ProjectContext, useOnlineStatus, react-i18next). The data shapes mirror the
// REAL WasteInventoryResponse contract (src/hooks/useWaste.ts) and the panel
// uses the REAL pure engines from environmentalCompliance.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WasteInventoryPage } from './WasteInventoryPage';
import type { WasteInventoryResponse } from '../hooks/useWaste';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string) =>
      typeof fallback === 'string' ? fallback : k,
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

let mockOnline = true;
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockOnline,
}));

interface HookState {
  data: WasteInventoryResponse | null;
  loading: boolean;
  error: Error | null;
}
let mockHookState: HookState = { data: null, loading: false, error: null };
const useWasteInventoryMock = vi.fn();

vi.mock('../hooks/useWaste', () => ({
  useWasteInventory: (...args: unknown[]) => {
    useWasteInventoryMock(...args);
    return mockHookState;
  },
}));

// Future ISO date N days from now (for the expiring-permit window assertion).
function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

const realResponse: WasteInventoryResponse = {
  wastes: [
    {
      id: 'w-1',
      kind: 'hazardous',
      description: 'Aceite usado',
      quantityKg: 120,
      generatedAt: '2026-06-01T08:00:00.000Z',
      storageLocation: 'Bodega RESPEL',
    },
    {
      id: 'w-2',
      kind: 'hazardous',
      description: 'Trapos contaminados',
      quantityKg: 30,
      generatedAt: '2026-06-02T08:00:00.000Z',
      storageLocation: 'Bodega RESPEL',
    },
    {
      id: 'w-3',
      kind: 'recyclable',
      description: 'Cartón',
      quantityKg: 50,
      generatedAt: '2026-06-03T08:00:00.000Z',
      storageLocation: 'Punto limpio',
    },
  ],
  pendingManifests: [
    {
      id: 'mf-001',
      wasteIds: ['w-9'],
      transporterId: 't-1',
      receiverId: 'r-1',
      dispatchedAt: '2026-06-10T12:00:00.000Z',
      hasDiscrepancy: false,
    },
  ],
  permits: [
    {
      id: 'pm-rca',
      kind: 'RCA',
      issuedAt: '2024-01-01T00:00:00.000Z',
      expiresAt: isoDaysFromNow(30), // within the 90d window → must render
      reference: 'RCA-123/2024',
    },
    {
      id: 'pm-dia-far',
      kind: 'DIA',
      issuedAt: '2024-01-01T00:00:00.000Z',
      expiresAt: isoDaysFromNow(400), // outside the window → must NOT render
      reference: 'DIA-999/2024',
    },
  ],
};

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  mockOnline = true;
  mockHookState = { data: null, loading: false, error: null };
  useWasteInventoryMock.mockClear();
});

describe('<WasteInventoryPage /> (gestión ambiental — residuos)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<WasteInventoryPage />);
    expect(screen.getByTestId('waste-inventory-page-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('waste-inventory-panel')).not.toBeInTheDocument();
  });

  it('pide el inventario real del proyecto seleccionado', () => {
    render(<WasteInventoryPage />);
    expect(useWasteInventoryMock).toHaveBeenCalledWith('p-1');
  });

  it('muestra el estado de carga mientras el endpoint está en vuelo', () => {
    mockHookState = { data: null, loading: true, error: null };
    render(<WasteInventoryPage />);
    expect(screen.getByTestId('waste-inventory-loading')).toBeInTheDocument();
  });

  it('muestra el error del endpoint', () => {
    mockHookState = { data: null, loading: false, error: new Error('http_500') };
    render(<WasteInventoryPage />);
    const err = screen.getByTestId('waste-inventory-error');
    expect(err).toBeInTheDocument();
    expect(err).toHaveTextContent(/servidor tuvo un problema/i);
  });

  it('renderiza el panel con el inventario real computado por el motor', () => {
    mockHookState = { data: realResponse, loading: false, error: null };
    render(<WasteInventoryPage />);

    expect(screen.getByTestId('waste-inventory-panel')).toBeInTheDocument();

    // buildWasteInventoryReport: 2 peligrosos (150 kg) + 1 reciclable (50 kg).
    const hazardous = screen.getByTestId('waste-kind-hazardous');
    expect(hazardous).toHaveTextContent('2');
    expect(hazardous).toHaveTextContent('150 kg');

    const recyclable = screen.getByTestId('waste-kind-recyclable');
    expect(recyclable).toHaveTextContent('1');
    expect(recyclable).toHaveTextContent('50 kg');

    // Total kg = 200; all 3 in stock (none has a manifestId).
    expect(screen.getByText(/200 kg/)).toBeInTheDocument();
  });

  it('renderiza los manifiestos pendientes de recepción', () => {
    mockHookState = { data: realResponse, loading: false, error: null };
    render(<WasteInventoryPage />);
    const pending = screen.getByTestId('waste-pending-manifests');
    expect(pending).toBeInTheDocument();
    expect(pending).toHaveTextContent('mf-001');
  });

  it('renderiza solo los permisos dentro de la ventana de 90 días (detectPermitExpirations)', () => {
    mockHookState = { data: realResponse, loading: false, error: null };
    render(<WasteInventoryPage />);
    expect(screen.getByTestId('waste-expiring-permits')).toBeInTheDocument();
    // RCA vence en 30 días → dentro de la ventana.
    expect(screen.getByTestId('waste-permit-pm-rca')).toBeInTheDocument();
    // DIA vence en 400 días → fuera de la ventana, no se renderiza.
    expect(screen.queryByTestId('waste-permit-pm-dia-far')).not.toBeInTheDocument();
  });

  it('muestra el chip offline cuando no hay conexión', () => {
    mockOnline = false;
    mockHookState = { data: realResponse, loading: false, error: null };
    render(<WasteInventoryPage />);
    expect(screen.getByTestId('waste-inventory-offline-chip')).toBeInTheDocument();
  });
});

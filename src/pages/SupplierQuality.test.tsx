// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §90-91 page wrapper tests.
//
// Smoke tests para <SupplierQuality />:
//   1. Empty state cuando no hay proyecto seleccionado.
//   2. Loading state desde el hook.
//   3. Error del hook surface en UI.
//   4. Renderiza lista de proveedores con risk badge + score + trend.
//   5. Filter chip cambia el riskLevel argumento del hook.
//   6. Form de registro aparece al hacer click en "Nuevo proveedor"
//      y dispara `registerSupplier` con payload correcto.
//   7. Click en supplier card abre el detail modal.
//
// El componente mockea hook + project/online contexts → hermético, sin
// Firestore ni fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SupplierQuality } from './SupplierQuality';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;

type SupplierViewLike = {
  id: string;
  legalName: string;
  taxId: string;
  services: string[];
  criticalRoles: string[];
  active: boolean;
  registeredAt: string;
  score: number;
  riskLevel: 'low' | 'medium' | 'high';
  trend: 'improving' | 'stable' | 'worsening';
  lastIncidentAt: string | null;
  lastAuditAt: string | null;
  incidentCount: number;
  auditCount: number;
};

type HookState = {
  data: { suppliers: SupplierViewLike[]; total: number } | null;
  loading: boolean;
  error: Error | null;
};

let mockHook: HookState = { data: null, loading: false, error: null };

type RankingEntryLike = SupplierViewLike & {
  rank: number;
  breakdown: {
    safetyPerformance: number;
    documentCompliance: number;
    responsiveness: number;
    reputation: number;
  };
};
type RankingHookState = {
  data: { ranking: RankingEntryLike[]; total: number } | null;
  loading: boolean;
  error: Error | null;
};
let mockRankingHook: RankingHookState = { data: null, loading: false, error: null };
let lastFilterArg: string | undefined = undefined;
const refetchSpy = vi.fn();
const registerSpy = vi.fn(async (_pid: string, _payload: unknown) => ({
  id: 'new-id',
  legalName: 'X',
  taxId: 'X',
  services: [],
  criticalRoles: [],
  active: true,
  registeredAt: '2026-05-17T00:00:00.000Z',
  score: 0,
  riskLevel: 'medium' as const,
  trend: 'stable' as const,
  lastIncidentAt: null,
  lastAuditAt: null,
  incidentCount: 0,
  auditCount: 0,
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSuppliers', () => ({
  useSuppliers: (_pid: string | null, opts?: { riskLevel?: string }) => {
    lastFilterArg = opts?.riskLevel;
    return { ...mockHook, refetch: refetchSpy };
  },
  useSupplierRanking: (_pid: string | null) => ({
    ...mockRankingHook,
    refetch: vi.fn(),
  }),
  registerSupplier: (pid: string, payload: unknown) => registerSpy(pid, payload),
}));

const VIEW: SupplierViewLike = {
  id: 'sup_a',
  legalName: 'Andes Transporte SpA',
  taxId: '76.123.456-7',
  services: ['transporte', 'logística'],
  criticalRoles: ['conductor de buses'],
  active: true,
  registeredAt: '2026-01-01T00:00:00.000Z',
  score: 82.5,
  riskLevel: 'low',
  trend: 'improving',
  lastIncidentAt: '2026-03-12T10:00:00.000Z',
  lastAuditAt: '2026-04-01T00:00:00.000Z',
  incidentCount: 1,
  auditCount: 2,
};

const VIEW_HIGH: SupplierViewLike = {
  id: 'sup_b',
  legalName: 'Catering Riesgoso Ltda',
  taxId: '99.888.777-K',
  services: ['catering'],
  criticalRoles: [],
  active: true,
  registeredAt: '2026-02-01T00:00:00.000Z',
  score: 32.0,
  riskLevel: 'high',
  trend: 'worsening',
  lastIncidentAt: '2026-05-01T08:00:00.000Z',
  lastAuditAt: null,
  incidentCount: 4,
  auditCount: 0,
};

const RANK_ENTRY: RankingEntryLike = {
  ...VIEW,
  id: 'sup_a',
  rank: 1,
  breakdown: {
    safetyPerformance: 90,
    documentCompliance: 85,
    responsiveness: 70,
    reputation: 80,
  },
};
const RANK_ENTRY_HIGH: RankingEntryLike = {
  ...VIEW_HIGH,
  id: 'sup_b',
  rank: 2,
  breakdown: {
    safetyPerformance: 40,
    documentCompliance: 30,
    responsiveness: 25,
    reputation: 35,
  },
};

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockHook = { data: null, loading: false, error: null };
  mockRankingHook = { data: null, loading: false, error: null };
  lastFilterArg = undefined;
  refetchSpy.mockClear();
  registerSpy.mockClear();
});

describe('<SupplierQuality /> page wrapper (Sprint K §90-91)', () => {
  it('1. renderiza empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<SupplierQuality />);
    expect(screen.getByTestId('suppliers-page-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('2. renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHook = { data: null, loading: true, error: null };
    render(<SupplierQuality />);
    expect(screen.getByTestId('suppliers-loading')).toBeInTheDocument();
  });

  it('3. surface error del hook con el mensaje', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHook = { data: null, loading: false, error: new Error('Network down') };
    render(<SupplierQuality />);
    expect(screen.getByTestId('suppliers-error')).toBeInTheDocument();
    expect(screen.getByText(/conectar con el servidor/i)).toBeInTheDocument();
  });

  it('4. renderiza lista con risk badge + score + RUT + servicios', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHook = {
      data: { suppliers: [VIEW, VIEW_HIGH], total: 2 },
      loading: false,
      error: null,
    };
    render(<SupplierQuality />);
    expect(screen.getByTestId('suppliers-list')).toBeInTheDocument();
    expect(screen.getByTestId('suppliers-card-sup_a')).toBeInTheDocument();
    expect(screen.getByTestId('suppliers-card-sup_b')).toBeInTheDocument();
    // RUT visible
    expect(screen.getByText('76.123.456-7')).toBeInTheDocument();
    // Risk badge low + high renderizados
    expect(screen.getAllByTestId('suppliers-risk-low').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('suppliers-risk-high').length).toBeGreaterThan(0);
    // Score numérico visible
    expect(screen.getByText('82.5')).toBeInTheDocument();
    expect(screen.getByText('32.0')).toBeInTheDocument();
  });

  it('5. filter chip cambia el riskLevel pasado al hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHook = {
      data: { suppliers: [VIEW], total: 1 },
      loading: false,
      error: null,
    };
    render(<SupplierQuality />);
    // Default es 'all'
    expect(lastFilterArg).toBe('all');
    // Click en filter 'high'
    fireEvent.click(screen.getByTestId('suppliers-filter-high'));
    expect(lastFilterArg).toBe('high');
  });

  it('6. abre el form y dispara registerSupplier con payload correcto', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHook = {
      data: { suppliers: [], total: 0 },
      loading: false,
      error: null,
    };
    render(<SupplierQuality />);
    fireEvent.click(screen.getByTestId('suppliers-register-btn'));
    expect(screen.getByTestId('suppliers-register-form')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('suppliers-form-name'), {
      target: { value: 'Mutual Constructora' },
    });
    fireEvent.change(screen.getByTestId('suppliers-form-taxid'), {
      target: { value: '12.345.678-9' },
    });
    fireEvent.change(screen.getByTestId('suppliers-form-services'), {
      target: { value: 'EPP, capacitación' },
    });
    fireEvent.click(screen.getByTestId('suppliers-form-submit'));
    // Permite a la promesa resolverse
    await Promise.resolve();
    expect(registerSpy).toHaveBeenCalledTimes(1);
    const [pid, payload] = registerSpy.mock.calls[0];
    expect(pid).toBe('p-1');
    expect(payload).toMatchObject({
      name: 'Mutual Constructora',
      taxId: '12.345.678-9',
      services: ['EPP', 'capacitación'],
    });
  });

  it('8. monta <SupplierComparator> con el ranking REAL del endpoint', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHook = {
      data: { suppliers: [VIEW, VIEW_HIGH], total: 2 },
      loading: false,
      error: null,
    };
    mockRankingHook = {
      data: { ranking: [RANK_ENTRY, RANK_ENTRY_HIGH], total: 2 },
      loading: false,
      error: null,
    };
    render(<SupplierQuality />);
    // El comparador está montado y rinde las filas del ranking real.
    expect(screen.getByTestId('supplier-comparator')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-rank-sup_a')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-rank-sup_b')).toBeInTheDocument();
    // sup_a (riskLevel low) marcado como recomendado.
    expect(screen.getByTestId('supplier-recommended-sup_a')).toBeInTheDocument();
    // Score real (redondeado) visible.
    expect(screen.getByText('83')).toBeInTheDocument();
  });

  it('9. comparador muestra empty-state honesto sin ranking', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHook = { data: { suppliers: [], total: 0 }, loading: false, error: null };
    mockRankingHook = { data: { ranking: [], total: 0 }, loading: false, error: null };
    render(<SupplierQuality />);
    expect(screen.getByTestId('supplier-comparator')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-ranking').textContent).toMatch(
      /Sin proveedores/,
    );
    expect(
      screen.queryByTestId('supplier-critical-risks'),
    ).not.toBeInTheDocument();
  });

  it('10. comparador surface error del ranking endpoint', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHook = { data: { suppliers: [], total: 0 }, loading: false, error: null };
    mockRankingHook = {
      data: null,
      loading: false,
      error: new Error('ranking_down'),
    };
    render(<SupplierQuality />);
    expect(screen.getByTestId('suppliers-ranking-error')).toBeInTheDocument();
    expect(screen.getByText(/No pudimos completar la acción/i)).toBeInTheDocument();
    // En error NO se monta el comparador (evita render vacío engañoso).
    expect(screen.queryByTestId('supplier-comparator')).not.toBeInTheDocument();
  });

  it('7. click en supplier card abre el detail modal', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHook = {
      data: { suppliers: [VIEW], total: 1 },
      loading: false,
      error: null,
    };
    render(<SupplierQuality />);
    expect(screen.queryByTestId('suppliers-detail-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('suppliers-card-sup_a'));
    expect(screen.getByTestId('suppliers-detail-modal')).toBeInTheDocument();
    // Modal muestra detalles (legalName, score, RUT) — usa getAllByText
    // porque el nombre puede aparecer también en la card de fondo.
    expect(screen.getAllByText(/Andes Transporte SpA/).length).toBeGreaterThan(0);
    // Cierra al hacer click en X
    fireEvent.click(screen.getByTestId('suppliers-detail-close'));
    expect(screen.queryByTestId('suppliers-detail-modal')).not.toBeInTheDocument();
  });
});

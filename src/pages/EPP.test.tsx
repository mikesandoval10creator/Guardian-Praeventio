// @vitest-environment jsdom
//
// Praeventio Guard — EPP page: EppInspectionForm mount (Bloque 4.2).
//
// Verifies that the EPP page wires the REAL <EppInspectionForm /> against the
// real Firestore EPP catalog and persists the inspection through the real
// eppFlow client (`submitEppInspection`):
//   1. The inspection toggle is disabled when there is no EPP catalog.
//   2. Toggling reveals the form populated with the REAL catalog rows
//      (id/category/name → itemId/kind/label), not placeholders.
//   3. Marking every item OK and submitting calls submitEppInspection with the
//      derived projectId / tenantId / catalog payload, and shows the result.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { EPP } from './EPP';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fb?: string) => (typeof fb === 'string' ? fb : k),
  }),
}));

// framer-motion: render children plainly (strip animation-only props so React
// does not warn about unknown DOM attributes).
const MOTION_ONLY_PROPS = [
  'initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout',
];
vi.mock('framer-motion', () => {
  const React = require('react');
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: Record<string, unknown>, ref: unknown) => {
      const domProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (!MOTION_ONLY_PROPS.includes(k)) domProps[k] = v;
      }
      return React.createElement(tag, { ref, ...domProps }, children);
    });
  return {
    motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

let mockEppItems: Array<Record<string, unknown>> = [];
vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string | null) => {
    if (path && path.includes('/epp_items')) {
      return { data: mockEppItems, loading: false };
    }
    return { data: [], loading: false };
  },
}));

let mockProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockProject }),
}));

let mockFirebase: {
  user: { uid: string; displayName?: string } | null;
  userRole: string;
  isAdmin: boolean;
} = {
  user: { uid: 'worker-7', displayName: 'Pedro' },
  userRole: 'worker',
  isAdmin: false,
};
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => mockFirebase,
}));

let mockTenant: { tenantId: string | null; loading: boolean } = {
  tenantId: 'tenant-1',
  loading: false,
};
vi.mock('../hooks/useTenantId', () => ({ useTenantId: () => mockTenant }));

// Real client mutator — assert the page calls it with the derived payload.
const submitEppInspection = vi.fn(
  async (_projectId: string, _input: unknown) => ({
    ok: true,
    nodeCount: 1,
    edgeCount: 0,
    suggestedOrder: null,
    notes: [] as string[],
  }),
);
// Pending-orders list — the panel calls this; default empty (honest empty-state).
let mockPendingOrders: Array<Record<string, unknown>> = [];
const listPendingEppOrders = vi.fn(async (_projectId: string) => ({
  orders: mockPendingOrders,
}));
const signEppOrder = vi.fn();
const downloadEppOrderPdf = vi.fn();
vi.mock('../hooks/useEppFlow', () => ({
  submitEppInspection: (projectId: string, input: unknown) =>
    submitEppInspection(projectId, input),
  listPendingEppOrders: (projectId: string) => listPendingEppOrders(projectId),
  signEppOrder: (...a: unknown[]) => signEppOrder(...a),
  downloadEppOrderPdf: (...a: unknown[]) => downloadEppOrderPdf(...a),
}));

// Biometric ceremony used by <PurchaseOrderSignModal /> — supported, no-op.
vi.mock('../hooks/useBiometricAuth', () => ({
  useBiometricAuth: () => ({ isSupported: true, authenticate: vi.fn(async () => true) }),
}));

vi.mock('../components/epp/AssignEPPModal', () => ({
  AssignEPPModal: () => null,
}));
vi.mock('../components/epp/EPPVerificationModal', () => ({
  EPPVerificationModal: () => null,
}));

vi.mock('../services/firebase', () => ({
  db: {},
  serverTimestamp: () => 'ts',
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  addDoc: vi.fn(async () => ({ id: 'x' })),
  where: vi.fn(() => ({})),
}));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockProject = { id: 'proj-1', name: 'Faena Norte' };
  mockTenant = { tenantId: 'tenant-1', loading: false };
  mockFirebase = {
    user: { uid: 'worker-7', displayName: 'Pedro' },
    userRole: 'worker',
    isAdmin: false,
  };
  mockPendingOrders = [];
  mockEppItems = [
    { id: 'epp-casco', name: 'Casco clase B', category: 'cabeza', stock: 12, required: true, description: '' },
    { id: 'epp-guante', name: 'Guante anticorte', category: 'manos', stock: 4, required: true, description: '' },
  ];
});

/** A realistic pending OC as returned by the server (full draft, real fields). */
function pendingOrderFixture(orderId = 'oc-insp-001') {
  return {
    orderId,
    projectId: 'proj-1',
    tenantId: 'tenant-1',
    inspectionId: 'insp-001',
    suggestedNodeId: 'node-oc-1',
    suggestedAt: '2026-06-20T10:00:00.000Z',
    status: 'pending_signature' as const,
    draft: {
      lines: [
        { kind: 'manos', quantity: 6, estimatedUnitCostClp: 5000, supplierId: 'sup-1', urgency: 'urgent' },
      ],
      totalClp: 30000,
      deliveryWeekHint: 2,
      notes: [] as string[],
    },
  };
}

describe('<EPP /> — EppInspectionForm mount', () => {
  it('habilita el toggle de inspección cuando hay catálogo real', () => {
    render(<EPP />);
    const toggle = screen.getByTestId('epp-inspect-toggle');
    expect(toggle).toBeEnabled();
  });

  it('deshabilita el toggle cuando no hay items EPP', () => {
    mockEppItems = [];
    render(<EPP />);
    expect(screen.getByTestId('epp-inspect-toggle')).toBeDisabled();
  });

  it('revela el formulario con los items REALES del catálogo al togglear', () => {
    render(<EPP />);
    fireEvent.click(screen.getByTestId('epp-inspect-toggle'));

    expect(screen.getByTestId('epp-inspection-section')).toBeInTheDocument();
    const form = screen.getByTestId('epp-inspection-form');
    // The two REAL catalog rows render — not a hardcoded placeholder set.
    expect(within(form).getByTestId('epp-item:epp-casco')).toBeInTheDocument();
    expect(within(form).getByTestId('epp-item:epp-guante')).toBeInTheDocument();
    expect(within(form).getByText('Casco clase B')).toBeInTheDocument();
    expect(within(form).getByText('Guante anticorte')).toBeInTheDocument();
  });

  it('persiste la inspección vía submitEppInspection con el payload derivado', async () => {
    render(<EPP />);
    fireEvent.click(screen.getByTestId('epp-inspect-toggle'));

    // Marcar ambos items como OK para habilitar el submit.
    fireEvent.click(screen.getByTestId('epp-status:epp-casco:ok'));
    fireEvent.click(screen.getByTestId('epp-status:epp-guante:ok'));

    const submit = screen.getByTestId('epp-inspection-submit');
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(submitEppInspection).toHaveBeenCalledTimes(1));
    const call = submitEppInspection.mock.calls[0];
    const projectId = call[0];
    const input = call[1] as {
      tenantId: string;
      inspection: { workerUid: string; items: Array<{ itemId: string; kind: string }> };
      inventoryByKind: Record<string, { currentStock: number }>;
    };
    expect(projectId).toBe('proj-1');
    expect(input.tenantId).toBe('tenant-1');
    expect(input.inspection.workerUid).toBe('worker-7');
    // Real catalog items flowed through (ids + kinds from Firestore docs).
    expect(input.inspection.items.map((i) => i.itemId).sort()).toEqual([
      'epp-casco',
      'epp-guante',
    ]);
    expect(input.inspection.items.find((i) => i.itemId === 'epp-casco')?.kind).toBe('cabeza');
    // Inventory grouped by category from the real `stock` field.
    expect(input.inventoryByKind.cabeza.currentStock).toBe(12);
    expect(input.inventoryByKind.manos.currentStock).toBe(4);

    // Success message rendered.
    await waitFor(() =>
      expect(screen.getByTestId('epp-inspection-result')).toBeInTheDocument(),
    );
  });
});

describe('<EPP /> — PendingPurchaseOrdersPanel mount (Bloque 4.2)', () => {
  it('NO muestra el panel de OC para un worker (rol sin firma)', async () => {
    render(<EPP />);
    // Worker role → panel hidden; the server would 403 anyway. No list fetch.
    await waitFor(() => expect(submitEppInspection).toHaveBeenCalledTimes(0));
    expect(screen.queryByTestId('pending-orders-panel')).not.toBeInTheDocument();
    expect(listPendingEppOrders).not.toHaveBeenCalled();
  });

  it('muestra el panel y consulta OC reales para un rol elevado (prevencionista)', async () => {
    mockFirebase = {
      user: { uid: 'prev-1', displayName: 'Ana' },
      userRole: 'prevencionista',
      isAdmin: false,
    };
    render(<EPP />);
    // Panel mounted → it fetches real pending orders for the active project.
    expect(screen.getByTestId('pending-orders-panel')).toBeInTheDocument();
    await waitFor(() => expect(listPendingEppOrders).toHaveBeenCalledWith('proj-1'));
  });

  it('renderiza empty-state honesto cuando no hay OC pendientes', async () => {
    mockFirebase = { user: { uid: 'admin-1' }, userRole: 'admin', isAdmin: true };
    mockPendingOrders = [];
    render(<EPP />);
    await waitFor(() =>
      expect(screen.getByTestId('pending-orders-empty')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('pending-orders-empty')).toHaveTextContent(
      'No hay OC pendientes de firma.',
    );
  });

  it('lista las OC reales devueltas por el server y abre el modal de firma', async () => {
    mockFirebase = { user: { uid: 'admin-1', displayName: 'Jefe' }, userRole: 'admin', isAdmin: true };
    mockPendingOrders = [pendingOrderFixture('oc-real-9')];
    render(<EPP />);

    // The real order from the server renders (id + total from the draft).
    await waitFor(() =>
      expect(screen.getByTestId('pending-order:oc-real-9')).toBeInTheDocument(),
    );
    expect(screen.getByText('oc-real-9')).toBeInTheDocument();

    // "Revisar y firmar" opens the biometric sign modal for that order.
    fireEvent.click(screen.getByTestId('pending-order-review:oc-real-9'));
    await waitFor(() =>
      expect(screen.getByTestId('oc-sign-modal')).toBeInTheDocument(),
    );
  });
});

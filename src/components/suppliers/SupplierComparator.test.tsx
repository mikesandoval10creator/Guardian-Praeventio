// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SupplierComparator } from './SupplierComparator.js';
import type {
  Supplier,
  ServiceDeliveryEvent,
  SLATarget,
} from '../../services/suppliers/supplierQualityService.js';
import type { SupplierRankingEntry } from '../../hooks/useSuppliers.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const target: SLATarget = {
  service: 'transport',
  responseTimeHours: 24,
  acceptableFailureRate: 0.1,
};

function ev(supplierId: string, successful: boolean, hours = 12): ServiceDeliveryEvent {
  return {
    supplierId,
    service: 'transport',
    requestedAt: '2026-05-01T00:00:00Z',
    completedAt: new Date(Date.parse('2026-05-01T00:00:00Z') + hours * 3_600_000).toISOString(),
    successful,
  };
}

const suppliers: Supplier[] = [
  { id: 's1', legalName: 'Transporte Andes', services: ['transport'], active: true, qualified: true },
  { id: 's2', legalName: 'Logística Sur', services: ['transport'], active: true, qualified: true },
];

describe('<SupplierComparator />', () => {
  it('renderiza ranking', () => {
    const events = [ev('s1', true), ev('s1', true), ev('s2', false)];
    render(
      <SupplierComparator
        suppliers={suppliers}
        events={events}
        service="transport"
        defaultTarget={target}
        criticalServices={['transport']}
      />,
    );
    expect(screen.getByTestId('supplier-comparator')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-rank-s1')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-rank-s2')).toBeInTheDocument();
  });

  it('marca top recomendados', () => {
    const events = [ev('s1', true)];
    render(
      <SupplierComparator
        suppliers={suppliers}
        events={events}
        service="transport"
        defaultTarget={target}
        criticalServices={[]}
      />,
    );
    expect(screen.getByTestId('supplier-recommended-s1')).toBeInTheDocument();
  });

  it('muestra empty state si no hay proveedores', () => {
    render(
      <SupplierComparator
        suppliers={[]}
        events={[]}
        service="catering"
        defaultTarget={target}
        criticalServices={[]}
      />,
    );
    expect(screen.getByTestId('supplier-ranking').textContent).toMatch(/Sin proveedores/);
  });

  it('alerta sole supplier en servicio crítico', () => {
    const single: Supplier[] = [suppliers[0]];
    render(
      <SupplierComparator
        suppliers={single}
        events={[]}
        service="transport"
        defaultTarget={target}
        criticalServices={['transport']}
      />,
    );
    expect(screen.getByTestId('supplier-critical-risks')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-risk-transport')).toBeInTheDocument();
  });
});

// ── Modo datos reales (ranking del endpoint /suppliers/ranking) ──────────

function entry(
  id: string,
  rank: number,
  score: number,
  riskLevel: 'low' | 'medium' | 'high',
  incidentCount: number,
): SupplierRankingEntry {
  return {
    id,
    legalName: `Proveedor ${id}`,
    taxId: '76.000.000-0',
    services: ['transporte'],
    criticalRoles: [],
    active: true,
    registeredAt: '2026-01-01T00:00:00Z',
    score,
    riskLevel,
    trend: 'stable',
    lastIncidentAt: null,
    lastAuditAt: null,
    incidentCount,
    auditCount: 0,
    rank,
    breakdown: {
      safetyPerformance: score,
      documentCompliance: score,
      responsiveness: score,
      reputation: score,
    },
  };
}

describe('<SupplierComparator /> modo ranking real', () => {
  it('renderiza filas del ranking real ordenadas por rank', () => {
    render(
      <SupplierComparator
        ranking={[
          entry('s2', 2, 40, 'high', 5),
          entry('s1', 1, 88, 'low', 0),
        ]}
        service="Todos los servicios"
      />,
    );
    expect(screen.getByTestId('supplier-comparator')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-rank-s1')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-rank-s2')).toBeInTheDocument();
    // s1 (low) marcado recomendado, s2 (high) no.
    expect(screen.getByTestId('supplier-recommended-s1')).toBeInTheDocument();
    expect(screen.queryByTestId('supplier-recommended-s2')).not.toBeInTheDocument();
    // Score real redondeado visible.
    expect(screen.getByText('88')).toBeInTheDocument();
  });

  it('empty-state honesto sin ranking', () => {
    render(<SupplierComparator ranking={[]} />);
    expect(screen.getByTestId('supplier-ranking').textContent).toMatch(
      /Sin proveedores/,
    );
    expect(screen.queryByTestId('supplier-critical-risks')).not.toBeInTheDocument();
  });

  it('marca sole-supplier cuando el ranking real trae un único proveedor', () => {
    render(
      <SupplierComparator
        ranking={[entry('s1', 1, 70, 'medium', 1)]}
        service="transporte"
      />,
    );
    expect(screen.getByTestId('supplier-critical-risks')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-risk-transporte')).toBeInTheDocument();
  });

  // [P1][vida-safety] Hy3-audit 3c6aa66d-73fe-8170-bdab-e1d1ebd032e5
  // (reabierto 2026-08-24): cubre el caso de 2+ proveedores todos
  // riskLevel: 'high' en modo ranking. El branch allHigh del componente
  // debe derivar hasHighSystemicRisk=true, y la UI debe mostrar la alerta
  // de riesgo sistémico. Sin este test, una regresión que rompa el
  // derivador silenciaría la señal de vida-safety.
  it('alerta riesgo sistémico cuando 2+ proveedores del ranking son high', () => {
    render(
      <SupplierComparator
        ranking={[
          entry('s1', 1, 30, 'high', 5),
          entry('s2', 2, 25, 'high', 7),
          entry('s3', 3, 28, 'high', 6),
        ]}
        service="transporte"
      />,
    );
    expect(screen.getByTestId('supplier-critical-risks')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-risk-transporte')).toBeInTheDocument();
  });

  // [P0][VIDA-SAFETY] Hy3-audit 3c6aa66d-73fe-81d2-b565-f221e442632d
  // (reabierto 2026-08-24): el bug crítico es cuando el server top-N
  // filtra proveedores high pero la población completa tiene todos
  // high-risk. Sin rankingMeta, el componente no vería esa señal.
  it('alerta sistémica cuando rankingMeta.hasHighSystemicRisk=true pero el ranking muestra low', () => {
    // El ranking solo tiene el mejor (low) y un medium, pero el server
    // reporta que TODOS los proveedores de la población son high-risk
    // (uno fuera del top-N).
    render(
      <SupplierComparator
        ranking={[entry('s1', 1, 90, 'low', 0), entry('s2', 2, 60, 'medium', 1)]}
        rankingMeta={{
          totalEvaluated: 5,
          hasHighSystemicRisk: true,
          isSoleQualifiedSupplier: false,
        }}
        service="transporte"
      />,
    );
    expect(screen.getByTestId('supplier-critical-risks')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-risk-transporte')).toBeInTheDocument();
  });

  it('alerta sole-supplier cuando rankingMeta.isSoleQualifiedSupplier=true aunque el ranking tenga 1 entry low', () => {
    // Caso: el ranking muestra 1 entry (s1, low), pero la población real
    // tiene 1 solo proveedor (s1 mismo). El componente debe mostrar la
    // alerta de proveedor único, no de falla sistémica.
    render(
      <SupplierComparator
        ranking={[entry('s1', 1, 90, 'low', 0)]}
        rankingMeta={{
          totalEvaluated: 1,
          hasHighSystemicRisk: false,
          isSoleQualifiedSupplier: true,
        }}
        service="transporte"
      />,
    );
    expect(screen.getByTestId('supplier-critical-risks')).toBeInTheDocument();
    expect(screen.getByTestId('supplier-risk-transporte')).toBeInTheDocument();
  });

  it('NO alerta cuando rankingMeta.hasHighSystemicRisk=false (backward compat)', () => {
    // Sin rankingMeta y con ranking mixto (no todos high), NO debe alertar.
    render(
      <SupplierComparator
        ranking={[entry('s1', 1, 90, 'low', 0), entry('s2', 2, 30, 'high', 5)]}
        service="transporte"
      />,
    );
    expect(screen.queryByTestId('supplier-critical-risks')).not.toBeInTheDocument();
  });
});

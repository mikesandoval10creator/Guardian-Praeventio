// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SupplierComparator } from './SupplierComparator.js';
import type {
  Supplier,
  ServiceDeliveryEvent,
  SLATarget,
} from '../../services/suppliers/supplierQualityService.js';

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

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChurnRiskPanel } from './ChurnRiskPanel.js';
import type { TenantUsageSnapshot } from '../../services/adoption/adoptionAnalytics.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function snap(over: Partial<TenantUsageSnapshot> & { tenantId: string }): TenantUsageSnapshot {
  return {
    tenantId: over.tenantId,
    snapshotAt: '2026-05-11',
    daysSinceSignup: over.daysSinceSignup ?? 30,
    activeModules: over.activeModules ?? new Set(['projects', 'workers']),
    events30d: over.events30d ?? 50,
    activeWorkers: over.activeWorkers ?? 10,
    activeProjects: over.activeProjects ?? 1,
    hasPaidPlan: over.hasPaidPlan ?? true,
  };
}

describe('<ChurnRiskPanel />', () => {
  it('vacío muestra mensaje empty', () => {
    render(<ChurnRiskPanel snapshots={[]} />);
    expect(screen.getByTestId('churn-risk-panel')).toHaveTextContent(/No hay tenants/i);
  });

  it('ordena por severidad (critical primero)', () => {
    render(
      <ChurnRiskPanel
        snapshots={[
          snap({ tenantId: 'safe' }),
          snap({
            tenantId: 'critical',
            events30d: 0,
            activeModules: new Set(),
            activeProjects: 0,
            daysSinceSignup: 45,
          }),
        ]}
      />,
    );
    const items = screen.getAllByTestId(/^churn-item-/);
    expect(items[0].getAttribute('data-testid')).toContain('critical');
  });

  it('onTenantClick recibe tenantId', () => {
    const onClick = vi.fn();
    render(
      <ChurnRiskPanel
        snapshots={[snap({ tenantId: 'tx', events30d: 0, activeModules: new Set() })]}
        onTenantClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('churn-item-tx'));
    expect(onClick).toHaveBeenCalledWith('tx');
  });
});

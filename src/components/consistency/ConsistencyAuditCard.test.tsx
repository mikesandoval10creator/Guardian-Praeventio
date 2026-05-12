// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConsistencyAuditCard } from './ConsistencyAuditCard.js';
import type {
  Inconsistency,
  InconsistencySeverity,
} from '../../services/consistency/consistencyAuditor.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function inc(ruleId: string, severity: InconsistencySeverity, description = 'fail'): Inconsistency {
  return {
    ruleId,
    severity,
    category: 'test',
    description,
    involvedIds: [`${ruleId}-x`],
    suggestedAction: 'Revisar',
  };
}

describe('<ConsistencyAuditCard />', () => {
  it('empty state cuando no hay inconsistencias', () => {
    render(<ConsistencyAuditCard inconsistencies={[]} />);
    expect(screen.getByTestId('consistency-audit-card-empty')).toBeInTheDocument();
  });

  it('ordena críticas primero', () => {
    render(
      <ConsistencyAuditCard
        inconsistencies={[inc('info-1', 'info'), inc('crit-1', 'critical'), inc('warn-1', 'warning')]}
      />,
    );
    const items = screen.getAllByTestId(/^consistency-item-/);
    expect(items[0].getAttribute('data-testid')).toBe('consistency-item-crit-1');
    expect(items[1].getAttribute('data-testid')).toBe('consistency-item-warn-1');
    expect(items[2].getAttribute('data-testid')).toBe('consistency-item-info-1');
  });

  it('colapsa items sobre maxInline', () => {
    const items = Array.from({ length: 8 }, (_, i) => inc(`r-${i}`, 'warning'));
    render(<ConsistencyAuditCard inconsistencies={items} maxInline={3} />);
    expect(screen.getAllByTestId(/^consistency-item-/).length).toBe(3);
    expect(screen.getByTestId('consistency-hidden-count')).toHaveTextContent('5');
  });

  it('onResolve dispara con la inconsistencia', () => {
    const onResolve = vi.fn();
    render(
      <ConsistencyAuditCard inconsistencies={[inc('rule-x', 'critical')]} onResolve={onResolve} />,
    );
    fireEvent.click(screen.getByTestId('consistency-item-rule-x'));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0].ruleId).toBe('rule-x');
  });
});

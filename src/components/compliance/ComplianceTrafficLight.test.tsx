// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComplianceTrafficLight } from './ComplianceTrafficLight.js';
import type {
  ComplianceTrafficLightResult,
  CategoryStatus,
} from '../../services/compliance/trafficLightEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

function makeCategory(
  category: CategoryStatus['category'],
  light: 'green' | 'yellow' | 'red',
  summary = 'todo OK',
): CategoryStatus {
  return { category, light, summary, criticalItemIds: [], warningCount: 0 };
}

function makeResult(overall: 'green' | 'yellow' | 'red'): ComplianceTrafficLightResult {
  return {
    overall,
    score: overall === 'green' ? 92 : overall === 'yellow' ? 70 : 45,
    computedAt: '2026-05-11T10:00:00Z',
    byCategory: [
      makeCategory('legal', overall),
      makeCategory('documentation', 'green'),
      makeCategory('training', 'yellow', '2 capacitaciones vencidas'),
      makeCategory('epp', overall === 'red' ? 'red' : 'green'),
      makeCategory('emergencies', 'green'),
      makeCategory('occupational_health', 'green'),
      makeCategory('maintenance', 'green'),
      makeCategory('audits', 'green'),
    ],
  };
}

describe('<ComplianceTrafficLight />', () => {
  it('compact muestra score + estado', () => {
    render(<ComplianceTrafficLight result={makeResult('green')} variant="compact" />);
    expect(screen.getByTestId('compliance-traffic-light-compact')).toHaveTextContent('92/100');
  });

  it('full muestra grid 8 categorías', () => {
    render(<ComplianceTrafficLight result={makeResult('yellow')} variant="full" />);
    expect(screen.getByTestId('compliance-traffic-light-full')).toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
    expect(screen.getByText('Documentación')).toBeInTheDocument();
    expect(screen.getByText('Capacitación')).toBeInTheDocument();
    expect(screen.getByText('EPP')).toBeInTheDocument();
    expect(screen.getByText('Emergencias')).toBeInTheDocument();
  });

  it('onCategoryClick dispara con la categoría', () => {
    const onClick = vi.fn();
    render(<ComplianceTrafficLight result={makeResult('red')} variant="full" onCategoryClick={onClick} />);
    fireEvent.click(screen.getByText('Capacitación').closest('button')!);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].category).toBe('training');
  });

  it('sin onCategoryClick los botones están deshabilitados', () => {
    render(<ComplianceTrafficLight result={makeResult('green')} variant="full" />);
    const btn = screen.getByText('Legal').closest('button')!;
    expect(btn).toBeDisabled();
  });
});

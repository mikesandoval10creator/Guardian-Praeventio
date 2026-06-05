// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TopRisksWidget } from './TopRisksWidget.js';
import { WeakControlsWidget } from './WeakControlsWidget.js';
import type { ControlWeakness } from '../../services/riskRanking/riskRankingEngine.js';
import type { RankedRiskNode } from '../../services/riskRanking/riskNodeRanking.js';
import type { IperCriticidad } from '../../services/protocols/iperCriticidad.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function rankedRisk(
  id: string,
  iperScore: number,
  criticidad: IperCriticidad = 'Media',
  extras: Partial<RankedRiskNode> = {},
): RankedRiskNode {
  return {
    id,
    title: `Riesgo ${id}`,
    category: 'altura',
    probabilidad: 3,
    severidad: 3,
    iperScore,
    iperLevel: 'moderado',
    criticidad,
    ...extras,
  };
}

function weakness(
  controlId: string,
  label: string,
  failureRate: number,
  weaknessScore: number,
  isOverdueVerification = false,
): ControlWeakness {
  return { controlId, label, failureRate, isOverdueVerification, weaknessScore };
}

describe('<TopRisksWidget />', () => {
  it('muestra empty si no hay riesgos', () => {
    render(<TopRisksWidget risks={[]} />);
    expect(screen.getByTestId('top-risks-widget')).toBeInTheDocument();
    expect(screen.getByText(/Sin riesgos/i)).toBeInTheDocument();
  });

  it('renderiza en el orden rankeado por el server y respeta topN', () => {
    // El server ya rankea por IPER; el widget conserva el orden y corta a topN.
    const risks = [
      rankedRisk('crit-id', 25, 'Crítica'),
      rankedRisk('med-id', 9, 'Media'),
      rankedRisk('low-id', 1, 'Baja'),
    ];
    render(<TopRisksWidget risks={risks} topN={2} />);
    const items = screen.getAllByTestId(/^top-risk-/);
    expect(items).toHaveLength(2); // topN=2
    expect(items[0].getAttribute('data-testid')).toBe('top-risk-crit-id');
    expect(items[1].getAttribute('data-testid')).toBe('top-risk-med-id');
    // Muestra el score IPER.
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('onRiskClick dispara con id', () => {
    const onClick = vi.fn();
    render(
      <TopRisksWidget
        risks={[rankedRisk('r1', 16, 'Alta')]}
        topN={1}
        onRiskClick={onClick}
      />,
    );
    const btn = screen.getByTestId('top-risk-r1').querySelector('button')!;
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledWith('r1');
  });
});

describe('<WeakControlsWidget />', () => {
  it('empty state sin controles', () => {
    render(<WeakControlsWidget controls={[]} />);
    expect(screen.getByText(/Sin controles/i)).toBeInTheDocument();
  });

  it('renderiza en el orden rankeado por el server, respeta topN y muestra % de falla', () => {
    const controls = [
      weakness('c-weak', 'Control débil', 0.8, 80),
      weakness('c-mid', 'Control medio', 0.3, 30),
      weakness('c-strong', 'Control fuerte', 0, 0),
    ];
    render(<WeakControlsWidget controls={controls} topN={2} />);
    const items = screen.getAllByTestId(/^weak-control-/);
    expect(items).toHaveLength(2); // topN=2
    expect(items[0].getAttribute('data-testid')).toBe('weak-control-c-weak');
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('marca verificación vencida (isOverdueVerification)', () => {
    render(
      <WeakControlsWidget
        controls={[weakness('c-overdue', 'Sin verificar', 0, 80, true)]}
        topN={1}
      />,
    );
    expect(screen.getByLabelText(/vencida/i)).toBeInTheDocument();
  });

  it('onControlClick dispara con id', () => {
    const onClick = vi.fn();
    render(
      <WeakControlsWidget
        controls={[weakness('c1', 'Test', 0.5, 50)]}
        topN={1}
        onControlClick={onClick}
      />,
    );
    const btn = screen.getByTestId('weak-control-c1').querySelector('button')!;
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledWith('c1');
  });
});

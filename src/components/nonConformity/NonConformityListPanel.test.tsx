// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NonConformityListPanel } from './NonConformityListPanel.js';
import type {
  NonConformity,
  PatternBucket,
} from '../../services/nonConformity/nonConformityEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function nc(over: Partial<NonConformity> & { id: string }): NonConformity {
  return {
    id: over.id,
    source: over.source ?? 'audit',
    detectedAt: over.detectedAt ?? '2026-05-13T08:00:00Z',
    description: over.description ?? 'EPP no en uso en sector C',
    severity: over.severity ?? 'major',
    status: over.status ?? 'open',
    rootCauseKind: over.rootCauseKind,
    correctiveActionIds: over.correctiveActionIds,
  };
}

describe('<NonConformityListPanel />', () => {
  it('empty: mensaje sin NCs', () => {
    render(<NonConformityListPanel ncs={[]} />);
    expect(screen.getByTestId('nc-empty')).toBeInTheDocument();
    expect(screen.getByTestId('nc-count')).toHaveTextContent('0 total');
  });

  it('lista NCs con data-status y data-severity', () => {
    render(
      <NonConformityListPanel
        ncs={[
          nc({ id: 'n1', severity: 'critical', status: 'open' }),
          nc({ id: 'n2', severity: 'minor', status: 'closed' }),
        ]}
      />,
    );
    expect(screen.getByTestId('nc-item-n1')).toHaveAttribute('data-status', 'open');
    expect(screen.getByTestId('nc-item-n1')).toHaveAttribute('data-severity', 'critical');
    expect(screen.getByTestId('nc-item-n2')).toHaveAttribute('data-status', 'closed');
  });

  it('sort: critical > major > minor; dentro mismo severity open > closed', () => {
    render(
      <NonConformityListPanel
        ncs={[
          nc({ id: 'minor-closed', severity: 'minor', status: 'closed' }),
          nc({ id: 'critical-open', severity: 'critical', status: 'open' }),
          nc({ id: 'major-investigating', severity: 'major', status: 'investigating' }),
        ]}
      />,
    );
    const list = screen.getByTestId('nc-list');
    const lis = list.querySelectorAll('li');
    expect(lis[0]).toHaveAttribute('data-testid', 'nc-item-critical-open');
    expect(lis[1]).toHaveAttribute('data-testid', 'nc-item-major-investigating');
    expect(lis[2]).toHaveAttribute('data-testid', 'nc-item-minor-closed');
  });

  it('nextActionLabel: open → "Investigar"', () => {
    render(
      <NonConformityListPanel
        ncs={[nc({ id: 'n1', status: 'open' })]}
        onAdvance={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nc-advance-n1')).toHaveTextContent('Investigar');
  });

  it('nextActionLabel: investigating → "Plan de acción"', () => {
    render(
      <NonConformityListPanel
        ncs={[nc({ id: 'n1', status: 'investigating' })]}
        onAdvance={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nc-advance-n1')).toHaveTextContent('Plan de acción');
  });

  it('nextActionLabel: closed → "Revisar eficacia"', () => {
    render(
      <NonConformityListPanel
        ncs={[nc({ id: 'n1', status: 'closed' })]}
        onAdvance={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nc-advance-n1')).toHaveTextContent('Revisar eficacia');
  });

  it('efficacy_reviewed: NO botón de avance', () => {
    render(
      <NonConformityListPanel
        ncs={[nc({ id: 'n1', status: 'efficacy_reviewed' })]}
        onAdvance={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('nc-advance-n1')).toBeNull();
  });

  it('onAdvance dispara con la NC', () => {
    const onAdvance = vi.fn();
    render(
      <NonConformityListPanel
        ncs={[nc({ id: 'n1', status: 'open' })]}
        onAdvance={onAdvance}
      />,
    );
    fireEvent.click(screen.getByTestId('nc-advance-n1'));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance.mock.calls[0][0].id).toBe('n1');
  });

  it('rootCauseKind se renderiza cuando presente', () => {
    render(
      <NonConformityListPanel
        ncs={[nc({ id: 'n1', rootCauseKind: 'falla_procedimiento' })]}
      />,
    );
    expect(screen.getByTestId('nc-item-n1')).toHaveTextContent(
      'Causa: falla_procedimiento',
    );
  });

  it('correctiveActionIds count visible', () => {
    render(
      <NonConformityListPanel
        ncs={[nc({ id: 'n1', correctiveActionIds: ['a1', 'a2', 'a3'] })]}
      />,
    );
    expect(screen.getByTestId('nc-item-n1')).toHaveTextContent(/3 acción/);
  });

  it('patterns: bucket clickable dispara onPatternClick', () => {
    const onClick = vi.fn();
    const buckets: PatternBucket[] = [
      {
        rootCauseKind: 'falla_capacitacion',
        count: 5,
        ncIds: ['a', 'b', 'c', 'd', 'e'],
        severityIndex: 1.8,
      },
    ];
    render(
      <NonConformityListPanel
        ncs={[]}
        patterns={buckets}
        onPatternClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('nc-pattern-falla_capacitacion'));
    expect(onClick).toHaveBeenCalledWith(buckets[0]);
  });

  it('patterns: sin buckets → sección oculta', () => {
    render(<NonConformityListPanel ncs={[nc({ id: 'n1' })]} />);
    expect(screen.queryByTestId('nc-patterns')).toBeNull();
  });

  it('source labels: 6 fuentes mapeadas correctamente', () => {
    render(
      <NonConformityListPanel
        ncs={[
          nc({ id: 'a', source: 'audit' }),
          nc({ id: 'b', source: 'inspection' }),
          nc({ id: 'c', source: 'incident' }),
          nc({ id: 'd', source: 'self_report' }),
          nc({ id: 'e', source: 'external_audit' }),
          nc({ id: 'f', source: 'client_complaint' }),
        ]}
      />,
    );
    expect(screen.getByTestId('nc-item-a')).toHaveTextContent('Auditoría');
    expect(screen.getByTestId('nc-item-b')).toHaveTextContent('Inspección');
    expect(screen.getByTestId('nc-item-c')).toHaveTextContent('Incidente');
    expect(screen.getByTestId('nc-item-d')).toHaveTextContent('Auto-reporte');
    expect(screen.getByTestId('nc-item-e')).toHaveTextContent('Audit. externa');
    expect(screen.getByTestId('nc-item-f')).toHaveTextContent('Reclamo cliente');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RaciHealthCard } from './RaciHealthCard.js';
import type { RaciMatrix } from '../../services/raciMatrix/raciMatrixEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function makeMatrix(over: Partial<RaciMatrix> & { taskId: string; taskTitle: string }): RaciMatrix {
  return {
    taskId: over.taskId,
    taskTitle: over.taskTitle,
    critical: over.critical,
    assignments: over.assignments ?? [],
    valid: over.valid ?? true,
    violations: over.violations ?? [],
  };
}

describe('<RaciHealthCard />', () => {
  it('todo saludable: muestra badge "Saludable" + sin lista de inválidas', () => {
    render(
      <RaciHealthCard
        summary={{
          totalMatrices: 3,
          validMatrices: 3,
          criticalGapCount: 0,
          overloadedUids: [],
        }}
        matrices={[
          makeMatrix({ taskId: 't1', taskTitle: 'Inspección eléctrica' }),
        ]}
      />,
    );
    expect(screen.getByTestId('raci-all-healthy')).toBeInTheDocument();
    expect(screen.queryByTestId('raci-invalid-list')).toBeNull();
    expect(screen.getByTestId('raci-no-invalid')).toBeInTheDocument();
  });

  it('tiles muestran números correctos', () => {
    render(
      <RaciHealthCard
        summary={{
          totalMatrices: 10,
          validMatrices: 7,
          criticalGapCount: 2,
          overloadedUids: ['u1', 'u2'],
        }}
        matrices={[]}
      />,
    );
    expect(screen.getByTestId('raci-tile-total')).toHaveTextContent('10');
    expect(screen.getByTestId('raci-tile-valid')).toHaveTextContent('7');
    expect(screen.getByTestId('raci-tile-gaps')).toHaveTextContent('2');
    expect(screen.getByTestId('raci-tile-overloaded')).toHaveTextContent('2');
  });

  it('overloaded uids: badges visibles con name lookup', () => {
    render(
      <RaciHealthCard
        summary={{
          totalMatrices: 5,
          validMatrices: 4,
          criticalGapCount: 0,
          overloadedUids: ['uid-juan', 'uid-maria'],
        }}
        matrices={[]}
        uidNameLookup={{ 'uid-juan': 'Juan Pérez', 'uid-maria': 'María Soto' }}
      />,
    );
    const list = screen.getByTestId('raci-overloaded-list');
    expect(list).toHaveTextContent('Juan Pérez');
    expect(list).toHaveTextContent('María Soto');
  });

  it('matrices inválidas: muestra violations con label legible', () => {
    render(
      <RaciHealthCard
        summary={{
          totalMatrices: 1,
          validMatrices: 0,
          criticalGapCount: 1,
          overloadedUids: [],
        }}
        matrices={[
          makeMatrix({
            taskId: 't-fail',
            taskTitle: 'Trabajo en altura',
            critical: true,
            valid: false,
            violations: [
              { kind: 'no_accountable', detail: 'Falta accountable' },
              { kind: 'consulted_missing_for_critical', detail: 'Sin consulted' },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByTestId('raci-invalid-t-fail')).toBeInTheDocument();
    expect(screen.getByTestId('raci-violation-t-fail-no_accountable')).toHaveTextContent(
      /Sin Accountable/,
    );
    expect(
      screen.getByTestId('raci-violation-t-fail-consulted_missing_for_critical'),
    ).toBeInTheDocument();
  });

  it('botón Revisar dispara callback con la matrix completa', () => {
    const onReview = vi.fn();
    const matrix = makeMatrix({
      taskId: 't-bad',
      taskTitle: 'Permiso de fuego',
      valid: false,
      violations: [{ kind: 'no_responsible', detail: 'Vacío' }],
    });
    render(
      <RaciHealthCard
        summary={{
          totalMatrices: 1,
          validMatrices: 0,
          criticalGapCount: 0,
          overloadedUids: [],
        }}
        matrices={[matrix]}
        onReviewMatrix={onReview}
      />,
    );
    fireEvent.click(screen.getByTestId('raci-review-t-bad'));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onReview.mock.calls[0][0].taskId).toBe('t-bad');
  });

  it('sin callback onReviewMatrix: no se renderiza el botón', () => {
    render(
      <RaciHealthCard
        summary={{
          totalMatrices: 1,
          validMatrices: 0,
          criticalGapCount: 0,
          overloadedUids: [],
        }}
        matrices={[
          makeMatrix({
            taskId: 't1',
            taskTitle: 'T1',
            valid: false,
            violations: [{ kind: 'no_accountable', detail: 'd' }],
          }),
        ]}
      />,
    );
    expect(screen.queryByTestId('raci-review-t1')).toBeNull();
  });

  it('matrices válidas no aparecen en la lista de inválidas', () => {
    render(
      <RaciHealthCard
        summary={{
          totalMatrices: 2,
          validMatrices: 1,
          criticalGapCount: 0,
          overloadedUids: [],
        }}
        matrices={[
          makeMatrix({ taskId: 'good', taskTitle: 'OK', valid: true }),
          makeMatrix({
            taskId: 'bad',
            taskTitle: 'Falta',
            valid: false,
            violations: [{ kind: 'no_accountable', detail: 'd' }],
          }),
        ]}
      />,
    );
    expect(screen.queryByTestId('raci-invalid-good')).toBeNull();
    expect(screen.getByTestId('raci-invalid-bad')).toBeInTheDocument();
  });
});

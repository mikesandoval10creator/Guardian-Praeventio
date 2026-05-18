// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskMatrix5x5, severityForCell, type RiskMatrixNode } from './RiskMatrix5x5.js';

// Recharts depende de ResizeObserver — mock requerido en jsdom.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.ResizeObserver = ResizeObserverMock;

function node(over: Partial<RiskMatrixNode> = {}): RiskMatrixNode {
  return {
    id: 'r1',
    label: 'Riesgo X',
    probability: 3,
    impact: 3,
    kind: 'risk',
    ...over,
  };
}

describe('severityForCell — ISO 31000 calibration', () => {
  it('1Ã—1=1 â†’ low', () => expect(severityForCell(1, 1)).toBe('low'));
  it('2Ã—2=4 â†’ low (límite)', () => expect(severityForCell(2, 2)).toBe('low'));
  it('3Ã—2=6 â†’ medium', () => expect(severityForCell(3, 2)).toBe('medium'));
  it('3Ã—3=9 â†’ medium (límite)', () => expect(severityForCell(3, 3)).toBe('medium'));
  it('3Ã—4=12 â†’ high', () => expect(severityForCell(3, 4)).toBe('high'));
  it('3Ã—5=15 â†’ high (límite)', () => expect(severityForCell(3, 5)).toBe('high'));
  it('4Ã—4=16 â†’ extreme', () => expect(severityForCell(4, 4)).toBe('extreme'));
  it('5Ã—5=25 â†’ extreme', () => expect(severityForCell(5, 5)).toBe('extreme'));
});

describe('RiskMatrix5x5 component', () => {
  it('renderiza header, count y footer', () => {
    render(
      <RiskMatrix5x5
        nodes={[
          node({ id: 'a', probability: 5, impact: 5, label: 'SIF potencial' }),
          node({ id: 'b', probability: 1, impact: 1, label: 'Riesgo trivial' }),
        ]}
      />,
    );
    expect(screen.getByTestId('risk-matrix.title')).toHaveTextContent(/ISO 31000/i);
    expect(screen.getByTestId('risk-matrix.count')).toHaveTextContent('2 elementos');
    expect(screen.getByTestId('risk-matrix.footer')).toBeInTheDocument();
  });

  it('cuenta 0 elementos con lista vacía', () => {
    render(<RiskMatrix5x5 nodes={[]} />);
    expect(screen.getByTestId('risk-matrix.count')).toHaveTextContent('0 elementos');
  });

  it('soporta appearance dark', () => {
    render(<RiskMatrix5x5 nodes={[node()]} appearance="dark" />);
    const root = screen.getByTestId('risk-matrix');
    expect(root.className).toMatch(/bg-slate-800/);
  });
});

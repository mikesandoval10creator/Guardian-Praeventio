// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequirementGatePanel } from './RequirementGatePanel.js';
import type { GateDecision } from '../../services/softBlocking/requirementGate.js';

const passDecision: GateDecision = {
  level: 'pass',
  unsatisfied: [],
  reasoningText: 'ok',
  canOverride: false,
};

const softBlockDecision: GateDecision = {
  level: 'soft_block',
  unsatisfied: [
    {
      requirement: {
        id: 'req-1',
        kind: 'training',
        label: 'Curso altura',
        isMandatory: true,
        citation: 'DS 132 art 5',
      },
      status: 'expired',
    },
  ],
  reasoningText: '...',
  canOverride: true,
};

describe('<RequirementGatePanel />', () => {
  it('renderiza estado pass', () => {
    render(<RequirementGatePanel decision={passDecision} />);
    expect(screen.getByTestId('softBlocking.panel')).toBeInTheDocument();
    expect(screen.getByTestId('softBlocking.levelLabel').textContent).toMatch(/cumplidos/i);
  });

  it('lista requisitos pendientes en soft_block', () => {
    render(<RequirementGatePanel decision={softBlockDecision} />);
    expect(screen.getByTestId('softBlocking.unsatisfiedList')).toBeInTheDocument();
    expect(screen.getByTestId('softBlocking.unsatisfied.req-1')).toBeInTheDocument();
  });

  it('dispara onRequestOverride cuando canOverride', () => {
    const handler = vi.fn();
    render(
      <RequirementGatePanel
        decision={softBlockDecision}
        onRequestOverride={handler}
      />,
    );
    fireEvent.click(screen.getByTestId('softBlocking.overrideBtn'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

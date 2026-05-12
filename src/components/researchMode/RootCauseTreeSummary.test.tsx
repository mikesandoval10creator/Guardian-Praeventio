// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RootCauseTreeSummary } from './RootCauseTreeSummary.js';
import type { RootCauseTree } from '../../services/researchMode/researchMode.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const tree: RootCauseTree = {
  incidentId: 'inc-1',
  nodes: [
    {
      id: 'n1',
      text: 'Caída desde altura',
      category: 'people',
      isRoot: false,
      proposedByUid: 'u1',
    },
    {
      id: 'n2',
      text: 'No usó arnés',
      category: 'people',
      isRoot: false,
      parentId: 'n1',
      proposedByUid: 'u1',
    },
    {
      id: 'n3',
      text: 'Supervisión insuficiente',
      category: 'management',
      isRoot: true,
      parentId: 'n2',
      proposedByUid: 'u1',
      failedControlId: 'control-supervision-altura',
    },
  ],
};

describe('<RootCauseTreeSummary />', () => {
  it('renderiza summary 3 stats', () => {
    render(<RootCauseTreeSummary tree={tree} />);
    expect(screen.getByTestId('rct-summary-inc-1')).toBeInTheDocument();
    expect(screen.getByTestId('rct-total').textContent).toMatch(/3/);
    expect(screen.getByTestId('rct-roots').textContent).toMatch(/1/);
  });

  it('renderiza categorías', () => {
    render(<RootCauseTreeSummary tree={tree} />);
    expect(screen.getByTestId('rct-cat-people')).toBeInTheDocument();
    expect(screen.getByTestId('rct-cat-management')).toBeInTheDocument();
  });

  it('lista controles fallidos identificados', () => {
    render(<RootCauseTreeSummary tree={tree} />);
    expect(screen.getByTestId('rct-failed-controls')).toBeInTheDocument();
    expect(screen.getByTestId('rct-failed-0')).toBeInTheDocument();
  });

  it('sin controles fallidos cuando no hay', () => {
    const clean: RootCauseTree = {
      incidentId: 'inc-2',
      nodes: [
        { id: 'a', text: 'x', category: 'process', isRoot: true, proposedByUid: 'u1' },
      ],
    };
    render(<RootCauseTreeSummary tree={clean} />);
    expect(screen.queryByTestId('rct-failed-controls')).toBeNull();
  });
});

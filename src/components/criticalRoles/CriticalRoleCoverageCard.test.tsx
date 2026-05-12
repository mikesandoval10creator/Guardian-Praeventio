// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CriticalRoleCoverageCard } from './CriticalRoleCoverageCard.js';
import type {
  CriticalRoleDefinition,
  WorkerProfile,
} from '../../services/criticalRoles/criticalRolesMap.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const role: CriticalRoleDefinition = {
  code: 'rigger',
  label: 'Rigger certificado',
  industries: ['mining'],
  minimumAuthorized: 2,
  requiredTrainings: ['rigger_curso'],
  requiredDocuments: ['certificacion_rigger'],
  blocksTaskCategories: ['izaje'],
};

function w(
  uid: string,
  trainings: string[] = [],
  docs: string[] = [],
  inProgress: string[] = [],
): WorkerProfile {
  return {
    uid,
    fullName: `Worker ${uid}`,
    isActive: true,
    activeTrainings: trainings,
    activeDocuments: docs,
    trainingsInProgress: inProgress,
  };
}

describe('<CriticalRoleCoverageCard />', () => {
  it('renderiza 3 contadores', () => {
    const workers = [
      w('1', ['rigger_curso'], ['certificacion_rigger']),
      w('2', ['rigger_curso'], ['certificacion_rigger']),
      w('3', ['rigger_curso']),
      w('4', [], [], ['rigger_curso']),
    ];
    render(<CriticalRoleCoverageCard role={role} workers={workers} />);
    expect(screen.getByTestId('role-coverage-rigger')).toBeInTheDocument();
    expect(screen.getByTestId('role-titulars-rigger').textContent).toMatch(/2/);
    expect(screen.getByTestId('role-substitutes-rigger').textContent).toMatch(/1/);
    expect(screen.getByTestId('role-in-training-rigger').textContent).toMatch(/1/);
  });

  it('marca fragile si <= minimumAuthorized', () => {
    const workers = [w('1', ['rigger_curso'], ['certificacion_rigger'])];
    render(<CriticalRoleCoverageCard role={role} workers={workers} />);
    expect(screen.getByTestId('role-fragile-rigger')).toBeInTheDocument();
  });

  it('no fragile si bus factor > 0', () => {
    const workers = [
      w('1', ['rigger_curso'], ['certificacion_rigger']),
      w('2', ['rigger_curso'], ['certificacion_rigger']),
      w('3', ['rigger_curso'], ['certificacion_rigger']),
    ];
    render(<CriticalRoleCoverageCard role={role} workers={workers} />);
    expect(screen.queryByTestId('role-fragile-rigger')).toBeNull();
  });
});

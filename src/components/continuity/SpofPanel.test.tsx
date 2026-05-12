// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpofPanel } from './SpofPanel.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<SpofPanel />', () => {
  it('empty si no hay SPOFs', () => {
    render(
      <SpofPanel
        input={{
          uniqueSkillHolders: [],
          equipmentWithoutBackup: [],
          soleSuppliers: [],
          unbackedCriticalDocs: [],
        }}
      />,
    );
    expect(screen.getByTestId('spof-empty')).toBeInTheDocument();
  });

  it('renderiza SPOFs detectados de las 4 dimensiones', () => {
    render(
      <SpofPanel
        input={{
          uniqueSkillHolders: [{ uid: 'w1', skill: 'rescate', dependentTasks: ['t1'] }],
          equipmentWithoutBackup: [{ id: 'eq1', label: 'Grúa', dependentTasks: ['t2'] }],
          soleSuppliers: [{ supplierId: 's1', service: 'calibración' }],
          unbackedCriticalDocs: [{ docId: 'd1', title: 'Permiso ambiental' }],
        }}
      />,
    );
    expect(screen.getByTestId('spof-person-w1')).toBeInTheDocument();
    expect(screen.getByTestId('spof-equipment-eq1')).toBeInTheDocument();
    expect(screen.getByTestId('spof-supplier-s1')).toBeInTheDocument();
    expect(screen.getByTestId('spof-document-d1')).toBeInTheDocument();
  });

  it('onMitigateClick recibe kind + id', () => {
    const onClick = vi.fn();
    render(
      <SpofPanel
        input={{
          uniqueSkillHolders: [{ uid: 'w1', skill: 'rescate', dependentTasks: [] }],
          equipmentWithoutBackup: [],
          soleSuppliers: [],
          unbackedCriticalDocs: [],
        }}
        onMitigateClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('spof-mitigate-person-w1'));
    expect(onClick).toHaveBeenCalledWith('person', 'w1');
  });
});

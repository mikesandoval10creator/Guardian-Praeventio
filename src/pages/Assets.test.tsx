// @vitest-environment jsdom
//
// Phase 5 "make real" — verifies Assets surfaces the previously-orphaned
// EquipmentAdminPanel via a tab (it had NO import → was unreachable). The heavy
// children are mocked to sentinels so this test pins the WIRING (import + tab
// switch + conditional render), not their internals.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

let selected: { id: string; name: string } | null = { id: 'proj-1', name: 'Faena Norte' };

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: selected }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

vi.mock('../components/projects/MaquinariaManager', () => ({
  MaquinariaManager: ({ projectId }: { projectId: string }) => (
    <div data-testid="maquinaria">MAQUINARIA::{projectId}</div>
  ),
}));

vi.mock('../components/equipment/EquipmentAdminPanel', () => ({
  EquipmentAdminPanel: ({ projectId }: { projectId: string }) => (
    <div data-testid="equipos">EQUIPOS::{projectId}</div>
  ),
}));

import { Assets } from './Assets';

beforeEach(() => {
  cleanup();
  selected = { id: 'proj-1', name: 'Faena Norte' };
});

describe('<Assets /> — orphan EquipmentAdminPanel wiring', () => {
  it('renders both Maquinaria and Equipos tabs', () => {
    render(<Assets />);
    expect(screen.getByRole('button', { name: /Maquinaria/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Equipos/i })).toBeTruthy();
  });

  it('defaults to Maquinaria; switching to Equipos mounts EquipmentAdminPanel', () => {
    render(<Assets />);
    // Default tab.
    expect(screen.getByTestId('maquinaria').textContent).toContain('proj-1');
    expect(screen.queryByTestId('equipos')).toBeNull();
    // Switch tabs → the orphan is now reachable and receives the projectId.
    fireEvent.click(screen.getByRole('button', { name: /Equipos/i }));
    expect(screen.getByTestId('equipos').textContent).toContain('proj-1');
    expect(screen.queryByTestId('maquinaria')).toBeNull();
  });

  it('shows the select-a-project empty state when no project is selected', () => {
    selected = null;
    render(<Assets />);
    expect(screen.queryByRole('button', { name: /Equipos/i })).toBeNull();
    expect(screen.getByText(/Selecciona un Proyecto/i)).toBeTruthy();
  });
});

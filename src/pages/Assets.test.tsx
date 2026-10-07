// @vitest-environment jsdom
//
// Phase 5 "make real" — verifies Assets surfaces the previously-orphaned
// EquipmentAdminPanel via a tab (it had NO import → was unreachable). The heavy
// children are mocked to sentinels so this test pins the WIRING (import + tab
// switch + conditional render), not their internals.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

let selected: { id: string; name: string } | null = { id: 'proj-1', name: 'Faena Norte' };

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: selected }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: { children: ReactNode }) => <div>{children}</div> },
}));

vi.mock('../hooks/useEquipment', () => ({
  useEquipment: () => ({ data: { equipment: [] }, loading: false, error: null, refetch: () => {} }),
}));

vi.mock('../components/equipment/EquipmentQRScannerEntry', () => ({
  EquipmentQRScannerEntry: ({ projectId }: { projectId: string }) => (
    <div data-testid="equipment-qr-scanner-entry" data-project-id={projectId} />
  ),
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
  it('renders Maquinaria, Equipos and Inspección QR tabs', () => {
    render(<Assets />);
    expect(screen.getByRole('button', { name: /Maquinaria/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Equipos/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Inspección QR/i })).toBeTruthy();
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

  it('mounts the QR inspection entry with the selected project', () => {
    render(<Assets />);
    fireEvent.click(screen.getByRole('button', { name: /Inspección QR/i }));
    expect(screen.getByTestId('equipment-qr-scanner-entry').getAttribute('data-project-id')).toBe(
      'proj-1',
    );
  });

  it('shows the select-a-project empty state when no project is selected', () => {
    selected = null;
    render(<Assets />);
    expect(screen.queryByRole('button', { name: /Equipos/i })).toBeNull();
    expect(screen.getByText(/Selecciona un Proyecto/i)).toBeTruthy();
  });
});

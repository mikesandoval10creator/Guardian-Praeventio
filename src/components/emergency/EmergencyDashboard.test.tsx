// @vitest-environment jsdom
//
// [P0][VIDA] The emergency banner used to carry three controls that lied.
//
//  - "Solicitar Apoyo Externo" and a phone icon button had NO onClick at all.
//    They animated on press (active:scale-95) and the icon one announced itself
//    to screen readers as "Llamar a contacto de emergencia". A worker pressing
//    them in an emergency got silence.
//  - "Desconexión LOTO" opened a dialog promising it "desconectará remotamente
//    toda la maquinaria crítica"; its onConfirm only ran setLotoActivated(true)
//    — no write, no endpoint, no audit — and the button then read "LOTO Activo".
//    A supervisor could believe the machinery was locked out and send someone in.
//
// Praeventio recommends and records; it does not actuate equipment. These tests
// pin that the controls do what they say and that the old claims never return.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'p1', name: 'Faena', country: 'CL' } }),
}));
vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u1' }, userRole: 'admin', isAdmin: true }),
}));
vi.mock('../../hooks/useBluetoothMesh', () => ({
  useBluetoothMesh: () => ({
    isSupported: false, isScanning: false, nearbyDevices: [], startScanning: vi.fn(),
  }),
}));
// Firestore subscriptions are irrelevant here: no-op unsubscribes keep the
// component mounted without touching the network.
vi.mock('../../services/firebase', () => ({
  db: {},
  collection: vi.fn(),
  doc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(() => () => undefined),
  handleFirestoreError: vi.fn(),
  OperationType: { LIST: 'list' },
}));
// Heavy children are out of scope for this suite.
vi.mock('./EmergencyCheckIn', () => ({ EmergencyCheckIn: () => null }));
vi.mock('./CrisisChat', () => ({ CrisisChat: () => null }));
vi.mock('./DynamicEvacuationMap', () => ({ DynamicEvacuationMap: () => null }));
vi.mock('./FirstAidCards', () => ({ FirstAidCards: () => null }));
vi.mock('./EmergencySquadManager', () => ({ EmergencySquadManager: () => null }));
vi.mock('./TacticalSimulation3D', () => ({ TacticalSimulation3D: () => null }));

import { EmergencyDashboard } from './EmergencyDashboard';

beforeEach(() => {
  cleanup();
  mockNavigate.mockClear();
});

describe('EmergencyDashboard — controls must do what they say', () => {
  it('opens the authority numbers when external support is requested', () => {
    render(<EmergencyDashboard />);
    expect(screen.queryByTestId('emergency-authority-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('request-external-support'));

    // Real, country-aware numbers as tel: links — never an auto-dial.
    expect(screen.getByTestId('emergency-authority-panel')).toBeInTheDocument();
    expect(
      screen.getByText(/la aplicación no avisa a las autoridades por su cuenta/i),
    ).toBeInTheDocument();
  });

  it('hands LOTO off to the real registry instead of faking a lockout', () => {
    render(<EmergencyDashboard />);
    fireEvent.click(screen.getByTestId('open-loto-registry'));

    // The dialog must describe recording + follow-up, never remote actuation.
    const dialogText = document.body.textContent ?? '';
    expect(dialogText).toMatch(/registro/i);
    expect(dialogText).not.toMatch(/desconectar[áa] remotamente/i);

    fireEvent.click(screen.getByRole('button', { name: /abrir registro loto/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/loto');
  });

  it('never claims the machinery is locked out', () => {
    render(<EmergencyDashboard />);
    fireEvent.click(screen.getByTestId('open-loto-registry'));
    fireEvent.click(screen.getByRole('button', { name: /abrir registro loto/i }));

    // The old code flipped a local boolean and rendered "LOTO Activo" while
    // nothing was locked out anywhere.
    expect(document.body.textContent ?? '').not.toMatch(/LOTO Activo/i);
  });
});

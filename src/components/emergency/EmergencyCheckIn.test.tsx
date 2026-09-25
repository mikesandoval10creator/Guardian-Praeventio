// @vitest-environment jsdom

import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFirebaseState = vi.hoisted(() => ({
  user: { uid: 'u1', displayName: 'Worker One' },
  userRole: 'operario',
  isAdmin: false,
}));
const mockWhere = vi.hoisted(() => vi.fn());
const mockSetDoc = vi.hoisted(() => vi.fn());
const mockSubmitEmergencyDelivery = vi.hoisted(() => vi.fn());
const mockRandomId = vi.hoisted(() => vi.fn(() => 'event-1'));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => mockFirebaseState,
}));
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'p1' } }),
}));
vi.mock('../../services/firebase', () => ({
  db: {},
  collection: vi.fn(),
  query: vi.fn(),
  where: mockWhere,
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(() => () => undefined),
  doc: vi.fn(),
  setDoc: mockSetDoc,
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => ({ serverTimestamp: true })),
  handleFirestoreError: vi.fn(),
  OperationType: { LIST: 'list', CREATE: 'create', UPDATE: 'update' },
}));

vi.mock('../../services/emergency/emergencyDeliveryOutbox', () => ({
  submitEmergencyDelivery: mockSubmitEmergencyDelivery,
}));
vi.mock('../../utils/randomId', () => ({ randomId: mockRandomId }));

import { EmergencyCheckIn } from './EmergencyCheckIn';

afterEach(() => cleanup());

beforeEach(() => {
  mockWhere.mockClear();
  mockSetDoc.mockClear();
  mockSubmitEmergencyDelivery.mockReset();
  mockSubmitEmergencyDelivery.mockResolvedValue({
    clientEventId: 'event-1',
    operation: 'activation',
    projectId: 'p1',
    status: 'pending',
    queued: true,
  });
  mockFirebaseState.userRole = 'operario';
  mockFirebaseState.isAdmin = false;
});

describe('EmergencyCheckIn — headcount privacy', () => {
  it.each(['worker', 'operario', 'topografo'])('queries only the caller for %s', (role) => {
    mockFirebaseState.userRole = role;
    render(<EmergencyCheckIn />);

    expect(mockWhere).toHaveBeenCalledWith('workerId', '==', 'u1');
    expect(screen.queryByRole('button', { name: /declarar emergencia/i })).not.toBeInTheDocument();
  });

  it('keeps the full headcount query for a supervisor', () => {
    mockFirebaseState.userRole = 'supervisor';
    render(<EmergencyCheckIn />);

    expect(mockWhere).not.toHaveBeenCalledWith('workerId', '==', 'u1');
    expect(screen.getByRole('button', { name: /declarar emergencia/i })).toBeInTheDocument();
  });

  it('routes supervisor lifecycle toggles through the durable delivery outbox', async () => {
    mockFirebaseState.userRole = 'supervisor';
    render(<EmergencyCheckIn />);

    fireEvent.click(screen.getByRole('button', { name: /declarar emergencia/i }));

    await waitFor(() => expect(mockSubmitEmergencyDelivery).toHaveBeenCalledOnce());
    expect(mockSubmitEmergencyDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'activation',
        projectId: 'p1',
        emergencyType: 'manual_checkin',
      }),
      { clientEventId: 'emergency-activation-event-1' },
    );
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

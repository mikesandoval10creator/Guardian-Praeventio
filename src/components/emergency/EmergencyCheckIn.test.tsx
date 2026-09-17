// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFirebaseState = vi.hoisted(() => ({
  user: { uid: 'u1', displayName: 'Worker One' },
  userRole: 'operario',
  isAdmin: false,
}));
const mockWhere = vi.hoisted(() => vi.fn());

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
  setDoc: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => ({ serverTimestamp: true })),
  handleFirestoreError: vi.fn(),
  OperationType: { LIST: 'list', CREATE: 'create', UPDATE: 'update' },
}));

import { EmergencyCheckIn } from './EmergencyCheckIn';

afterEach(() => cleanup());

beforeEach(() => {
  mockWhere.mockClear();
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
});

// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.1 — AccessControlModal smoke tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const updateDocMock = vi.fn(async () => undefined);

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ __mock: 'docRef' })),
  updateDoc: (...args: any[]) => updateDocMock(...(args as [])),
}));

vi.mock('../../services/firebase', () => ({ db: {} }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('../shared/ToastContainer', () => ({ ToastContainer: () => null }));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { AccessControlModal } from './AccessControlModal';

const worker: any = {
  id: 'w-1',
  name: 'Ana Soto',
  medicalClearanceDate: '2026-01-01',
  certifications: ['Altura', 'Espacio Confinado'],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccessControlModal', () => {
  it('renders nothing when worker is null', () => {
    const { container } = render(
      <AccessControlModal
        isOpen={true}
        onClose={() => {}}
        worker={null}
        projectId="p-1"
      />,
    );
    expect(container.querySelector('input')).toBeNull();
  });

  it('renders the form prefilled with worker data', () => {
    render(
      <AccessControlModal
        isOpen={true}
        onClose={() => {}}
        worker={worker}
        projectId="p-1"
      />,
    );
    expect(screen.getByDisplayValue('2026-01-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Altura, Espacio Confinado/)).toBeInTheDocument();
  });

  it('calls updateDoc when save is clicked', async () => {
    render(
      <AccessControlModal
        isOpen={true}
        onClose={() => {}}
        worker={worker}
        projectId="p-1"
      />,
    );
    const saveBtn = screen.getByRole('button', { name: /guardar|save/i });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1));
  });
});

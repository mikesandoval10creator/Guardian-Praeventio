// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.1 — MassImportModal smoke tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const addNodeMock = vi.fn(async () => ({ id: 'node-1' }));
const addDocMock = vi.fn(async () => ({ id: 'doc-1' }));

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ addNode: addNodeMock }),
}));

vi.mock('../../services/firebase', () => ({
  db: {},
  collection: vi.fn(),
  addDoc: (...args: any[]) => addDocMock(...(args as [])),
  handleFirestoreError: vi.fn(),
  OperationType: { CREATE: 'create' },
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { MassImportModal } from './MassImportModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MassImportModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <MassImportModal isOpen={false} onClose={() => {}} projectId="p-1" />,
    );
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('renders the CSV input area when open', () => {
    render(<MassImportModal isOpen={true} onClose={() => {}} projectId="p-1" />);
    expect(document.querySelector('textarea')).toBeTruthy();
  });

  it('imports CSV rows by calling addNode for each data line', async () => {
    render(<MassImportModal isOpen={true} onClose={() => {}} projectId="p-1" />);
    const textarea = document.querySelector('textarea')!;
    fireEvent.change(textarea, {
      target: {
        value: 'nombre,cargo,email\nAna,Soldador,ana@x.com\nLuis,Operador,luis@x.com',
      },
    });
    const btn = screen.getByText(/Iniciar Importación/i);
    fireEvent.click(btn);
    await waitFor(() => expect(addNodeMock).toHaveBeenCalledTimes(2));
  });
});

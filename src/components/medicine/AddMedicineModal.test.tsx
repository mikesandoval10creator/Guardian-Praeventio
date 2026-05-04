// @vitest-environment jsdom
//
// Sprint 20 — Bucket D — AddMedicineModal render/submit tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const addNodeMock = vi.fn(async () => ({ id: 'node-1' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ addNode: addNodeMock }),
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// MedicalIcon pulls bioicons assets; stub.
vi.mock('../medical/MedicalIcon', () => ({
  MedicalIcon: ({ name }: { name: string }) =>
    React.createElement('span', { 'data-testid': `medical-icon-${name}` }),
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { AddMedicineModal } from './AddMedicineModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AddMedicineModal', () => {
  it('renders modal title and patient field when open', () => {
    render(<AddMedicineModal isOpen={true} onClose={() => {}} projectId="proj-1" />);
    expect(screen.getByText(/Nueva Consulta/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Nombre completo/)).toBeInTheDocument();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <AddMedicineModal isOpen={false} onClose={() => {}} projectId="proj-1" />
    );
    expect(container.querySelector('form')).toBeNull();
  });

  it('happy-path: submit fills addNode with medicine metadata and closes', async () => {
    const onClose = vi.fn();
    render(<AddMedicineModal isOpen={true} onClose={onClose} projectId="proj-1" />);

    fireEvent.change(screen.getByPlaceholderText(/Nombre completo/), {
      target: { value: 'María Soto' },
    });

    // Submit the form by clicking the submit button.
    const submitBtn = screen.getByRole('button', { name: /guardar/i });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(addNodeMock).toHaveBeenCalled());
    const arg = (addNodeMock.mock.calls as any[])[0][0] as any;
    expect(arg.title).toMatch(/María Soto/);
    expect(arg.metadata.patient).toBe('María Soto');
    expect(onClose).toHaveBeenCalled();
  });
});

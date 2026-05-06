// @vitest-environment jsdom
//
// Sprint 32 — Bucket WW — AddHygieneModal render/submit tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks (must precede component import) ─────────────────────────────────

const addNodeMock = vi.fn(async () => ({ id: 'hygiene-node-1' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ addNode: addNodeMock }),
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { AddHygieneModal } from './AddHygieneModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AddHygieneModal', () => {
  it('renders modal with parameter, value and location fields when open', () => {
    render(<AddHygieneModal isOpen={true} onClose={() => {}} projectId="proj-1" />);
    expect(screen.getByText(/Nuevo Registro/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Zona de Carga/i)).toBeInTheDocument();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <AddHygieneModal isOpen={false} onClose={() => {}} projectId="proj-1" />
    );
    expect(container.querySelector('form')).toBeNull();
  });

  it('flags warning status when value exceeds parameter limit', async () => {
    const onClose = vi.fn();
    render(<AddHygieneModal isOpen={true} onClose={onClose} projectId="proj-1" />);

    // Default parameter is 'Ruido Ambiental' (limit 85 dB). Submit value 95.
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '95' } });
    fireEvent.change(screen.getByPlaceholderText(/Zona de Carga/i), {
      target: { value: 'Patio de carga' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(addNodeMock).toHaveBeenCalled());
    const arg = (addNodeMock.mock.calls as any[])[0][0] as any;
    expect(arg.metadata.value).toBe(95);
    expect(arg.metadata.status).toBe('warning');
    expect(arg.tags).toContain('alerta');
    expect(onClose).toHaveBeenCalled();
  });

  it('marks status as safe when value is within the parameter limit', async () => {
    render(<AddHygieneModal isOpen={true} onClose={() => {}} projectId="proj-1" />);

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '70' } });
    fireEvent.change(screen.getByPlaceholderText(/Zona de Carga/i), {
      target: { value: 'Oficina central' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(addNodeMock).toHaveBeenCalled());
    const arg = (addNodeMock.mock.calls as any[])[0][0] as any;
    expect(arg.metadata.status).toBe('safe');
    expect(arg.tags).toContain('seguro');
  });
});

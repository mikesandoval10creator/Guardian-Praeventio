// @vitest-environment jsdom
//
// Sprint 20 â€” Bucket D â€” CloseProcessModal integration tests.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Process } from '../../types/organic';

// â”€â”€â”€ Mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

vi.mock('../../services/firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'fake-token' } },
  db: {},
}));

// canvas-confetti throws in jsdom; just stub it.
vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { CloseProcessModal, computeAutoCompliance } from './CloseProcessModal';

const baseProcess: Process = {
  id: 'proc-1',
  crewId: 'crew-1',
  projectId: 'proj-1',
  type: 'concreto',
  name: 'Hormigonado losa',
  description: '',
  startedAt: new Date().toISOString(),
  endedAt: null,
  plannedEndDate: null,
  status: 'active',
  complianceScore: 100,
  incidentsDuringProcess: 0,
  alertsResponded: 2,
  xpAwardedAtClose: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CloseProcessModal', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ xpAwarded: 110 }) }) as any
    );
  });

  it('renders process name + auto compliance + XP preview', () => {
    render(
      <CloseProcessModal isOpen={true} process={baseProcess} onClose={() => {}} />
    );
    expect(screen.getByText(/Hormigonado losa/)).toBeInTheDocument();
    // Auto compliance for 0 incidentes + 2 alertas = min(100, 100+10) = 100.
    expect(screen.getByText(/100\s*\/\s*100/)).toBeInTheDocument();
    // XP preview line.
    expect(screen.getByText(/XP estimado/i)).toBeInTheDocument();
  });

  it('happy-path: POSTs to /api/processes/:id/close and fires onClosed + onClose', async () => {
    const onClosed = vi.fn();
    const onClose = vi.fn();
    render(
      <CloseProcessModal
        isOpen={true}
        process={baseProcess}
        onClose={onClose}
        onClosed={onClosed}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /cerrar y celebrar/i }));
    await waitFor(() => expect(onClosed).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/processes/proc-1/close',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('surfaces server error and stays open', async () => {
    globalThis.fetch = vi.fn(async () =>
      ({ ok: false, status: 409, json: async () => ({ error: 'already terminal' }) }) as any
    );
    const onClose = vi.fn();
    render(
      <CloseProcessModal isOpen={true} process={baseProcess} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole('button', { name: /cerrar y celebrar/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/already terminal/);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('computeAutoCompliance subtracts incidentes and adds alertas (clamped)', () => {
    expect(computeAutoCompliance({ incidentsDuringProcess: 0, alertsResponded: 0 })).toBe(100);
    expect(computeAutoCompliance({ incidentsDuringProcess: 10, alertsResponded: 0 })).toBe(50);
    expect(computeAutoCompliance({ incidentsDuringProcess: 30, alertsResponded: 0 })).toBe(0); // clamp
    expect(computeAutoCompliance({ incidentsDuringProcess: 0, alertsResponded: 50 })).toBe(100); // clamp top
  });
});

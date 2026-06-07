// @vitest-environment jsdom
//
// Wiring test for the LOTO page (Fase 5 B8): proves the page lists applications,
// creates one, and drives the panel's verify-zero-energy / release callbacks
// through the client API. The engine/panel internals are covered by their own
// suites; here we assert the page → API wiring.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { LotoApplication } from '../services/loto/lotoDigitalLight';

const H = vi.hoisted(() => ({
  selectedProject: { id: 'proj-1' } as { id: string } | null,
  user: { uid: 'u1' } as { uid: string } | null,
  lotoData: null as { applications: LotoApplication[] } | null,
  loading: false,
  refetch: vi.fn(),
  create: vi.fn(),
  apply: vi.fn(),
  verify: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: H.selectedProject }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: H.user }),
}));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));
vi.mock('../hooks/useLoto', () => ({
  useLoto: () => ({ data: H.lotoData, loading: H.loading, error: null, refetch: H.refetch }),
  createLotoApplication: (...a: unknown[]) => H.create(...a),
  applyLotoLock: (...a: unknown[]) => H.apply(...a),
  verifyLotoZeroEnergy: (...a: unknown[]) => H.verify(...a),
  releaseLoto: (...a: unknown[]) => H.release(...a),
}));

import { Loto } from './Loto';

function makeApp(over: Partial<LotoApplication> = {}): LotoApplication {
  return {
    id: 'app-1',
    equipmentId: 'eq-1',
    leaderUid: 'u1',
    authorizedWorkerUids: [],
    energiesIdentified: ['electric'],
    lockPoints: [],
    appliedAt: '2026-05-01T00:00:00Z',
    workDescription: 'Mantención tablero',
    ...over,
  };
}

const lockPoint = (verified: boolean) => ({
  pointId: 'lp1',
  description: 'Seccionador',
  energyType: 'electric' as const,
  appliedByUid: 'u1',
  appliedAt: '2026-05-01T01:00:00Z',
  tagId: 'ROJO-1',
  zeroEnergyVerified: verified,
});

beforeEach(() => {
  H.selectedProject = { id: 'proj-1' };
  H.user = { uid: 'u1' };
  H.lotoData = { applications: [] };
  H.loading = false;
  H.refetch.mockReset();
  H.create.mockReset().mockResolvedValue({ application: makeApp() });
  H.apply.mockReset().mockResolvedValue({ application: makeApp() });
  H.verify.mockReset().mockResolvedValue({ application: makeApp() });
  H.release.mockReset().mockResolvedValue({ application: makeApp() });
});

afterEach(() => cleanup());

describe('LOTO page', () => {
  it('prompts to select a project when none is active', () => {
    H.selectedProject = null;
    render(<Loto />);
    expect(screen.getByText(/Selecciona un proyecto para gestionar LOTO/)).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no active applications', () => {
    H.lotoData = { applications: [] };
    render(<Loto />);
    expect(screen.getByText(/No hay aplicaciones LOTO activas/)).toBeInTheDocument();
  });

  it('creates a LOTO application from the form (energy selected + fields filled)', async () => {
    render(<Loto />);
    fireEvent.change(screen.getByTestId('loto-create-equipment'), { target: { value: 'CAEX-08' } });
    fireEvent.change(screen.getByTestId('loto-create-work'), { target: { value: 'Cambio de filtros' } });
    fireEvent.click(screen.getByTestId('loto-energy-electric'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('loto-create-submit'));
    });

    expect(H.create).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        equipmentId: 'CAEX-08',
        workDescription: 'Cambio de filtros',
        energiesIdentified: ['electric'],
      }),
    );
    expect(H.refetch).toHaveBeenCalled();
  });

  it('does not create when no energy is selected (client guard)', async () => {
    render(<Loto />);
    fireEvent.change(screen.getByTestId('loto-create-equipment'), { target: { value: 'CAEX-08' } });
    fireEvent.change(screen.getByTestId('loto-create-work'), { target: { value: 'Cambio de filtros' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('loto-create-submit'));
    });
    expect(H.create).not.toHaveBeenCalled();
    expect(screen.getByTestId('loto-feedback')).toBeInTheDocument();
  });

  it('verifies zero-energy on a lock point via the panel callback', async () => {
    H.lotoData = { applications: [makeApp({ lockPoints: [lockPoint(false)] })] };
    render(<Loto />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('loto-verify-lp1'));
    });
    expect(H.verify).toHaveBeenCalledWith('proj-1', 'app-1', 'lp1');
    expect(H.refetch).toHaveBeenCalled();
  });

  it('releases a fully-verified application via the panel callback', async () => {
    // electric energy locked + zero-energy verified → authorizesWork → release button shown.
    H.lotoData = { applications: [makeApp({ lockPoints: [lockPoint(true)] })] };
    render(<Loto />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('loto-release'));
    });
    expect(H.release).toHaveBeenCalledWith('proj-1', 'app-1');
    expect(H.refetch).toHaveBeenCalled();
  });
});

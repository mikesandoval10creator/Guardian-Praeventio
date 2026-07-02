// @vitest-environment jsdom
//
// Praeventio Guard — de-fabrication of EvacuationRoutes.tsx.
// Audit 2026-07-02 §3.4 #5-6 (docs/audits/AUDITORIA-END-TO-END-2026-07-02.md):
//   - "Instrucciones" was 4 literal <li> strings disconnected from the real
//     A* `path`. Now derived from the actual path (deriveEvacuationInstructions).
//   - "Emergencia Activa" badge was a static <div> with no condition — always
//     rendered. Now tied to `recentEarthquake.mag >= 6.0` (the same threshold
//     that auto-triggers route calculation).
//   - "Notificar a Cuadrilla" had no onClick (dead button). Now wired to the
//     real POST /api/emergency/notify-brigada endpoint.
//
// Also unit-tests the pure `deriveEvacuationInstructions` helper directly —
// no fabricated literals, computed from a real path.

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { deriveEvacuationInstructions } from './EvacuationRoutes';

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: { id: 'p-1', name: 'Faena Norte' },
  }),
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u-1' } }),
}));

vi.mock('../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ addNode: vi.fn(async () => undefined) }),
}));

vi.mock('../services/analytics', () => ({
  analytics: { track: vi.fn() },
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// notifyCrew() does `await import('../lib/apiAuth')` — the REAL module
// transitively pulls in `../services/firebase` (initializeApp/
// initializeFirestore against the real SDK), which is exactly what every
// sibling test in this repo mocks away. Mock it directly so the dynamic
// import resolves to this stub instead of touching real Firebase init.
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn(async () => 'Bearer test-token'),
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
  };
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // No seismic activity by default — tests that need a quake stub it directly.
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ features: [] }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('deriveEvacuationInstructions (pure, no fabrication)', () => {
  it('returns [] for an empty or single-cell path', () => {
    expect(deriveEvacuationInstructions([])).toEqual([]);
    expect(deriveEvacuationInstructions([{ x: 0, y: 0 }])).toEqual([]);
  });

  it('derives a single "Avanzar al Norte" segment for a straight vertical path', () => {
    // y decreasing = North (grid convention: {0,0} top-left, {9,9} bottom-right).
    const path = [{ x: 0, y: 5 }, { x: 0, y: 4 }, { x: 0, y: 3 }, { x: 0, y: 2 }];
    const steps = deriveEvacuationInstructions(path);
    expect(steps[0]).toBe('Avanzar al Norte 30m'); // 3 steps * 10m
    expect(steps[steps.length - 1]).toBe('Llegada a Zona Segura');
  });

  it('groups a multi-turn path into distinct segments with "Girar al" after the first', () => {
    // North 2 cells, then East 3 cells.
    const path = [
      { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 },
      { x: 6, y: 3 }, { x: 7, y: 3 }, { x: 8, y: 3 },
    ];
    const steps = deriveEvacuationInstructions(path);
    expect(steps).toEqual([
      'Avanzar al Norte 20m',
      'Girar al Este 30m',
      'Llegada a Zona Segura',
    ]);
  });

  it('is a pure function of `path` — same input always yields same output (no Math.random, no Date.now)', () => {
    const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const a = deriveEvacuationInstructions(path);
    const b = deriveEvacuationInstructions(path);
    expect(a).toEqual(b);
  });
});

import { EvacuationRoutes } from './EvacuationRoutes';

describe('EvacuationRoutes — "Emergencia Activa" badge is conditioned on real state', () => {
  it('does NOT render the badge when there is no recent earthquake', async () => {
    const { queryByText, findByText } = render(<EvacuationRoutes />);
    await findByText('Plano de Faena (Grilla Dinámica)'); // wait for seismic check to settle
    expect(queryByText('Emergencia Activa')).not.toBeInTheDocument();
  });

  it('does NOT render the badge for a sub-6.0 quake', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [{ id: 'q1', properties: { mag: 5.2, place: 'Test', time: Date.now(), url: 'x' } }],
      }),
    });
    const { queryByText, findByText } = render(<EvacuationRoutes />);
    await findByText(/Alerta Sísmica: 5.2 Richter/i);
    expect(queryByText('Emergencia Activa')).not.toBeInTheDocument();
  });

  it('renders the badge for a quake >= 6.0 (the real auto-trigger threshold)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [{ id: 'q1', properties: { mag: 6.5, place: 'Test', time: Date.now(), url: 'x' } }],
      }),
    });
    const { findByText } = render(<EvacuationRoutes />);
    await findByText('Emergencia Activa');
  });
});

describe('EvacuationRoutes — "Notificar a Cuadrilla" button is wired to the real endpoint', () => {
  async function renderWithCalculatedRoute() {
    const utils = render(<EvacuationRoutes />);
    await utils.findByText('Plano de Faena (Grilla Dinámica)');
    fireEvent.click(utils.getByText(/Generar Ruta de Evacuación/i));
    await waitFor(() => expect(utils.queryByText('Ruta Segura Encontrada')).toBeInTheDocument(), { timeout: 2000 });
    return utils;
  }

  it('POSTs to /api/emergency/notify-brigada when clicked', async () => {
    const utils = await renderWithCalculatedRoute();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notified: 2 }),
    });

    fireEvent.click(utils.getByText('Notificar a Cuadrilla'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c: unknown[]) => c[0] === '/api/emergency/notify-brigada');
      expect(call).toBeTruthy();
    });
    const [, init] = fetchMock.mock.calls.find((c: unknown[]) => c[0] === '/api/emergency/notify-brigada')! as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.projectId).toBe('p-1');
    expect(body.emergencyType).toBe('other');
  });

  it('shows a success confirmation with the notified count', async () => {
    const utils = await renderWithCalculatedRoute();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notified: 3 }),
    });
    fireEvent.click(utils.getByText('Notificar a Cuadrilla'));
    await utils.findByText(/Cuadrilla notificada \(3 supervisores\)/i);
  });

  it('shows an honest error (not a false success) when notified:0', async () => {
    const utils = await renderWithCalculatedRoute();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notified: 0 }),
    });
    fireEvent.click(utils.getByText('Notificar a Cuadrilla'));
    await utils.findByText(/ningún supervisor tiene notificaciones push registradas/i);
  });

  it('shows an honest error when the request fails', async () => {
    const utils = await renderWithCalculatedRoute();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server_error' }),
    });
    fireEvent.click(utils.getByText('Notificar a Cuadrilla'));
    await utils.findByText(/no se pudo contactar a la cuadrilla/i);
  });
});

describe('EvacuationRoutes — instructions render from the real A* path', () => {
  it('renders "Llegada a Zona Segura" as the final step after calculating a route', async () => {
    const utils = render(<EvacuationRoutes />);
    await utils.findByText('Plano de Faena (Grilla Dinámica)');
    fireEvent.click(utils.getByText(/Generar Ruta de Evacuación/i));
    await utils.findByText('Llegada a Zona Segura', {}, { timeout: 2000 });
  });
});

// @vitest-environment jsdom
//
// OLA 1 (VIDA visible) — worker Restricted Zones surface. Verifies the orphan
// wiring is real: the zone list loads, the self-attestation panel drives a
// real engine evaluation, and acknowledging an entry ALWAYS logs (founder
// directive: never block — inform + record), passing the worker snapshot.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RestrictedZone } from '../services/zones/restrictedZonesEngine';

// ── i18n: return the fallback string (same shape as ZoneEntryGate.test) ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

// ── Google-Maps overlay: stub so jsdom doesn't load the maps SDK ──
vi.mock('../components/zones/RestrictedZonesMapOverlay', () => ({
  RestrictedZonesMapOverlay: ({ projectId }: { projectId: string }) => (
    <div data-testid="map-overlay-stub">{projectId}</div>
  ),
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'p1', name: 'Faena 1' } }),
}));

vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../services/firebase', () => ({
  auth: { currentUser: { uid: 'w1' } },
}));

const useWorkPermitsMock = vi.fn();
vi.mock('../hooks/useWorkPermits', () => ({
  useWorkPermits: (...args: unknown[]) => useWorkPermitsMock(...args),
}));

const listZonesMock = vi.fn();
const logEntryMock = vi.fn();
vi.mock('../hooks/useRestrictedZones', () => ({
  listRestrictedZonesBySite: (...args: unknown[]) => listZonesMock(...args),
  logZoneEntryEvent: (...args: unknown[]) => logEntryMock(...args),
}));

import { ZoneEntryView } from './ZoneEntryView';

const HOT_ZONE: RestrictedZone = {
  id: 'z1',
  kind: 'hot', // → permit kind 'caliente'
  name: 'Zona Caliente A',
  activeFrom: '2020-01-01T00:00:00.000Z',
  rules: {
    requiredEpp: ['casco'],
    requiredTrainings: [],
    requiresPermit: true,
    responsibleUid: 'sup1',
  },
};

beforeEach(() => {
  listZonesMock.mockReset();
  logEntryMock.mockReset();
  useWorkPermitsMock.mockReset();
  listZonesMock.mockResolvedValue({ zones: [HOT_ZONE] });
  logEntryMock.mockResolvedValue({
    success: true,
    eventId: 'e1',
    evaluation: { allowed: false, missing: [], warnings: [] },
    recorded: true,
  });
  // Worker holds an ACTIVE 'caliente' permit (real data).
  useWorkPermitsMock.mockReturnValue({
    data: { permits: [{ kind: 'caliente' }] },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe('<ZoneEntryView /> — worker restricted-zones surface', () => {
  it('loads the site zones from /api/zones and mounts the map overlay', async () => {
    render(<ZoneEntryView />);
    expect(await screen.findByTestId('zone-row-z1')).toBeInTheDocument();
    expect(screen.getByTestId('map-overlay-stub')).toHaveTextContent('p1');
    expect(listZonesMock).toHaveBeenCalledWith('p1');
  });

  it('acknowledging an entry ALWAYS logs, even with a missing requirement (never blocks)', async () => {
    render(<ZoneEntryView />);
    fireEvent.click(await screen.findByTestId('zone-prepare-z1'));

    // Self-attestation panel; worker does NOT confirm the 'casco' EPP.
    expect(screen.getByTestId('zone-prepare-panel')).toBeInTheDocument();
    // Real permit detected from real active-permit data.
    expect(screen.getByTestId('zone-permit-status')).toHaveTextContent('caliente');

    fireEvent.click(screen.getByTestId('zone-continue'));

    // The orphan gate is now mounted with a real engine input.
    const ack = await screen.findByTestId('zone-gate-ack');
    expect(ack).toBeEnabled(); // primary action ALWAYS enabled

    fireEvent.click(ack);

    await waitFor(() => expect(logEntryMock).toHaveBeenCalledTimes(1));
    const payload = logEntryMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      projectId: 'p1',
      zoneId: 'z1',
      workerUid: 'w1',
    });
    // EPP unconfirmed → engine flags it missing; permit present → not missing.
    expect(payload.evaluation.missing).toContain('EPP: casco');
    expect(payload.evaluation.missing).not.toContain('Permit activo: caliente');
    // Worker snapshot carries the REAL active permit kinds.
    expect(payload.workerSnapshot.workerActivePermitKinds).toEqual(['caliente']);
    expect(await screen.findByTestId('zone-entry-log-ok')).toBeInTheDocument();
  });

  it('blocks "Continuar" while active permits are still loading (no false missing-permit)', async () => {
    useWorkPermitsMock.mockReturnValue({
      data: undefined,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    render(<ZoneEntryView />);
    fireEvent.click(await screen.findByTestId('zone-prepare-z1'));
    expect(screen.getByTestId('zone-permits-loading')).toBeInTheDocument();
    expect(screen.getByTestId('zone-continue')).toBeDisabled();
  });

  it('self-attested EPP flows into the evaluation (no fabrication either way)', async () => {
    render(<ZoneEntryView />);
    fireEvent.click(await screen.findByTestId('zone-prepare-z1'));

    // Worker confirms they are wearing the helmet.
    fireEvent.click(screen.getByTestId('zone-epp-casco'));
    fireEvent.click(screen.getByTestId('zone-continue'));

    fireEvent.click(await screen.findByTestId('zone-gate-ack'));

    await waitFor(() => expect(logEntryMock).toHaveBeenCalledTimes(1));
    const payload = logEntryMock.mock.calls[0][0];
    expect(payload.workerSnapshot.workerEppLabels).toContain('casco');
    expect(payload.evaluation.missing).not.toContain('EPP: casco');
    expect(payload.evaluation.allowed).toBe(true);
  });
});

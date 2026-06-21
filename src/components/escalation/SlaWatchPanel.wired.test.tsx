// @vitest-environment jsdom
//
// Wiring test for the SLA Watch surface as it renders on the Dashboard:
//   useSlaWatchItems(projectId)  →  <SlaWatchPanel items={...} hideHealthy />
//
// This exercises the REAL data path end-to-end with only the network frontier
// mocked: the hook fetches `/api/sprint-k/:projectId/sla-watch`, the server
// payload (already assessed by `assessSla`) flows into the panel, and the panel
// renders the real item with its real SLA state. It guards against the cascarón
// regression where every item showed `within_sla` (fabricated `new Date()`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useSlaWatchItems } from '../../hooks/useSlaWatchItems';
import { SlaWatchPanel } from './SlaWatchPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => fallback ?? _k,
  }),
}));

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeader: async () => 'Bearer test',
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

/** The Dashboard wiring, verbatim: hook → panel with hideHealthy. */
function DashboardSlaSection({ projectId }: { projectId: string | null }) {
  const { items: slaItems } = useSlaWatchItems(projectId);
  return (
    <div>
      {slaItems.length > 0 && <SlaWatchPanel items={slaItems} hideHealthy />}
    </div>
  );
}

describe('SLA Watch wiring (useSlaWatchItems → SlaWatchPanel)', () => {
  it('renders the real assessed incident returned by the server', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        now: '2026-06-20T12:00:00.000Z',
        items: [
          {
            item: {
              id: 'inc-breached',
              kind: 'incident',
              severity: 'critical',
              status: 'open',
              createdAt: '2020-01-01T00:00:00.000Z',
            },
            label: 'Volcamiento de equipo en rampa',
            assessment: {
              state: 'permanently_overdue',
              slaMinutes: 240,
              ageMinutes: 999999,
              minutesUntilBreach: -999759,
              consumedFraction: 4166.66,
            },
          },
        ],
      }),
    });

    render(<DashboardSlaSection projectId="proj-1" />);

    // It actually called the real endpoint with the auth header.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sprint-k/proj-1/sla-watch',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test' }),
      }),
    );

    // The panel rendered the REAL item with its REAL (overdue) SLA state.
    const item = await screen.findByTestId('sla-watch-item-inc-breached');
    expect(item).toBeTruthy();
    expect(item.getAttribute('data-state')).toBe('permanently_overdue');
    expect(screen.getByText('Volcamiento de equipo en rampa')).toBeTruthy();
    // The overdue badge appears in the summary header.
    expect(screen.getByTestId('sla-watch-summary').textContent).toContain('OVD');
  });

  it('renders nothing when the server returns no items (honest empty)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ now: '2026-06-20T12:00:00.000Z', items: [] }),
    });

    const { container } = render(<DashboardSlaSection projectId="proj-1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // length===0 → the panel is not mounted at all (Dashboard guard).
    expect(screen.queryByTestId('sla-watch-panel')).toBeNull();
    expect(container.querySelector('[data-testid="sla-watch-panel"]')).toBeNull();
  });

  it('does not fetch when there is no selected project', async () => {
    render(<DashboardSlaSection projectId={null} />);
    // Give the effect a tick.
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    expect(screen.queryByTestId('sla-watch-panel')).toBeNull();
  });
});

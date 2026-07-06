// @vitest-environment jsdom
//
// Phase 5 "make real" — verifies FirstResponderMap surfaces the previously
// orphaned FirstResponderDispatchPanel: it fetches the REAL responder feed
// (coverage), builds a dispatch plan on demand, and the dispatch action posts a
// REAL note to the project emergency channel. The hook + firebase edges are
// mocked; the panel renders for real so this pins the integration.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const feed = {
  responders: [
    { uid: 'r1', name: 'Ana Paramédico', roles: ['paramedic'], availability: 'on_duty' },
  ],
  coverageGaps: [
    { kind: 'rescue_specialist', severity: 'warning', detail: 'Sin rescatista en sitio' },
  ],
};

const plan = {
  incidentKind: 'medical_emergency',
  noEligibleResponder: false,
  recommendations: [],
  primary: {
    responderUid: 'r1',
    matchedRole: 'paramedic',
    distanceMeters: 120,
    estimatedArrivalSeconds: 90,
    matchScore: 88,
    available: true,
  },
  backups: [],
};

const h = vi.hoisted(() => ({
  fetchFirstResponderFeed: vi.fn(),
  buildFirstResponderDispatchPlan: vi.fn(),
  addDoc: vi.fn(),
}));

vi.mock('../hooks/useFirstResponderMap', () => ({
  fetchFirstResponderFeed: h.fetchFirstResponderFeed,
  buildFirstResponderDispatchPlan: h.buildFirstResponderDispatchPlan,
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: { id: 'proj-1', name: 'Faena Norte', coordinates: { lat: -33.4, lng: -70.6 } },
  }),
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u1', displayName: 'Sup', email: 's@x.cl' } }),
}));

vi.mock('../services/firebase', () => ({
  db: {},
  collection: (_db: unknown, path: string) => ({ path }),
  addDoc: h.addDoc,
  serverTimestamp: () => 'ts',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

import { FirstResponderMap } from './FirstResponderMap';

beforeEach(() => {
  cleanup();
  h.fetchFirstResponderFeed.mockReset().mockResolvedValue(feed);
  h.buildFirstResponderDispatchPlan.mockReset().mockResolvedValue({ plan });
  h.addDoc.mockReset().mockResolvedValue({ id: 'msg-1' });
});

describe('<FirstResponderMap /> — orphan FirstResponderDispatchPanel wiring', () => {
  // The build button is `disabled={building || loadingFeed}`; clicking it before
  // the feed resolves is a silent no-op (fireEvent ignores disabled elements). On
  // the constrained CI runner the click otherwise races ahead of the feed load,
  // so buildFirstResponderDispatchPlan never fires (0 calls) — the real cause of
  // the shard-4 red on main. Gate every click on the enabled button so the flow
  // is deterministic regardless of runner speed.
  async function clickBuildWhenEnabled() {
    await waitFor(() =>
      expect((screen.getByTestId('build-dispatch-plan') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('build-dispatch-plan'));
  }

  it('fetches the real responder feed on mount and renders coverage gaps', async () => {
    render(<FirstResponderMap />);
    await waitFor(() => expect(h.fetchFirstResponderFeed).toHaveBeenCalledWith('proj-1'));
    expect(await screen.findByTestId('coverage-gap-rescue_specialist', {}, { timeout: 5_000 })).toBeTruthy();
  });

  it('builds a dispatch plan on demand and shows the primary responder', async () => {
    render(<FirstResponderMap />);
    await clickBuildWhenEnabled();
    await waitFor(() =>
      expect(h.buildFirstResponderDispatchPlan).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ incident: expect.objectContaining({ kind: 'medical_emergency' }) }),
      ),
    );
    expect(await screen.findByTestId('first-responder-primary', {}, { timeout: 5_000 })).toBeTruthy();
  });

  it('dispatching the primary posts a REAL note to the emergency channel', async () => {
    render(<FirstResponderMap />);
    await clickBuildWhenEnabled();
    const notify = await screen.findByTestId('first-responder-notify-primary', {}, { timeout: 5_000 });
    fireEvent.click(notify);
    await waitFor(() => expect(h.addDoc).toHaveBeenCalled());
    // The dispatch note went to the project emergency channel with a real body.
    const [collRef, payload] = h.addDoc.mock.calls[0] as unknown as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(collRef.path).toBe('projects/proj-1/emergency_chat');
    expect(String(payload.text)).toContain('Ana Paramédico');
    expect(payload.senderRole).toBe('first_responder_dispatch');
  });
});

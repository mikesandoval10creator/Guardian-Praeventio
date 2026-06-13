// @vitest-environment jsdom
//
// Schema-alignment regression test for the supervisor man-down widget.
//
// THE BUG (ola0 "mandown-schema"): the widget queried `orderBy('timestamp')`
// and filtered `status === 'pending'`, but the ONLY writer
// (src/hooks/useManDownDetection.ts) writes `triggeredAt` (serverTimestamp) and
// `status: 'active'`. Firestore EXCLUDES docs missing the orderBy field, and
// the status filter never matched — so the supervisor was permanently BLIND to
// every man-down event the hook produced. This suite pins the aligned schema:
//
//   1. The live query orders by `triggeredAt` (NOT `timestamp`), so the hook's
//      docs are not silently dropped.
//   2. A doc shaped exactly like the hook writes (`status: 'active'`,
//      `triggeredAt`, free-form `location` string, NO `timestamp`) surfaces in
//      the supervisor's pending list.
//   3. ACK works end-to-end: it updates the doc with `status: 'acknowledged'`
//      and an identity payload whose keys are exactly those firestore.rules
//      permits.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';

// ── Hoisted mock state (declared before the import-under-test). ─────────────
const h = vi.hoisted(() => ({
  // Captured args so we can assert the canonical orderBy field.
  orderByCalls: [] as Array<{ field: string; dir: string }>,
  // Captured onSnapshot callback so the test can push docs at will.
  snapshotCb: null as null | ((snap: { docs: Array<{ id: string; data: () => unknown }> }) => void),
  // Captured updateDoc calls for ACK assertions.
  updateDoc: vi.fn(async (..._args: unknown[]) => undefined),
  doc: vi.fn(() => ({ __doc: true })),
  track: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ __collection: true })),
  query: vi.fn((...args: unknown[]) => ({ __query: args })),
  orderBy: vi.fn((field: string, dir: string) => {
    h.orderByCalls.push({ field, dir });
    return { __orderBy: field };
  }),
  limit: vi.fn((n: number) => ({ __limit: n })),
  onSnapshot: vi.fn((_q: unknown, cb: (snap: unknown) => void) => {
    h.snapshotCb = cb as typeof h.snapshotCb;
    return () => undefined; // unsubscribe
  }),
  updateDoc: h.updateDoc,
  doc: h.doc,
}));

vi.mock('../../services/firebase', () => ({ db: {} }));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'p1', name: 'Mina X' } }),
}));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'sup1', displayName: 'Super Visor', email: 'sup@x.cl' } }),
}));

vi.mock('../../services/analytics', () => ({ analytics: { track: h.track } }));

import { ManDownSupervisorWidget } from './ManDownSupervisorWidget';

// A doc shaped EXACTLY like useManDownDetection.ts writes it: `triggeredAt`
// (serverTimestamp surrogate, exposes .toDate()), `status: 'active'`, free-form
// `location` string, and crucially NO `timestamp` field.
function writerShapedDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt1',
    data: () => ({
      workerId: 'u1',
      workerName: 'Juan Pérez',
      status: 'active',
      triggeredAt: { toDate: () => new Date('2026-06-12T14:30:00Z') },
      location: '-33.45, -70.66',
      acknowledgedBy: null,
      acknowledgedAt: null,
      ...overrides,
    }),
  };
}

beforeEach(() => {
  h.orderByCalls = [];
  h.snapshotCb = null;
  h.updateDoc.mockClear();
  h.doc.mockClear();
  h.track.mockClear();
  h.updateDoc.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe('ManDownSupervisorWidget — writer/reader schema alignment', () => {
  it('orders the live query by `triggeredAt` (the field the hook actually writes), not `timestamp`', () => {
    render(<ManDownSupervisorWidget />);
    expect(h.orderByCalls).toEqual([{ field: 'triggeredAt', dir: 'desc' }]);
    // Guard against the original bug ever creeping back.
    expect(h.orderByCalls.some((c) => c.field === 'timestamp')).toBe(false);
  });

  it('shows a man-down event written by the hook (status:"active", no `timestamp`)', () => {
    render(<ManDownSupervisorWidget />);
    expect(h.snapshotCb).toBeTypeOf('function');
    act(() => {
      h.snapshotCb?.({ docs: [writerShapedDoc()] });
    });
    // Worker name surfaces, the alert header renders, and the pending badge counts 1.
    expect(screen.getByText('Juan Pérez')).toBeTruthy();
    expect(screen.getByText('Man Down — Alertas')).toBeTruthy();
    // The free-form GPS location string is rendered as-is.
    expect(screen.getByText('-33.45, -70.66')).toBeTruthy();
    // The ACK button is present for the active (unacknowledged) event.
    expect(screen.getByText('ACK')).toBeTruthy();
  });

  it('renders nothing when there are no events (avoids an empty red panel)', () => {
    const { container } = render(<ManDownSupervisorWidget />);
    act(() => {
      h.snapshotCb?.({ docs: [] });
    });
    expect(container.firstChild).toBeNull();
  });

  it('ACK updates the doc to status:"acknowledged" with rules-permitted identity fields', async () => {
    render(<ManDownSupervisorWidget />);
    act(() => {
      h.snapshotCb?.({ docs: [writerShapedDoc()] });
    });
    fireEvent.click(screen.getByText('ACK'));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalledTimes(1));
    const payload = h.updateDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.status).toBe('acknowledged');
    // Identity from the verified user — uid in `acknowledgedBy`, name in
    // `acknowledgedByName` (mirrors the hook + firestore.rules allowed keys).
    expect(payload.acknowledgedBy).toBe('sup1');
    expect(payload.acknowledgedByName).toBe('Super Visor');
    expect(payload).toHaveProperty('acknowledgedAt');
    // Only the keys firestore.rules' update guard permits.
    expect(Object.keys(payload).sort()).toEqual(
      ['acknowledgedAt', 'acknowledgedBy', 'acknowledgedByName', 'status'].sort(),
    );
  });

  it('moves acknowledged/resolved events to the recent history (not the pending list)', () => {
    render(<ManDownSupervisorWidget />);
    act(() => {
      h.snapshotCb?.({
        docs: [
          writerShapedDoc({ status: 'acknowledged', workerName: 'Ana Soto' }),
        ],
      });
    });
    // Ana shows up (in recent), but there is NO ACK button because nothing is active.
    expect(screen.getByText('Ana Soto')).toBeTruthy();
    expect(screen.queryByText('ACK')).toBeNull();
  });
});

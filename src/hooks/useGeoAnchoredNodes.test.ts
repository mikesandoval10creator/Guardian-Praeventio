// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
//
// Tests para `useGeoAnchoredNodes`. Mockeamos `services/firebase` para
// inyectar un onSnapshot controlable y verificar que (a) el bounding-box
// query se construye con los where() esperados, y (b) el filtro de
// Haversine descarta nodos fuera del radio.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

type SnapCb = (snap: { docs: { id: string; data: () => any }[] }) => void;

const onSnapshotMock = vi.fn<(q: any, ok: SnapCb, err?: (e: Error) => void) => () => void>();
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({
  field,
  op,
  value,
  __kind: 'where',
}));
const queryMock = vi.fn((...args: any[]) => ({ __kind: 'query', args }));
const collectionMock = vi.fn((...args: any[]) => ({
  __kind: 'collection',
  args,
}));

vi.mock('../services/firebase', () => ({
  db: { __kind: 'db' },
  collection: (db: unknown, name: string) => collectionMock(db, name),
  query: (q: unknown, ...rest: unknown[]) => queryMock(q, ...rest),
  where: (field: string, op: string, value: unknown) => whereMock(field, op, value),
  onSnapshot: (q: any, ok: SnapCb, err?: (e: Error) => void) =>
    onSnapshotMock(q, ok, err),
  handleFirestoreError: vi.fn(),
  OperationType: { LIST: 'LIST' },
}));

import { useGeoAnchoredNodes } from './useGeoAnchoredNodes';

beforeEach(() => {
  onSnapshotMock.mockReset();
  whereMock.mockClear();
  queryMock.mockClear();
  collectionMock.mockClear();
  // default: no-op snapshot subscription returning a no-op unsubscribe.
  onSnapshotMock.mockImplementation(() => () => {});
});

function makeNodeDoc(
  id: string,
  geo: { lat: number; lng: number } | null,
  tags: string[] = [],
) {
  return {
    id,
    data: () => ({
      tags,
      metadata: geo ? { geo } : {},
      title: `n-${id}`,
      type: 'Control',
      description: '',
      connections: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }),
  };
}

describe('useGeoAnchoredNodes', () => {
  it('issues a Firestore query with projectId + bounding-box lat range', async () => {
    renderHook(() =>
      useGeoAnchoredNodes({
        projectId: 'p1',
        center: { lat: -33.45, lng: -70.66 },
        radiusM: 100,
      }),
    );

    // Trigger of subscription is synchronous-ish; wait a tick.
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());

    // Three where() clauses: projectId equality + lat range.
    const calls = whereMock.mock.calls.map(([f, op]) => `${f} ${op}`);
    expect(calls).toContain('projectId ==');
    expect(calls).toContain('metadata.geo.lat >=');
    expect(calls).toContain('metadata.geo.lat <=');
  });

  it('filters out nodes outside the haversine radius even when inside the box', async () => {
    let emit: SnapCb | null = null;
    onSnapshotMock.mockImplementation((_q, ok) => {
      emit = ok;
      return () => {};
    });

    const { result } = renderHook(() =>
      useGeoAnchoredNodes({
        projectId: 'p1',
        center: { lat: 0, lng: 0 },
        radiusM: 100, // 100 m
      }),
    );

    await waitFor(() => expect(emit).toBeTruthy());

    // Two nodes — one inside 100 m (~10 m away) and one inside the
    // bounding box but outside the true 100 m radius (~150 m).
    // 1 deg lat ≈ 111_320 m; 0.0009 deg ≈ 100 m.
    act(() => {
      emit!({
        docs: [
          makeNodeDoc('inside', { lat: 0.00005, lng: 0 }), // ~5.5 m
          makeNodeDoc('corner', { lat: 0.0008, lng: 0.0008 }), // ~125 m diag
        ],
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const ids = result.current.nodes.map((n) => n.id);
    expect(ids).toContain('inside');
    expect(ids).not.toContain('corner');
  });

  it('respects the controlOnly + objectKind tag filters', async () => {
    let emit: SnapCb | null = null;
    onSnapshotMock.mockImplementation((_q, ok) => {
      emit = ok;
      return () => {};
    });

    const { result } = renderHook(() =>
      useGeoAnchoredNodes({
        projectId: 'p1',
        center: { lat: 0, lng: 0 },
        radiusM: 1000,
        objectKind: 'extinguisher_pqs',
        controlOnly: true,
      }),
    );

    await waitFor(() => expect(emit).toBeTruthy());

    act(() => {
      emit!({
        docs: [
          makeNodeDoc('a', { lat: 0, lng: 0 }, [
            'extinguisher_pqs',
            'installed',
            'control-material',
          ]),
          makeNodeDoc('b', { lat: 0, lng: 0 }, ['hydrant', 'control-material']),
          makeNodeDoc('c', { lat: 0, lng: 0 }, ['extinguisher_pqs']), // sin control-material
        ],
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const ids = result.current.nodes.map((n) => n.id);
    expect(ids).toEqual(['a']);
  });
});

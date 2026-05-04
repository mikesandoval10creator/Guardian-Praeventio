// Praeventio Guard — useArPlacement unit tests (Sprint 21 Ola 4 Bucket N).
//
// Exercise the pure runner `runArPlacementConfirm` directly — the hook
// is a thin React wrapper. Avoids needing jsdom/RTL.

import { describe, expect, it, vi } from 'vitest';

// Mock firebase before importing modules that pull `db` at import time.
vi.mock('../services/firebase', () => ({
  db: {} as unknown,
  auth: { currentUser: null } as unknown,
  collection: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
  onSnapshot: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__'),
}));

import {
  runArPlacementConfirm,
  AR_PLACEMENT_MIN_DELTA_M,
  type ArPlacementDeps,
} from './useArPlacement';
import type { PlacedObject } from '../services/digitalTwin/photogrammetry/types';

function makeObject(overrides: Partial<PlacedObject> = {}): PlacedObject {
  return {
    id: 'obj-1',
    kind: 'extinguisher_pqs',
    position: { x: 1, y: 0, z: 1 },
    lifecycle: 'installed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

interface DepSpies {
  updatePlacedObject: ReturnType<typeof vi.fn>;
  runLifecycle: ReturnType<typeof vi.fn>;
  meshToGeo: ReturnType<typeof vi.fn>;
}

function makeDeps(opts: {
  geo?: { lat: number; lng: number; altitudeM?: number } | null;
  updateThrows?: Error;
} = {}): { deps: ArPlacementDeps; spies: DepSpies } {
  const updatePlacedObject = opts.updateThrows
    ? vi.fn(async () => {
        throw opts.updateThrows;
      })
    : vi.fn(async () => undefined);
  const runLifecycle = vi.fn(async () => ({
    zkNodeSpec: null,
    calendarEventSpecs: [],
    userMessages: [],
  }));
  const meshToGeo = vi.fn(() => opts.geo ?? null);
  return {
    deps: {
      updatePlacedObject: updatePlacedObject as unknown as ArPlacementDeps['updatePlacedObject'],
      runLifecycle: runLifecycle as unknown as ArPlacementDeps['runLifecycle'],
      meshToGeo: meshToGeo as unknown as ArPlacementDeps['meshToGeo'],
    },
    spies: { updatePlacedObject, runLifecycle, meshToGeo },
  };
}

describe('runArPlacementConfirm', () => {
  it('delta < 10cm es no-op (no llama updatePlacedObject ni runLifecycle)', async () => {
    const obj = makeObject({ position: { x: 1, y: 0, z: 1 } });
    const { deps, spies } = makeDeps();

    // Delta de ~5 cm en x.
    const result = await runArPlacementConfirm(
      obj,
      { x: 1.05, y: 0, z: 1 },
      'proj-1',
      deps,
    );

    expect(result.committed).toBe(false);
    expect(result.reason).toBe('delta-below-threshold');
    expect(spies.updatePlacedObject).not.toHaveBeenCalled();
    expect(spies.runLifecycle).not.toHaveBeenCalled();
  });

  it('delta > 10cm dispara updatePlacedObject + transición lifecycle', async () => {
    const obj = makeObject({ position: { x: 1, y: 0, z: 1 } });
    const { deps, spies } = makeDeps();

    const newPos = { x: 2.5, y: 0, z: 1 }; // delta 1.5 m
    const result = await runArPlacementConfirm(obj, newPos, 'proj-1', deps);

    expect(result.committed).toBe(true);
    expect(spies.updatePlacedObject).toHaveBeenCalledTimes(1);
    expect(spies.updatePlacedObject).toHaveBeenCalledWith(
      'obj-1',
      expect.objectContaining({ position: newPos }),
      'proj-1',
    );
    expect(spies.runLifecycle).toHaveBeenCalledTimes(1);
    const [previous, next] = spies.runLifecycle.mock.calls[0];
    expect(previous.position).toEqual({ x: 1, y: 0, z: 1 });
    expect(next.position).toEqual(newPos);
    // mismo lifecycle (no entra a calendar events branch).
    expect(previous.lifecycle).toBe(next.lifecycle);
  });

  it('con geoAnchor → calcula y guarda nueva geo en el patch', async () => {
    const obj = makeObject({
      position: { x: 1, y: 0, z: 1 },
      geo: { lat: -33.45, lng: -70.66, altitudeM: 540 },
    });
    const computedGeo = { lat: -33.4501, lng: -70.6602, altitudeM: 541.5 };
    const { deps, spies } = makeDeps({ geo: computedGeo });

    const newPos = { x: 2.5, y: 1.5, z: 1 };
    await runArPlacementConfirm(obj, newPos, 'proj-1', deps);

    expect(spies.meshToGeo).toHaveBeenCalledWith(newPos);
    expect(spies.updatePlacedObject).toHaveBeenCalledWith(
      'obj-1',
      expect.objectContaining({ position: newPos, geo: computedGeo }),
      'proj-1',
    );
    const [, next] = spies.runLifecycle.mock.calls[0];
    expect(next.geo).toEqual(computedGeo);
  });

  it('sin geoAnchor → guarda solo position, no inyecta geo en el patch', async () => {
    const obj = makeObject({ position: { x: 0, y: 0, z: 0 } });
    const { deps, spies } = makeDeps({ geo: null });

    const newPos = { x: 1.2, y: 0, z: 0 };
    await runArPlacementConfirm(obj, newPos, 'proj-1', deps);

    expect(spies.updatePlacedObject).toHaveBeenCalledTimes(1);
    const [, patch] = spies.updatePlacedObject.mock.calls[0];
    expect(patch.position).toEqual(newPos);
    expect(patch.geo).toBeUndefined();
  });

  it('si updatePlacedObject falla → propaga el error y no corre lifecycle', async () => {
    const obj = makeObject();
    const { deps, spies } = makeDeps({ updateThrows: new Error('firestore-down') });

    const newPos = { x: obj.position.x + 1, y: obj.position.y, z: obj.position.z };
    await expect(
      runArPlacementConfirm(obj, newPos, 'proj-1', deps),
    ).rejects.toThrow('firestore-down');

    expect(spies.updatePlacedObject).toHaveBeenCalledTimes(1);
    expect(spies.runLifecycle).not.toHaveBeenCalled();
  });

  it('threshold expuesto = 10 cm', () => {
    expect(AR_PLACEMENT_MIN_DELTA_M).toBeCloseTo(0.1, 5);
  });
});

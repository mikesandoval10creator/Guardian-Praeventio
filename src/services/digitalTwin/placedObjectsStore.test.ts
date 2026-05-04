// SPDX-License-Identifier: MIT
//
// placedObjectsStore — unit tests con Firebase mockeado.
//
// No tocamos Firestore real — mockeamos los exports del barrel de
// `services/firebase` y verificamos que los CRUD invocan las primitivas
// con los argumentos esperados.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const setDocMock = vi.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const updateDocMock = vi.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const deleteDocMock = vi.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const onSnapshotMock = vi.fn<(...args: any[]) => () => void>();
const docMock = vi.fn<(db: unknown, path: string, id: string) => unknown>(
  (_db, path, id) => ({ __doc: `${path}/${id}` }),
);
const collectionMock = vi.fn<(db: unknown, path: string) => unknown>(
  (_db, path) => ({ __collection: path }),
);

vi.mock('../firebase', () => ({
  db: { __db: true },
  collection: (db: unknown, path: string) => collectionMock(db, path),
  doc: (db: unknown, path: string, id: string) => docMock(db, path, id),
  setDoc: (...args: any[]) => setDocMock(...args),
  updateDoc: (...args: any[]) => updateDocMock(...args),
  deleteDoc: (...args: any[]) => deleteDocMock(...args),
  onSnapshot: (...args: any[]) => onSnapshotMock(...args),
}));

import {
  savePlacedObject,
  subscribePlacedObjects,
  deletePlacedObject,
  updatePlacedObject,
} from './placedObjectsStore';
import type { PlacedObject } from './photogrammetry/types';

function makeObject(overrides: Partial<PlacedObject> = {}): PlacedObject {
  return {
    id: 'obj-1',
    kind: 'extinguisher_pqs',
    position: { x: 1, y: 0, z: 1 },
    lifecycle: 'planning',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  setDocMock.mockClear();
  updateDocMock.mockClear();
  deleteDocMock.mockClear();
  onSnapshotMock.mockReset();
  docMock.mockClear();
  collectionMock.mockClear();
});

describe('placedObjectsStore.savePlacedObject', () => {
  it('writes to projects/{projectId}/placed_objects/{obj.id} via setDoc with merge', async () => {
    const obj = makeObject({ id: 'ext-42' });
    await savePlacedObject(obj, 'proj-A');

    expect(docMock).toHaveBeenCalledWith(
      expect.anything(),
      'projects/proj-A/placed_objects',
      'ext-42',
    );
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const call = setDocMock.mock.calls[0]!;
    const payload = call[1] as Record<string, unknown>;
    const options = call[2];
    expect(payload).toMatchObject({ id: 'ext-42', kind: 'extinguisher_pqs' });
    expect(typeof payload.updatedAt).toBe('number');
    expect(options).toEqual({ merge: true });
  });

  it('rechaza projectId vacío', async () => {
    await expect(savePlacedObject(makeObject(), '')).rejects.toThrow(/projectId/);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rechaza obj.id vacío', async () => {
    await expect(
      savePlacedObject({ ...makeObject(), id: '' }, 'proj-A'),
    ).rejects.toThrow(/obj\.id/);
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('placedObjectsStore.updatePlacedObject', () => {
  it('aplica el patch + updatedAt al doc correcto', async () => {
    await updatePlacedObject('ext-42', { lifecycle: 'installed' }, 'proj-A');

    expect(docMock).toHaveBeenCalledWith(
      expect.anything(),
      'projects/proj-A/placed_objects',
      'ext-42',
    );
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const payload = updateDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).toMatchObject({ lifecycle: 'installed' });
    expect(typeof payload.updatedAt).toBe('number');
  });

  it('elimina campos undefined del patch antes de escribir', async () => {
    await updatePlacedObject(
      'ext-42',
      { lifecycle: 'active', notes: undefined as unknown as string },
      'proj-A',
    );
    const payload = updateDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('notes');
    expect(payload).toMatchObject({ lifecycle: 'active' });
  });
});

describe('placedObjectsStore.deletePlacedObject', () => {
  it('llama deleteDoc con el path/id correctos', async () => {
    await deletePlacedObject('ext-42', 'proj-A');
    expect(docMock).toHaveBeenCalledWith(
      expect.anything(),
      'projects/proj-A/placed_objects',
      'ext-42',
    );
    expect(deleteDocMock).toHaveBeenCalledTimes(1);
  });
});

describe('placedObjectsStore.subscribePlacedObjects', () => {
  it('hidrata snapshot a array de PlacedObject e invoca el callback', () => {
    const docs = [
      { id: 'a', data: () => makeObject({ id: 'a' }) },
      { id: 'b', data: () => makeObject({ id: 'b', lifecycle: 'installed' }) },
    ];
    const fakeSnap = { forEach: (fn: (d: any) => void) => docs.forEach(fn) };
    let capturedSuccess: ((s: unknown) => void) | null = null;
    onSnapshotMock.mockImplementation((_ref: unknown, success: any) => {
      capturedSuccess = success;
      return () => undefined;
    });

    const onSnap = vi.fn();
    const unsub = subscribePlacedObjects('proj-A', onSnap);

    expect(collectionMock).toHaveBeenCalledWith(
      expect.anything(),
      'projects/proj-A/placed_objects',
    );
    expect(typeof unsub).toBe('function');
    capturedSuccess!(fakeSnap);

    expect(onSnap).toHaveBeenCalledTimes(1);
    const list = onSnap.mock.calls[0]![0] as PlacedObject[];
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'a' });
    expect(list[1]).toMatchObject({ id: 'b', lifecycle: 'installed' });
  });

  it('projectId vacío → callback recibe [] y unsubscribe es noop', () => {
    const onSnap = vi.fn();
    const unsub = subscribePlacedObjects('', onSnap);
    expect(onSnap).toHaveBeenCalledWith([]);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('error de suscripción invoca onError y emite [] al callback', () => {
    let capturedError: ((e: Error) => void) | null = null;
    onSnapshotMock.mockImplementation((_ref: unknown, _success: any, errCb: any) => {
      capturedError = errCb;
      return () => undefined;
    });
    const onSnap = vi.fn();
    const onError = vi.fn();
    subscribePlacedObjects('proj-A', onSnap, onError);
    capturedError!(new Error('permission-denied'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSnap).toHaveBeenCalledWith([]);
  });
});

import { describe, it, expect } from 'vitest';
import { SplatCaptureAdapter } from './gaussianSplatFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { SplatCapture } from './gaussianSplatRegistry.js';

function capture(over: Partial<SplatCapture> & { id: string }): SplatCapture {
  return {
    id: over.id,
    projectId: 'p1',
    capturedAt: over.capturedAt ?? '2026-05-11T10:00:00Z',
    capturedByUid: 'u1',
    format: over.format ?? 'splat',
    storageUrl: 'gs://x.splat',
    sizeBytes: 50_000_000,
    splatCount: 1_500_000,
    extentMeters: 100,
    centerCoords: { lat: -33.45, lng: -70.66 },
    isCanonical: over.isCanonical ?? false,
  };
}

describe('SplatCaptureAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new SplatCaptureAdapter(db, 't1', 'p1');
    await a.save(capture({ id: 'c1' }));
    expect((await a.getById('c1'))?.id).toBe('c1');
  });

  it('listRecent desc por capturedAt', async () => {
    const db = createFakeFirestore();
    const a = new SplatCaptureAdapter(db, 't1', 'p1');
    await a.save(capture({ id: 'old', capturedAt: '2026-04-01T00:00:00Z' }));
    await a.save(capture({ id: 'new', capturedAt: '2026-05-11T00:00:00Z' }));
    const list = await a.listRecent();
    expect(list[0].id).toBe('new');
  });

  it('getCanonical devuelve null si no hay', async () => {
    const db = createFakeFirestore();
    const a = new SplatCaptureAdapter(db, 't1', 'p1');
    await a.save(capture({ id: 'c1' }));
    expect(await a.getCanonical()).toBeNull();
  });

  it('getCanonical devuelve la marcada', async () => {
    const db = createFakeFirestore();
    const a = new SplatCaptureAdapter(db, 't1', 'p1');
    await a.save(capture({ id: 'c1', isCanonical: true }));
    expect((await a.getCanonical())?.id).toBe('c1');
  });

  it('setCanonical desmarca anteriores atomicamente', async () => {
    const db = createFakeFirestore();
    const a = new SplatCaptureAdapter(db, 't1', 'p1');
    await a.save(capture({ id: 'old-canonical', isCanonical: true }));
    await a.save(capture({ id: 'new-canonical' }));
    await a.setCanonical('new-canonical');
    expect((await a.getById('old-canonical'))?.isCanonical).toBe(false);
    expect((await a.getById('new-canonical'))?.isCanonical).toBe(true);
  });

  it('listByFormat filtra', async () => {
    const db = createFakeFirestore();
    const a = new SplatCaptureAdapter(db, 't1', 'p1');
    await a.save(capture({ id: 'ply', format: 'ply' }));
    await a.save(capture({ id: 'splat', format: 'splat' }));
    expect((await a.listByFormat('ply'))[0].id).toBe('ply');
  });
});

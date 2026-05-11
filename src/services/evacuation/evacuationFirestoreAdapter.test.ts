import { describe, it, expect } from 'vitest';
import { EvacuationAdapter } from './evacuationFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { EvacuationDrill } from './evacuationHeadcount.js';

const NOW = '2026-05-11T12:00:00Z';

function makeDrill(id = 'd1'): EvacuationDrill {
  return {
    id,
    projectId: 'p1',
    kind: 'drill',
    startedAt: NOW,
    startedByUid: 'sup-1',
    meetingPointId: 'mp-1',
    expectedWorkers: [
      { uid: 'w1', fullName: 'Juan' },
      { uid: 'w2', fullName: 'María' },
    ],
    scans: [],
  };
}

describe('EvacuationAdapter', () => {
  it('startDrill + getDrill devuelve drill sin scans', async () => {
    const db = createFakeFirestore();
    const a = new EvacuationAdapter(db, 't1', 'p1');
    await a.startDrill(makeDrill());
    const got = await a.getDrill('d1');
    expect(got?.id).toBe('d1');
    expect(got?.scans).toEqual([]);
  });

  it('addScan idempotente: re-escaneo no duplica', async () => {
    const db = createFakeFirestore();
    const a = new EvacuationAdapter(db, 't1', 'p1');
    await a.startDrill(makeDrill());
    await a.addScan('d1', {
      workerUid: 'w1',
      meetingPointId: 'mp-1',
      scannedByUid: 'w1',
      scannedAt: NOW,
    });
    await a.addScan('d1', {
      workerUid: 'w1',
      meetingPointId: 'mp-1',
      scannedByUid: 'w1',
      scannedAt: '2026-05-11T13:00:00Z',
    });
    const got = await a.getDrill('d1');
    expect(got?.scans).toHaveLength(1);
  });

  it('getDrill carga scans de subcollection', async () => {
    const db = createFakeFirestore();
    const a = new EvacuationAdapter(db, 't1', 'p1');
    await a.startDrill(makeDrill());
    await a.addScan('d1', {
      workerUid: 'w1',
      meetingPointId: 'mp-1',
      scannedByUid: 'w1',
      scannedAt: NOW,
    });
    await a.addScan('d1', {
      workerUid: 'w2',
      meetingPointId: 'mp-1',
      scannedByUid: 'w2',
      scannedAt: NOW,
    });
    const got = await a.getDrill('d1');
    expect(got?.scans).toHaveLength(2);
  });

  it('endDrill marca endedAt', async () => {
    const db = createFakeFirestore();
    const a = new EvacuationAdapter(db, 't1', 'p1');
    await a.startDrill(makeDrill());
    await a.endDrill('d1', '2026-05-11T13:00:00Z');
    const got = await a.getDrill('d1');
    expect(got?.endedAt).toBe('2026-05-11T13:00:00Z');
  });

  it('listRecent ordena por startedAt desc', async () => {
    const db = createFakeFirestore();
    const a = new EvacuationAdapter(db, 't1', 'p1');
    await a.startDrill({ ...makeDrill('old'), startedAt: '2026-05-10T08:00:00Z' });
    await a.startDrill({ ...makeDrill('new'), startedAt: '2026-05-11T12:00:00Z' });
    const list = await a.listRecent();
    expect(list[0].id).toBe('new');
  });
});

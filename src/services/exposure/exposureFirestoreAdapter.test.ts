import { describe, it, expect } from 'vitest';
import { ExposureAdapter } from './exposureFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { ExposureMeasurement } from './exposureRegistry.js';

function makeMeasurement(over: Partial<ExposureMeasurement> = {}): ExposureMeasurement {
  return {
    id: over.id ?? 'm1',
    workerUid: over.workerUid ?? 'w1',
    agent: over.agent ?? 'noise',
    value: over.value ?? 88,
    unit: over.unit ?? 'dB(A)',
    location: over.location ?? 'Sector A',
    durationHours: over.durationHours ?? 8,
    takenAt: over.takenAt ?? '2026-05-11T10:00:00Z',
    measuredByUid: over.measuredByUid ?? 'tec-1',
  };
}

describe('ExposureAdapter', () => {
  it('save + getById persiste y recupera medición', async () => {
    const db = createFakeFirestore();
    const a = new ExposureAdapter(db, 't1', 'p1');
    const m = makeMeasurement();
    await a.save(m);
    const got = await a.getById('m1');
    expect(got?.id).toBe('m1');
    expect(got?.agent).toBe('noise');
    expect(got?.value).toBe(88);
  });

  it('getById devuelve null si no existe', async () => {
    const db = createFakeFirestore();
    const a = new ExposureAdapter(db, 't1', 'p1');
    expect(await a.getById('missing')).toBeNull();
  });

  it('listForWorker filtra por workerUid y ordena por takenAt desc', async () => {
    const db = createFakeFirestore();
    const a = new ExposureAdapter(db, 't1', 'p1');
    await a.save(makeMeasurement({ id: 'm1', workerUid: 'w1', takenAt: '2026-05-10T08:00:00Z' }));
    await a.save(makeMeasurement({ id: 'm2', workerUid: 'w1', takenAt: '2026-05-11T10:00:00Z' }));
    await a.save(makeMeasurement({ id: 'm3', workerUid: 'w2', takenAt: '2026-05-11T11:00:00Z' }));
    const list = await a.listForWorker('w1');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('m2'); // más reciente primero
    expect(list[1].id).toBe('m1');
  });

  it('listForWorker filtra adicionalmente por agent si se pasa', async () => {
    const db = createFakeFirestore();
    const a = new ExposureAdapter(db, 't1', 'p1');
    await a.save(makeMeasurement({ id: 'm1', workerUid: 'w1', agent: 'noise' }));
    await a.save(makeMeasurement({ id: 'm2', workerUid: 'w1', agent: 'silica' }));
    const list = await a.listForWorker('w1', 'silica');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('m2');
  });

  it('listByAgent filtra por agent y ordena por takenAt desc', async () => {
    const db = createFakeFirestore();
    const a = new ExposureAdapter(db, 't1', 'p1');
    await a.save(makeMeasurement({ id: 'm1', agent: 'noise', takenAt: '2026-05-10T08:00:00Z' }));
    await a.save(makeMeasurement({ id: 'm2', agent: 'noise', takenAt: '2026-05-11T10:00:00Z' }));
    await a.save(makeMeasurement({ id: 'm3', agent: 'silica', takenAt: '2026-05-11T11:00:00Z' }));
    const list = await a.listByAgent('noise');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('m2');
    expect(list[1].id).toBe('m1');
  });
});

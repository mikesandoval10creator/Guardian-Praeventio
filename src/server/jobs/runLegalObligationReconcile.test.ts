import { describe, it, expect } from 'vitest';
import type adminNs from 'firebase-admin';
import { runLegalObligationReconcile } from './runLegalObligationReconcile.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const NOW = () => new Date('2026-06-15T12:00:00Z');

// The job's `db` dep is typed as the full Admin Firestore; the in-memory fake
// implements only the surface the job exercises. Cast at the seam (type-safe,
// no `as any` so the ratchet is untouched).
const asFirestore = (db: ReturnType<typeof createFakeFirestore>) =>
  db as unknown as adminNs.firestore.Firestore;

function seedProj(
  db: ReturnType<typeof createFakeFirestore>,
  overrides: Record<string, unknown> = {},
) {
  db._seed('projects/p1', {
    workersCount: 30,
    country: 'CL',
    metadata: { sectorId: 'GP-CONS-RES', codigoActividadSii: 410010 },
    ...overrides,
  });
}

describe('runLegalObligationReconcile', () => {
  it('materialises the CPHS obligations a 30-worker CL project requires (none seeded yet)', async () => {
    const db = createFakeFirestore();
    seedProj(db);
    const r = await runLegalObligationReconcile({ db: asFirestore(db), projectId: 'p1', now: NOW });
    expect(r.created.length).toBeGreaterThan(0);
    expect(r.created.some((id) => /cphs/i.test(id))).toBe(true);
    const stored = await db
      .collection('projects')
      .doc('p1')
      .collection('legal_obligations')
      .get();
    expect(stored.size).toBe(r.created.length);
  });

  it('is idempotent: a second run creates nothing', async () => {
    const db = createFakeFirestore();
    seedProj(db);
    await runLegalObligationReconcile({ db: asFirestore(db), projectId: 'p1', now: NOW });
    const r2 = await runLegalObligationReconcile({ db: asFirestore(db), projectId: 'p1', now: NOW });
    expect(r2.created).toEqual([]);
    expect(r2.alreadyPresent).toBeGreaterThan(0);
  });

  it('crossing 99→100 adds only the Departamento de Prevención obligation', async () => {
    const db = createFakeFirestore();
    seedProj(db, { workersCount: 99 });
    await runLegalObligationReconcile({ db: asFirestore(db), projectId: 'p1', now: NOW }); // seeds CPHS
    await db.collection('projects').doc('p1').set({ workersCount: 100 }, { merge: true });
    const r = await runLegalObligationReconcile({ db: asFirestore(db), projectId: 'p1', now: NOW });
    expect(r.created.length).toBe(1);
    expect(r.created.some((id) => /depto-prevencion/i.test(id))).toBe(true);
  });

  it('skips non-CL projects (dotación law is Chilean)', async () => {
    const db = createFakeFirestore();
    seedProj(db, { country: 'AR', workersCount: 200 });
    const r = await runLegalObligationReconcile({ db: asFirestore(db), projectId: 'p1', now: NOW });
    expect(r.skippedNonChile).toBe(true);
    expect(r.created).toEqual([]);
  });

  it('skips a project with no usable headcount instead of materialising nothing silently', async () => {
    const db = createFakeFirestore();
    seedProj(db, { workersCount: undefined });
    const r = await runLegalObligationReconcile({ db: asFirestore(db), projectId: 'p1', now: NOW });
    expect(r.skippedNoHeadcount).toBe(true);
  });

  it('skips a missing project doc without throwing (one bad doc must not abort the run)', async () => {
    const db = createFakeFirestore();
    const r = await runLegalObligationReconcile({ db: asFirestore(db), projectId: 'ghost', now: NOW });
    expect(r.skippedNoHeadcount).toBe(true);
    expect(r.created).toEqual([]);
  });
});

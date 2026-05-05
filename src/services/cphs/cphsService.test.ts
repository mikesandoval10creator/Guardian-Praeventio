// Praeventio Guard — Sprint 28 Bucket B5: CPHS service tests.
//
// In-memory Firestore fake con soporte para 2 colecciones (committees +
// meetings). Mismo patrón DI que `services/curriculum/claims.test.ts`.

import { describe, it, expect } from 'vitest';
import {
  createCommittee,
  getCommittee,
  listCommittees,
  scheduleMeeting,
  recordMinutes,
  signMinutes,
  getNextScheduledMeeting,
  listMeetings,
  CphsQuorumError,
  CphsImmutableMinutesError,
  CphsSignatureError,
  type MinimalCphsDb,
} from './cphsService.js';
import type { CphsMember } from './types.js';

// ───────────────────────────────────────────────────────────────────────
// Test doubles
// ───────────────────────────────────────────────────────────────────────

function makeDb(): { db: MinimalCphsDb; stores: Record<string, Map<string, any>> } {
  const stores: Record<string, Map<string, any>> = {
    cphs_committees: new Map(),
    cphs_meetings: new Map(),
  };
  let counter = 0;

  const collection = (name: string) => {
    if (!stores[name]) stores[name] = new Map();
    const store = stores[name];
    return {
      add: async (data: any) => {
        counter += 1;
        const id = `${name}-${counter}`;
        store.set(id, { ...data, id });
        return { id };
      },
      doc: (id: string) => ({
        get: async () => ({
          exists: store.has(id),
          id,
          data: () => store.get(id),
        }),
        update: async (patch: any) => {
          const existing = store.get(id);
          if (!existing) throw new Error(`doc ${id} not found in ${name}`);
          store.set(id, { ...existing, ...patch });
        },
      }),
      where: (field: string, op: string, value: any) => {
        expect(op).toBe('==');
        return {
          get: async () => {
            const docs = Array.from(store.values())
              .filter((d) => (d as any)[field] === value)
              .map((d) => ({ id: d.id, data: () => d }));
            return { empty: docs.length === 0, docs };
          },
        };
      },
    };
  };

  return { db: { collection } as unknown as MinimalCphsDb, stores };
}

// ───────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────

function makeValidMembers(): CphsMember[] {
  return [
    { uid: 'emp1', fullName: 'Empleador 1', role: 'chair', side: 'employer', elected: false },
    { uid: 'emp2', fullName: 'Empleador 2', role: 'representative', side: 'employer', elected: false },
    { uid: 'emp3', fullName: 'Empleador 3', role: 'representative', side: 'employer', elected: false },
    { uid: 'wrk1', fullName: 'Trabajador 1', role: 'secretary', side: 'worker', elected: true },
    { uid: 'wrk2', fullName: 'Trabajador 2', role: 'representative', side: 'worker', elected: true },
    { uid: 'wrk3', fullName: 'Trabajador 3', role: 'representative', side: 'worker', elected: true },
  ];
}

const validPeriod = { start: '2026-01-01', end: '2028-01-01' };

// ───────────────────────────────────────────────────────────────────────
// createCommittee
// ───────────────────────────────────────────────────────────────────────

describe('createCommittee', () => {
  it('crea un comité con quórum DS 54 válido y status active', async () => {
    const { db, stores } = makeDb();
    const committee = await createCommittee(
      { projectId: 'p1', members: makeValidMembers(), period: validPeriod, createdBy: 'admin1' },
      db,
    );
    expect(committee.id).toBeTruthy();
    expect(committee.status).toBe('active');
    expect(committee.iso45001Compliance).toBe(true);
    expect(stores.cphs_committees.size).toBe(1);
  });

  it('rechaza si hay menos de 3 representantes empleador', async () => {
    const { db } = makeDb();
    const members = makeValidMembers().filter((m, i) => !(m.side === 'employer' && i >= 1));
    await expect(
      createCommittee({ projectId: 'p1', members, period: validPeriod, createdBy: 'admin1' }, db),
    ).rejects.toBeInstanceOf(CphsQuorumError);
  });

  it('rechaza si los trabajadores no son elegidos (workersAreElected falla → flag false)', async () => {
    const { db } = makeDb();
    const members = makeValidMembers().map((m) =>
      m.side === 'worker' ? { ...m, elected: false } : m,
    );
    const committee = await createCommittee(
      { projectId: 'p1', members, period: validPeriod, createdBy: 'admin1' },
      db,
    );
    // Quórum estructural sí cumple, pero ISO 45001 marca false al no haber sufragio.
    expect(committee.iso45001Compliance).toBe(false);
  });

  it('rechaza si period.end <= period.start', async () => {
    const { db } = makeDb();
    await expect(
      createCommittee(
        {
          projectId: 'p1',
          members: makeValidMembers(),
          period: { start: '2028-01-01', end: '2026-01-01' },
          createdBy: 'admin1',
        },
        db,
      ),
    ).rejects.toThrow(/period.end/);
  });

  it('rechaza si no hay chair y secretary', async () => {
    const { db } = makeDb();
    const members = makeValidMembers().map((m) =>
      m.role === 'chair' || m.role === 'secretary'
        ? { ...m, role: 'representative' as const }
        : m,
    );
    await expect(
      createCommittee({ projectId: 'p1', members, period: validPeriod, createdBy: 'admin1' }, db),
    ).rejects.toBeInstanceOf(CphsQuorumError);
  });
});

// ───────────────────────────────────────────────────────────────────────
// getCommittee + listCommittees
// ───────────────────────────────────────────────────────────────────────

describe('listCommittees / getCommittee', () => {
  it('listCommittees devuelve sólo los comités del proyecto pedido', async () => {
    const { db } = makeDb();
    await createCommittee(
      { projectId: 'p1', members: makeValidMembers(), period: validPeriod, createdBy: 'a' },
      db,
    );
    await createCommittee(
      { projectId: 'p2', members: makeValidMembers(), period: validPeriod, createdBy: 'a' },
      db,
    );
    const p1 = await listCommittees('p1', db);
    expect(p1).toHaveLength(1);
    expect(p1[0].projectId).toBe('p1');
  });

  it('getCommittee devuelve null cuando no existe', async () => {
    const { db } = makeDb();
    const c = await getCommittee('nope', db);
    expect(c).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
// scheduleMeeting
// ───────────────────────────────────────────────────────────────────────

describe('scheduleMeeting', () => {
  it('agenda una reunión futura con status=scheduled', async () => {
    const { db } = makeDb();
    const committee = await createCommittee(
      { projectId: 'p1', members: makeValidMembers(), period: validPeriod, createdBy: 'a' },
      db,
    );
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const meeting = await scheduleMeeting(
      { committeeId: committee.id, scheduledAt: future, agenda: ['Constitución', 'Riesgos críticos'] },
      db,
    );
    expect(meeting.status).toBe('scheduled');
    expect(meeting.agenda).toHaveLength(2);
    expect(meeting.signatures).toEqual([]);
  });

  it('rechaza agenda vacía', async () => {
    const { db } = makeDb();
    const committee = await createCommittee(
      { projectId: 'p1', members: makeValidMembers(), period: validPeriod, createdBy: 'a' },
      db,
    );
    await expect(
      scheduleMeeting(
        { committeeId: committee.id, scheduledAt: new Date().toISOString(), agenda: [] },
        db,
      ),
    ).rejects.toThrow(/agenda/);
  });
});

// ───────────────────────────────────────────────────────────────────────
// recordMinutes
// ───────────────────────────────────────────────────────────────────────

describe('recordMinutes', () => {
  it('escribe minutes + resolutions y deja status=held', async () => {
    const { db } = makeDb();
    const committee = await createCommittee(
      { projectId: 'p1', members: makeValidMembers(), period: validPeriod, createdBy: 'a' },
      db,
    );
    const meeting = await scheduleMeeting(
      { committeeId: committee.id, scheduledAt: new Date().toISOString(), agenda: ['x'] },
      db,
    );
    const updated = await recordMinutes(
      {
        meetingId: meeting.id,
        minutes: '## Acta\nRevisamos riesgos críticos.',
        resolutions: [
          { id: 'r1', topic: 'Compra de EPP', vote: { for: 5, against: 0, abstain: 1 }, outcome: 'approved' },
        ],
        attendees: ['emp1', 'emp2', 'wrk1', 'wrk2'],
      },
      db,
    );
    expect(updated.status).toBe('held');
    expect(updated.heldAt).toBeTruthy();
    expect(updated.resolutions).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────
// signMinutes
// ───────────────────────────────────────────────────────────────────────

describe('signMinutes', () => {
  async function bootstrapHeldMeeting() {
    const { db, stores } = makeDb();
    const committee = await createCommittee(
      { projectId: 'p1', members: makeValidMembers(), period: validPeriod, createdBy: 'a' },
      db,
    );
    const meeting = await scheduleMeeting(
      { committeeId: committee.id, scheduledAt: new Date().toISOString(), agenda: ['x'] },
      db,
    );
    await recordMinutes(
      {
        meetingId: meeting.id,
        minutes: 'Acta',
        resolutions: [],
        attendees: ['emp1', 'wrk1'],
      },
      db,
    );
    return { db, stores, meetingId: meeting.id };
  }

  it('firma cuando el uid está en attendees con credential + signature válidos', async () => {
    const { db, stores, meetingId } = await bootstrapHeldMeeting();
    await signMinutes(meetingId, 'emp1', 'cred-emp1', 'sig-base64', db);
    const m = stores.cphs_meetings.get(meetingId);
    expect(m.signatures).toHaveLength(1);
    expect(m.signatures[0].uid).toBe('emp1');
  });

  it('rechaza si el uid no está en attendees', async () => {
    const { db, meetingId } = await bootstrapHeldMeeting();
    await expect(
      signMinutes(meetingId, 'wrk2', 'cred-wrk2', 'sig', db),
    ).rejects.toBeInstanceOf(CphsSignatureError);
  });

  it('rechaza doble firma del mismo uid (idempotencia)', async () => {
    const { db, meetingId } = await bootstrapHeldMeeting();
    await signMinutes(meetingId, 'emp1', 'cred', 'sig', db);
    await expect(
      signMinutes(meetingId, 'emp1', 'cred', 'sig', db),
    ).rejects.toBeInstanceOf(CphsSignatureError);
  });

  it('recordMinutes rechaza si ya hay al menos una firma (immutable)', async () => {
    const { db, meetingId } = await bootstrapHeldMeeting();
    await signMinutes(meetingId, 'emp1', 'cred', 'sig', db);
    await expect(
      recordMinutes(
        { meetingId, minutes: 'modificado', resolutions: [], attendees: ['emp1'] },
        db,
      ),
    ).rejects.toBeInstanceOf(CphsImmutableMinutesError);
  });

  it('rechaza firma sin credentialId', async () => {
    const { db, meetingId } = await bootstrapHeldMeeting();
    await expect(
      signMinutes(meetingId, 'emp1', '', 'sig', db),
    ).rejects.toBeInstanceOf(CphsSignatureError);
  });
});

// ───────────────────────────────────────────────────────────────────────
// getNextScheduledMeeting
// ───────────────────────────────────────────────────────────────────────

describe('getNextScheduledMeeting', () => {
  it('devuelve la reunión futura más próxima del comité', async () => {
    const { db } = makeDb();
    const committee = await createCommittee(
      { projectId: 'p1', members: makeValidMembers(), period: validPeriod, createdBy: 'a' },
      db,
    );
    const t1 = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString();
    const t2 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await scheduleMeeting({ committeeId: committee.id, scheduledAt: t2, agenda: ['lejana'] }, db);
    await scheduleMeeting({ committeeId: committee.id, scheduledAt: t1, agenda: ['cercana'] }, db);

    const next = await getNextScheduledMeeting(committee.id, db);
    expect(next).not.toBeNull();
    expect(next!.scheduledAt).toBe(t1);
  });

  it('devuelve null cuando no hay reuniones futuras scheduled', async () => {
    const { db } = makeDb();
    const committee = await createCommittee(
      { projectId: 'p1', members: makeValidMembers(), period: validPeriod, createdBy: 'a' },
      db,
    );
    const next = await getNextScheduledMeeting(committee.id, db);
    expect(next).toBeNull();
  });

  it('listMeetings ordena descendente por scheduledAt', async () => {
    const { db } = makeDb();
    const committee = await createCommittee(
      { projectId: 'p1', members: makeValidMembers(), period: validPeriod, createdBy: 'a' },
      db,
    );
    const t1 = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString();
    const t2 = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    await scheduleMeeting({ committeeId: committee.id, scheduledAt: t1, agenda: ['a'] }, db);
    await scheduleMeeting({ committeeId: committee.id, scheduledAt: t2, agenda: ['b'] }, db);
    const all = await listMeetings(committee.id, db);
    expect(all).toHaveLength(2);
    expect(Date.parse(all[0].scheduledAt)).toBeGreaterThan(Date.parse(all[1].scheduledAt));
  });
});

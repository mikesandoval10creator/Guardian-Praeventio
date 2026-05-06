// Sprint 32 wire W4 — verifica que recordMinutes y signMinutes invocan
// awardXp con el reason correcto. Fire-and-forget: si awardXp tira, el
// path principal NO se rompe.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const awardXpMock = vi.fn();
vi.mock('../gamification/positiveXp.js', () => ({
  awardXp: (...args: unknown[]) => awardXpMock(...args),
}));

import {
  createCommittee,
  scheduleMeeting,
  recordMinutes,
  signMinutes,
  type MinimalCphsDb,
} from './cphsService.js';
import type { CphsMember } from './types.js';

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
        get: async () => ({ exists: store.has(id), id, data: () => store.get(id) }),
        update: async (patch: any) => {
          const existing = store.get(id);
          if (!existing) throw new Error(`doc ${id} not found in ${name}`);
          store.set(id, { ...existing, ...patch });
        },
      }),
      where: (_field: string, _op: string, value: any) => ({
        get: async () => {
          const docs = Array.from(store.values())
            .filter((d) => (d as any)[_field] === value)
            .map((d) => ({ id: d.id, data: () => d }));
          return { empty: docs.length === 0, docs };
        },
      }),
    };
  };
  return { db: { collection } as unknown as MinimalCphsDb, stores };
}

function makeMembers(): CphsMember[] {
  return [
    { uid: 'emp1', fullName: 'E1', role: 'chair', side: 'employer', elected: false },
    { uid: 'emp2', fullName: 'E2', role: 'representative', side: 'employer', elected: false },
    { uid: 'emp3', fullName: 'E3', role: 'representative', side: 'employer', elected: false },
    { uid: 'wrk1', fullName: 'W1', role: 'secretary', side: 'worker', elected: true },
    { uid: 'wrk2', fullName: 'W2', role: 'representative', side: 'worker', elected: true },
    { uid: 'wrk3', fullName: 'W3', role: 'representative', side: 'worker', elected: true },
  ];
}

const period = { start: '2026-01-01', end: '2028-01-01' };

beforeEach(() => {
  awardXpMock.mockReset();
});

describe('cphsService — XP hook', () => {
  it('recordMinutes awards cphs_session_attended for each attendee', async () => {
    const { db } = makeDb();
    const c = await createCommittee(
      { projectId: 'p1', members: makeMembers(), period, createdBy: 'admin' },
      db,
    );
    const meeting = await scheduleMeeting(
      { committeeId: c.id, scheduledAt: '2026-06-01T15:00:00Z', agenda: ['t1'] },
      db,
    );
    await recordMinutes(
      {
        meetingId: meeting.id,
        minutes: 'acta',
        resolutions: [],
        attendees: ['wrk1', 'wrk2'],
      },
      db,
    );

    const calls = awardXpMock.mock.calls.filter((c) => c[0] === 'cphs_session_attended');
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('cphs_session_attended');
    expect(calls[0][2]).toMatchObject({ attendeeUid: 'wrk1', meetingId: meeting.id });
  });

  it('signMinutes awards cphs_acta_signed once for the signer', async () => {
    const { db } = makeDb();
    const c = await createCommittee(
      { projectId: 'p1', members: makeMembers(), period, createdBy: 'admin' },
      db,
    );
    const meeting = await scheduleMeeting(
      { committeeId: c.id, scheduledAt: '2026-06-01T15:00:00Z', agenda: ['t1'] },
      db,
    );
    await recordMinutes(
      { meetingId: meeting.id, minutes: 'acta', resolutions: [], attendees: ['wrk1'] },
      db,
    );
    awardXpMock.mockReset();

    await signMinutes(meeting.id, 'wrk1', 'cred-1', 'sigB64', db);

    const signCalls = awardXpMock.mock.calls.filter((c) => c[0] === 'cphs_acta_signed');
    expect(signCalls).toHaveLength(1);
    expect(signCalls[0][2]).toMatchObject({ uid: 'wrk1', meetingId: meeting.id });
  });

  it('does not break recordMinutes if awardXp throws', async () => {
    awardXpMock.mockImplementation(() => {
      throw new Error('boom');
    });
    const { db } = makeDb();
    const c = await createCommittee(
      { projectId: 'p1', members: makeMembers(), period, createdBy: 'admin' },
      db,
    );
    const meeting = await scheduleMeeting(
      { committeeId: c.id, scheduledAt: '2026-06-01T15:00:00Z', agenda: ['t1'] },
      db,
    );
    // No throw — fire-and-forget swallows.
    await expect(
      recordMinutes(
        { meetingId: meeting.id, minutes: 'acta', resolutions: [], attendees: ['wrk1'] },
        db,
      ),
    ).resolves.toBeDefined();
  });
});

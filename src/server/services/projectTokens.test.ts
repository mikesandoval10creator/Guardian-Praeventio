import { afterEach, describe, it, expect } from 'vitest';
import {
  LONE_WORKER_ROLE_BUCKETS,
  __clearProjectTokenCache,
  resolveProjectMemberTokens,
} from './projectTokens.js';

afterEach(() => {
  __clearProjectTokenCache();
});

function buildDb(opts: {
  members: Array<{
    uid: string;
    role?: string;
    legacyFcmToken?: string;
    email?: string;
    userFcmTokens?: string[];
    userReadShouldFail?: boolean;
  }>;
  membersReadShouldFail?: boolean;
}) {
  return {
    collection(name: string) {
      if (name === 'projects') {
        return {
          doc(_pid: string) {
            return {
              collection(sub: string) {
                if (sub !== 'members') throw new Error(`unexpected subcoll ${sub}`);
                return {
                  async get() {
                    if (opts.membersReadShouldFail) throw new Error('members boom');
                    return {
                      docs: opts.members.map((m) => ({
                        id: m.uid,
                        data: () => ({
                          role: m.role,
                          fcmToken: m.legacyFcmToken,
                          email: m.email,
                        }),
                      })),
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (name === 'users') {
        return {
          doc(uid: string) {
            const m = opts.members.find((x) => x.uid === uid);
            return {
              async get() {
                if (m?.userReadShouldFail) throw new Error('user read boom');
                return {
                  exists: Boolean(m?.userFcmTokens),
                  data: () => ({ fcmTokens: m?.userFcmTokens ?? [] }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as any;
}

describe('resolveProjectMemberTokens', () => {
  it('vacío cuando no hay members', async () => {
    const db = buildDb({ members: [] });
    const r = await resolveProjectMemberTokens('p1', new Set(['supervisor']), db);
    expect(r.tokens).toEqual([]);
    expect(r.emails).toEqual([]);
    expect(r.memberCount).toBe(0);
    expect(r.matchedCount).toBe(0);
  });

  it('filtra por role: solo members con role en el set incluyen sus tokens', async () => {
    const db = buildDb({
      members: [
        { uid: 'u1', role: 'supervisor', userFcmTokens: ['tok-A'] },
        { uid: 'u2', role: 'worker', userFcmTokens: ['tok-B'] },
        { uid: 'u3', role: 'gerente', userFcmTokens: ['tok-C'] },
      ],
    });
    const r = await resolveProjectMemberTokens(
      'p1',
      new Set(['supervisor', 'gerente']),
      db,
    );
    expect(r.tokens.sort()).toEqual(['tok-A', 'tok-C']);
    expect(r.matchedCount).toBe(2);
    expect(r.memberCount).toBe(3);
  });

  it('union legacy fcmToken (singular) + users.fcmTokens (array) deduplicado', async () => {
    const db = buildDb({
      members: [
        {
          uid: 'u1',
          role: 'supervisor',
          legacyFcmToken: 'shared',
          userFcmTokens: ['shared', 'new'],
        },
      ],
    });
    const r = await resolveProjectMemberTokens('p1', new Set(['supervisor']), db);
    expect(r.tokens.sort()).toEqual(['new', 'shared']);
  });

  it('expone emails en orden de iteración', async () => {
    const db = buildDb({
      members: [
        { uid: 'u1', role: 'supervisor', email: 'a@example.com' },
        { uid: 'u2', role: 'worker', email: 'b@example.com' },
        { uid: 'u3', role: 'supervisor', email: 'c@example.com' },
      ],
    });
    const r = await resolveProjectMemberTokens('p1', new Set(['supervisor']), db);
    expect(r.emails).toEqual(['a@example.com', 'c@example.com']);
  });

  it('fallo al leer members → empty result, no throw', async () => {
    const db = buildDb({ members: [], membersReadShouldFail: true });
    const r = await resolveProjectMemberTokens('p1', new Set(['supervisor']), db);
    expect(r.tokens).toEqual([]);
    expect(r.memberCount).toBe(0);
  });

  it('fallo al leer user doc → ese member contribuye solo el legacy token (si lo hay)', async () => {
    const db = buildDb({
      members: [
        {
          uid: 'u1',
          role: 'supervisor',
          legacyFcmToken: 'legacy-only',
          userReadShouldFail: true,
        },
      ],
    });
    const r = await resolveProjectMemberTokens('p1', new Set(['supervisor']), db);
    expect(r.tokens).toEqual(['legacy-only']);
  });

  it('bucket emergency_services incluye supervisor + brigade roles', () => {
    expect(LONE_WORKER_ROLE_BUCKETS.emergency_services.has('supervisor')).toBe(true);
    expect(LONE_WORKER_ROLE_BUCKETS.emergency_services.has('brigade')).toBe(true);
    expect(LONE_WORKER_ROLE_BUCKETS.emergency_services.has('emergency_services')).toBe(true);
  });

  it('bucket brigade NO incluye emergency-only roles (escalación monotonica)', () => {
    expect(LONE_WORKER_ROLE_BUCKETS.brigade.has('emergency_services')).toBe(false);
    expect(LONE_WORKER_ROLE_BUCKETS.brigade.has('supervisor')).toBe(true);
  });
});

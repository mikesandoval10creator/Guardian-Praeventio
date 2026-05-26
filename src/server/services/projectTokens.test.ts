import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  LONE_WORKER_ROLE_BUCKETS,
  ProjectTokenLookupError,
  __clearProjectTokenCache,
  iterateAllProjects,
  resolveProjectMemberTokens,
} from './projectTokens.js';
import { SUPERVISOR_ROLES, ADMIN_ROLES, DOCTOR_ROLES } from '../../types/roles.js';

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

  // PR #482 codex P1 (round 3): read failures must propagate (no "empty
  // tokens = success" silent path that would let the cron persist the
  // idempotency marker without delivering any safety alert).
  it('fallo al leer members → throws ProjectTokenLookupError', async () => {
    const db = buildDb({ members: [], membersReadShouldFail: true });
    await expect(
      resolveProjectMemberTokens('p1', new Set(['supervisor']), db),
    ).rejects.toBeInstanceOf(ProjectTokenLookupError);
  });

  it('fallo al leer user doc de un member matched → throws ProjectTokenLookupError', async () => {
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
    await expect(
      resolveProjectMemberTokens('p1', new Set(['supervisor']), db),
    ).rejects.toBeInstanceOf(ProjectTokenLookupError);
  });

  it('NO cachea read failures: tras un fallo, un retry exitoso ve tokens reales', async () => {
    // Setup: primer call falla en users/u1 read. Tras clear-cache implícito
    // (cache solo guarda éxitos), un segundo call con db "saludable" debería
    // ver los tokens reales — no quedar atascado en el `[]` cacheado.
    const failingDb = buildDb({
      members: [
        {
          uid: 'u1',
          role: 'supervisor',
          userReadShouldFail: true,
        },
      ],
    });
    await expect(
      resolveProjectMemberTokens('p1', new Set(['supervisor']), failingDb),
    ).rejects.toBeInstanceOf(ProjectTokenLookupError);

    const healthyDb = buildDb({
      members: [
        {
          uid: 'u1',
          role: 'supervisor',
          userFcmTokens: ['recovered-token'],
        },
      ],
    });
    const r = await resolveProjectMemberTokens('p1', new Set(['supervisor']), healthyDb);
    expect(r.tokens).toEqual(['recovered-token']);
  });

  it('bucket emergency_services incluye supervisor + brigade roles', () => {
    expect(LONE_WORKER_ROLE_BUCKETS.emergency_services.has('supervisor')).toBe(true);
    expect(LONE_WORKER_ROLE_BUCKETS.emergency_services.has('brigade')).toBe(true);
    expect(LONE_WORKER_ROLE_BUCKETS.emergency_services.has('emergency_services')).toBe(true);
  });

  it('bucket brigade NO incluye emergency-only roles (escalación monotonica)', () => {
    expect(LONE_WORKER_ROLE_BUCKETS.brigade.has('emergency')).toBe(false);
    expect(LONE_WORKER_ROLE_BUCKETS.brigade.has('emergency_services')).toBe(false);
    expect(LONE_WORKER_ROLE_BUCKETS.brigade.has('supervisor')).toBe(true);
  });

  // PR #482 codex P1 (round 2) — los buckets antes hardcoded omitían
  // director_obra + medico_ocupacional, que firestore.rules considera
  // supervisores. Sourceo canónico evita drift cuando se agreguen roles.
  it('bucket supervisor cubre TODOS los SUPERVISOR_ROLES canónicos de types/roles.ts', () => {
    for (const role of SUPERVISOR_ROLES) {
      expect(
        LONE_WORKER_ROLE_BUCKETS.supervisor.has(role),
        `bucket.supervisor debe contener "${role}"`,
      ).toBe(true);
    }
  });

  it('bucket supervisor cubre TODOS los ADMIN_ROLES + DOCTOR_ROLES', () => {
    for (const role of [...ADMIN_ROLES, ...DOCTOR_ROLES]) {
      expect(
        LONE_WORKER_ROLE_BUCKETS.supervisor.has(role),
        `bucket.supervisor debe contener "${role}"`,
      ).toBe(true);
    }
  });

  it('cubre explícitamente director_obra y medico_ocupacional (regresión del round 2)', () => {
    expect(LONE_WORKER_ROLE_BUCKETS.supervisor.has('director_obra')).toBe(true);
    expect(LONE_WORKER_ROLE_BUCKETS.supervisor.has('medico_ocupacional')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// iterateAllProjects — pagination
// ────────────────────────────────────────────────────────────────────────

function buildProjectsDb(opts: {
  totalProjects: number;
  observePages?: (pageNo: number, fromAfter: string | null, limit: number) => void;
}) {
  const projectIds = Array.from({ length: opts.totalProjects }, (_, i) =>
    `p${String(i).padStart(4, '0')}`,
  );
  let pageCount = 0;

  function makeQuery(state: { limit: number; after: string | null }) {
    return {
      orderBy(_field: string) {
        return this;
      },
      limit(n: number) {
        return makeQuery({ ...state, limit: n });
      },
      startAfter(cursorDoc: { id: string }) {
        return makeQuery({ ...state, after: cursorDoc.id });
      },
      async get() {
        pageCount += 1;
        opts.observePages?.(pageCount, state.after, state.limit);
        const startIdx = state.after === null ? 0 : projectIds.indexOf(state.after) + 1;
        const slice = projectIds.slice(startIdx, startIdx + state.limit);
        return {
          empty: slice.length === 0,
          size: slice.length,
          docs: slice.map((id) => ({ id, data: () => ({}) })),
        };
      },
    } as any;
  }

  const db = {
    collection(name: string) {
      if (name !== 'projects') throw new Error(`unexpected collection ${name}`);
      return {
        orderBy(_field: string) {
          return {
            limit(n: number) {
              return makeQuery({ limit: n, after: null });
            },
          };
        },
      };
    },
  } as any;
  return { db, getPageCount: () => pageCount };
}

describe('iterateAllProjects', () => {
  it('itera 0 proyectos sin pegarle a Firestore con cursor', async () => {
    const { db } = buildProjectsDb({ totalProjects: 0 });
    const visited: string[] = [];
    const total = await iterateAllProjects(db, 100, async (doc) => {
      visited.push(doc.id);
    });
    expect(total).toBe(0);
    expect(visited).toEqual([]);
  });

  it('itera proyectos en una sola página cuando total ≤ pageSize', async () => {
    const { db, getPageCount } = buildProjectsDb({ totalProjects: 7 });
    const visited: string[] = [];
    const total = await iterateAllProjects(db, 100, async (doc) => {
      visited.push(doc.id);
    });
    expect(total).toBe(7);
    expect(visited).toHaveLength(7);
    expect(getPageCount()).toBe(1);
  });

  it('pagina con cursor cuando total > pageSize (501 proyectos, page=100 → 6 páginas)', async () => {
    const cursors: Array<string | null> = [];
    const { db, getPageCount } = buildProjectsDb({
      totalProjects: 501,
      observePages: (_n, after) => cursors.push(after),
    });
    const visited: string[] = [];
    const total = await iterateAllProjects(db, 100, async (doc) => {
      visited.push(doc.id);
    });
    expect(total).toBe(501);
    expect(visited).toHaveLength(501);
    // 5 full pages (100 each) + 1 trailing partial page (1) = 6 pages
    expect(getPageCount()).toBe(6);
    expect(cursors[0]).toBeNull();
    expect(cursors[1]).toBe('p0099');
    expect(cursors[2]).toBe('p0199');
  });

  it('no se detiene en el primer 500 (regresión P1 paginación)', async () => {
    const { db } = buildProjectsDb({ totalProjects: 1200 });
    const visited: string[] = [];
    await iterateAllProjects(db, 500, async (doc) => {
      visited.push(doc.id);
    });
    expect(visited).toHaveLength(1200);
    expect(visited[1199]).toBe('p1199');
  });

  it('propaga el throw del callback (caller decide aislamiento per-project)', async () => {
    const { db } = buildProjectsDb({ totalProjects: 3 });
    const seen: string[] = [];
    await expect(
      iterateAllProjects(db, 100, async (doc) => {
        seen.push(doc.id);
        if (doc.id === 'p0001') throw new Error('per-project boom');
      }),
    ).rejects.toThrow('per-project boom');
    expect(seen).toEqual(['p0000', 'p0001']);
  });

  it('rechaza pageSize ≤ 0', async () => {
    const { db } = buildProjectsDb({ totalProjects: 1 });
    await expect(iterateAllProjects(db, 0, vi.fn())).rejects.toThrow(/pageSize/);
  });
});

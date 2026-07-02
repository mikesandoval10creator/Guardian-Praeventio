// roleClaimsSync — behavioral tests against the REAL module (DI fakes,
// backgroundTriggers test seam pattern). Node env (default).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupRoleClaimsSync,
  syncUserRoleClaim,
  type RoleClaimsSyncDeps,
} from './roleClaimsSync';

// ─── Fakes ──────────────────────────────────────────────────────────────────

type SnapshotCb = (snap: unknown) => void;

function makeFakes(opts?: {
  authUsers?: Record<string, { customClaims?: Record<string, unknown> }>;
  auditAddImpl?: () => Promise<unknown>;
}) {
  let usersSnapshotCb: SnapshotCb | null = null;
  let usersErrorCb: ((e: Error) => void) | null = null;
  const auditAdd = vi.fn(opts?.auditAddImpl ?? (async () => ({ id: 'a1' })));
  const userDocSet = vi.fn(async () => undefined);
  const unsubscribe = vi.fn();

  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'users') {
        return {
          onSnapshot: (cb: SnapshotCb, errCb: (e: Error) => void) => {
            usersSnapshotCb = cb;
            usersErrorCb = errCb;
            return unsubscribe;
          },
          doc: vi.fn(() => ({ set: userDocSet })),
        };
      }
      if (name === 'audit_logs') return { add: auditAdd };
      throw new Error(`unexpected collection ${name}`);
    }),
  };

  const authUsers = opts?.authUsers ?? {};
  const auth = {
    getUser: vi.fn(async (uid: string) => {
      const u = authUsers[uid];
      if (!u) throw new Error('auth/user-not-found');
      return { uid, customClaims: u.customClaims } as never;
    }),
    setCustomUserClaims: vi.fn(async () => undefined),
    revokeRefreshTokens: vi.fn(async () => undefined),
  };

  const firestoreNamespace = {
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  } as unknown as RoleClaimsSyncDeps['firestoreNamespace'];

  const deps: RoleClaimsSyncDeps = {
    db: db as unknown as RoleClaimsSyncDeps['db'],
    auth: auth as unknown as RoleClaimsSyncDeps['auth'],
    firestoreNamespace,
  };

  const emit = (changes: Array<{ type: string; id: string; data: Record<string, unknown> }>) => {
    usersSnapshotCb?.({
      docChanges: () =>
        changes.map((c) => ({
          type: c.type,
          doc: { id: c.id, data: () => c.data },
        })),
    });
  };

  return { deps, auth, auditAdd, userDocSet, unsubscribe, emit, getErrorCb: () => usersErrorCb };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── syncUserRoleClaim (unit, direct) ───────────────────────────────────────

describe('syncUserRoleClaim', () => {
  it('mints the role claim PRESERVING existing claims, audits, and stamps the mirror', async () => {
    const { deps, auth, auditAdd, userDocSet } = makeFakes({
      authUsers: { u1: { customClaims: { tenantId: 'T1' } } },
    });
    await syncUserRoleClaim(deps, 'u1', { role: 'prevencionista' });

    expect(auth.setCustomUserClaims).toHaveBeenCalledExactlyOnceWith('u1', {
      tenantId: 'T1',
      role: 'prevencionista',
    });
    // Upgrade from no-role → NO revocation (no forced logout mid-shift).
    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
    // Audit row (CLAUDE.md #3) with server-stamped system identity.
    expect(auditAdd).toHaveBeenCalledTimes(1);
    const row = auditAdd.mock.calls[0][0] as Record<string, unknown>;
    expect(row.action).toBe('role_claim_sync');
    expect(row.userId).toBe('system:roleClaimsSync');
    expect(row.details).toEqual({
      targetUid: 'u1', oldRole: null, newRole: 'prevencionista', revoked: false,
    });
    // Mirror stamp — enables the steady-state zero-I/O short-circuit.
    expect(userDocSet).toHaveBeenCalledExactlyOnceWith(
      { claimsSync: { role: 'prevencionista', at: 'SERVER_TS' } },
      { merge: true },
    );
  });

  it('steady state (mirror matches) costs ZERO Auth I/O', async () => {
    const { deps, auth, auditAdd, userDocSet } = makeFakes({
      authUsers: { u1: { customClaims: { role: 'admin' } } },
    });
    await syncUserRoleClaim(deps, 'u1', {
      role: 'admin',
      claimsSync: { role: 'admin', at: 'x' },
    });
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
    expect(auditAdd).not.toHaveBeenCalled();
    expect(userDocSet).not.toHaveBeenCalled();
  });

  it('claims already correct (e.g. set-role endpoint) → stamps mirror only, no mint, no audit', async () => {
    const { deps, auth, auditAdd, userDocSet } = makeFakes({
      authUsers: { u1: { customClaims: { role: 'gerente', tenantId: 'T1' } } },
    });
    await syncUserRoleClaim(deps, 'u1', { role: 'gerente' });
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
    expect(auditAdd).not.toHaveBeenCalled();
    expect(userDocSet).toHaveBeenCalledTimes(1);
  });

  it.each(['inactive', 'anonymized'])(
    'LIFECYCLE LOCK: never overwrites a %s claim (no resurrection)',
    async (locked) => {
      const { deps, auth, auditAdd, userDocSet } = makeFakes({
        authUsers: { u1: { customClaims: { role: locked } } },
      });
      await syncUserRoleClaim(deps, 'u1', { role: 'admin' });
      expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
      expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
      expect(auditAdd).not.toHaveBeenCalled();
      expect(userDocSet).not.toHaveBeenCalled();
    },
  );

  it('DOWNGRADE (admin → worker) revokes refresh tokens; the audit row says so', async () => {
    const { deps, auth, auditAdd } = makeFakes({
      authUsers: { u1: { customClaims: { role: 'admin', tenantId: 'T1' } } },
    });
    await syncUserRoleClaim(deps, 'u1', { role: 'soldador' });
    expect(auth.setCustomUserClaims).toHaveBeenCalledExactlyOnceWith('u1', {
      tenantId: 'T1',
      role: 'soldador',
    });
    expect(auth.revokeRefreshTokens).toHaveBeenCalledExactlyOnceWith('u1');
    const row = auditAdd.mock.calls[0][0] as Record<string, unknown>;
    expect((row.details as Record<string, unknown>).revoked).toBe(true);
  });

  it('UPGRADE (worker → supervisor) does NOT revoke (claim lands on natural refresh)', async () => {
    const { deps, auth } = makeFakes({
      authUsers: { u1: { customClaims: { role: 'operario' } } },
    });
    await syncUserRoleClaim(deps, 'u1', { role: 'supervisor' });
    expect(auth.setCustomUserClaims).toHaveBeenCalledTimes(1);
    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('invalid / unknown role in the users doc → skipped entirely', async () => {
    const { deps, auth } = makeFakes({ authUsers: { u1: {} } });
    await syncUserRoleClaim(deps, 'u1', { role: 'super-saiyan' });
    await syncUserRoleClaim(deps, 'u1', { role: 42 as unknown as string });
    await syncUserRoleClaim(deps, 'u1', {});
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('roster-only user without an Auth account → quiet skip, no throw', async () => {
    const { deps, auth } = makeFakes({ authUsers: {} });
    await expect(syncUserRoleClaim(deps, 'ghost', { role: 'operario' })).resolves.toBeUndefined();
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('audit outage is severe-but-non-blocking: claim minted AND mirror still stamped', async () => {
    const { deps, auth, userDocSet } = makeFakes({
      authUsers: { u1: { customClaims: {} } },
      auditAddImpl: async () => {
        throw new Error('firestore down');
      },
    });
    await syncUserRoleClaim(deps, 'u1', { role: 'admin' });
    expect(auth.setCustomUserClaims).toHaveBeenCalledTimes(1);
    expect(userDocSet).toHaveBeenCalledTimes(1);
  });
});

// ─── setupRoleClaimsSync (listener wiring) ──────────────────────────────────

describe('setupRoleClaimsSync', () => {
  it('added/modified changes sync; removed changes are ignored', async () => {
    const { deps, auth, emit } = makeFakes({
      authUsers: {
        u1: { customClaims: {} },
        u2: { customClaims: {} },
        u3: { customClaims: { role: 'admin' } },
      },
    });
    setupRoleClaimsSync(deps);
    emit([
      { type: 'added', id: 'u1', data: { role: 'admin' } },
      { type: 'modified', id: 'u2', data: { role: 'prevencionista' } },
      { type: 'removed', id: 'u3', data: { role: 'admin' } },
    ]);
    await flush();
    expect(auth.setCustomUserClaims).toHaveBeenCalledTimes(2);
    const uids = auth.setCustomUserClaims.mock.calls.map((c) => c[0]);
    expect(uids).toContain('u1');
    expect(uids).toContain('u2');
    expect(uids).not.toContain('u3');
  });

  it('one poisoned doc does not stop the batch (per-doc guard)', async () => {
    const { deps, auth, emit } = makeFakes({
      authUsers: { good: { customClaims: {} } },
    });
    // 'boom' explodes inside getUser with a non-standard error.
    (auth.getUser as ReturnType<typeof vi.fn>).mockImplementation(async (uid: string) => {
      if (uid === 'boom') throw new Error('unexpected');
      if (uid === 'good') return { uid, customClaims: {} } as never;
      throw new Error('auth/user-not-found');
    });
    setupRoleClaimsSync(deps);
    emit([
      { type: 'added', id: 'boom', data: { role: 'admin' } },
      { type: 'added', id: 'good', data: { role: 'admin' } },
    ]);
    await flush();
    expect(auth.setCustomUserClaims).toHaveBeenCalledExactlyOnceWith('good', { role: 'admin' });
  });

  it('returns a working unsubscribe handle and survives listener errors', () => {
    const { deps, unsubscribe, getErrorCb } = makeFakes();
    const handle = setupRoleClaimsSync(deps);
    expect(() => getErrorCb()?.(new Error('listener died'))).not.toThrow();
    handle.unsubscribe();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

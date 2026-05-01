// Praeventio Guard — Round 14 (R5 agent): curriculum_claims service tests.
//
// Strategy: dependency-injected Firestore-shaped fake (mirrors the pattern
// used by `src/services/auth/projectMembership.ts`). The service exports
// pure functions that take a `MinimalClaimsDb` parameter, so tests inject
// an in-memory store; production wires it to `admin.firestore()` at the
// call site in server.ts.
//
// We also inject the audit-log writer as a callback so the service stays
// pure and the tests can assert on action codes without booting Sentry,
// the Firebase admin SDK, or anything else.

import { describe, it, expect, vi } from 'vitest';
import {
  createClaim,
  recordRefereeEndorsement,
  getClaimsByWorker,
  type ClaimCreatePayload,
  type CurriculumClaim,
  type MinimalClaimsDb,
  type AuditLogger,
} from './claims.js';
import { hashToken } from './refereeTokens.js';

// --- Test doubles --------------------------------------------------------

/** In-memory Firestore-shape: collection('curriculum_claims').doc(id).{get,set,update}. */
function makeDb(initial: Record<string, CurriculumClaim> = {}): {
  db: MinimalClaimsDb;
  store: Map<string, CurriculumClaim>;
  addedIds: string[];
} {
  const store = new Map<string, CurriculumClaim>(Object.entries(initial));
  const addedIds: string[] = [];

  const collection = (name: string) => {
    expect(name).toBe('curriculum_claims');
    return {
      add: async (data: any) => {
        const id = `auto-${addedIds.length + 1}`;
        addedIds.push(id);
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
          if (!existing) throw new Error(`doc ${id} not found`);
          // Naive merge — sufficient for our flat update shape (status,
          // referees[], verifiedAt). We intentionally do NOT support dotted
          // field paths because the service doesn't use them.
          store.set(id, { ...existing, ...patch });
        },
      }),
      where: (field: string, op: string, value: any) => {
        expect(op).toBe('==');
        return {
          get: async () => {
            const docs = Array.from(store.values())
              .filter((c) => (c as any)[field] === value)
              .map((c) => ({ id: c.id, data: () => c }));
            return { empty: docs.length === 0, docs };
          },
        };
      },
    };
  };

  return {
    db: { collection } as unknown as MinimalClaimsDb,
    store,
    addedIds,
  };
}

function makeAudit(): { audit: AuditLogger; calls: Array<{ action: string; details: any }> } {
  const calls: Array<{ action: string; details: any }> = [];
  const audit: AuditLogger = async (action, details) => {
    calls.push({ action, details });
  };
  return { audit, calls };
}

const basePayload: ClaimCreatePayload = {
  workerId: 'worker-uid-1',
  workerEmail: 'worker@example.cl',
  claim: 'He trabajado 5 años en obra como capataz de seguridad sin incidentes graves.',
  category: 'experience',
  signedByWorker: {
    webauthnCredentialId: 'cred-abc',
    webauthnAssertion: 'YXNzZXJ0LWJhc2U2NA==',
  },
  referees: [
    { name: 'Ana Pérez', email: 'ana@ref.cl' },
    { name: 'Bruno Silva', email: 'bruno@ref.cl' },
  ],
};

// --- createClaim ---------------------------------------------------------

describe('createClaim', () => {
  it('writes a claim doc with status=pending_referees and returns 2 raw tokens', async () => {
    const { db, store, addedIds } = makeDb();
    const { audit, calls } = makeAudit();

    const result = await createClaim(basePayload, db, audit);

    expect(addedIds).toHaveLength(1);
    const id = addedIds[0];
    expect(result.id).toBe(id);
    expect(result.refereeTokens).toHaveLength(2);
    expect(result.refereeTokens[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(result.refereeTokens[1]).toMatch(/^[0-9a-f]{64}$/);

    const stored = store.get(id)!;
    expect(stored.status).toBe('pending_referees');
    expect(stored.workerId).toBe('worker-uid-1');
    expect(stored.referees).toHaveLength(2);
    // Hash matches the returned raw token; raw token is NOT stored.
    expect(stored.referees[0].tokenHash).toBe(hashToken(result.refereeTokens[0]));
    expect(stored.referees[1].tokenHash).toBe(hashToken(result.refereeTokens[1]));
    // Raw tokens never appear anywhere in the stored doc:
    expect(JSON.stringify(stored)).not.toContain(result.refereeTokens[0]);
    expect(JSON.stringify(stored)).not.toContain(result.refereeTokens[1]);

    // Audit log fired for creation:
    expect(calls.find((c) => c.action === 'curriculum.claim.created')).toBeTruthy();
  });

  it('stamps createdAt and expiresAt 14 days apart', async () => {
    const { db, store, addedIds } = makeDb();
    const { audit } = makeAudit();
    const t0 = Date.now();
    await createClaim(basePayload, db, audit);
    const stored = store.get(addedIds[0])!;
    const created = new Date(stored.createdAt as string).getTime();
    const expires = new Date(stored.expiresAt as string).getTime();
    expect(created).toBeGreaterThanOrEqual(t0);
    // 14 days in ms = 1209600000
    expect(expires - created).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('rejects when referees array is not exactly 2', async () => {
    const { db } = makeDb();
    const { audit } = makeAudit();
    await expect(
      createClaim({ ...basePayload, referees: [basePayload.referees[0]] }, db, audit),
    ).rejects.toThrow(/exactly 2 referees/i);
  });

  it('rejects when claim text is empty', async () => {
    const { db } = makeDb();
    const { audit } = makeAudit();
    await expect(
      createClaim({ ...basePayload, claim: '   ' }, db, audit),
    ).rejects.toThrow(/claim text/i);
  });

  it('rejects when claim text exceeds 500 characters', async () => {
    const { db } = makeDb();
    const { audit } = makeAudit();
    const longClaim = 'x'.repeat(501);
    await expect(
      createClaim({ ...basePayload, claim: longClaim }, db, audit),
    ).rejects.toThrow(/500/);
  });

  it('rejects when a referee email is malformed', async () => {
    const { db } = makeDb();
    const { audit } = makeAudit();
    await expect(
      createClaim(
        {
          ...basePayload,
          referees: [
            { name: 'OK', email: 'not-an-email' },
            { name: 'Also OK', email: 'good@x.cl' },
          ],
        },
        db,
        audit,
      ),
    ).rejects.toThrow(/email/i);
  });
});

// --- recordRefereeEndorsement -------------------------------------------

describe('recordRefereeEndorsement', () => {
  /** Helper: creates a claim and returns the id + the two raw tokens. */
  async function seed(): Promise<{
    id: string;
    rawTokens: [string, string];
    db: MinimalClaimsDb;
    store: Map<string, CurriculumClaim>;
  }> {
    const { db, store, addedIds } = makeDb();
    const { audit } = makeAudit();
    const r = await createClaim(basePayload, db, audit);
    return {
      id: addedIds[0],
      rawTokens: r.refereeTokens as [string, string],
      db,
      store,
    };
  }

  it('co-signs with one referee → status remains pending_referees, verified=false', async () => {
    const { id, rawTokens, db, store } = await seed();
    const { audit, calls } = makeAudit();

    const r = await recordRefereeEndorsement(
      id,
      rawTokens[0],
      { signature: 'cosign-bytes-base64', method: 'webauthn' },
      db,
      audit,
    );

    expect(r.verified).toBe(false);
    const updated = store.get(id)!;
    expect(updated.status).toBe('pending_referees');
    expect(updated.referees[0].signedAt).not.toBeNull();
    expect(updated.referees[1].signedAt).toBeNull();

    const actions = calls.map((c) => c.action);
    expect(actions).toContain('curriculum.referee.endorsed');
    expect(actions).not.toContain('curriculum.claim.verified');
  });

  it('flips claim to verified once BOTH referees co-sign', async () => {
    const { id, rawTokens, db, store } = await seed();
    const { audit, calls } = makeAudit();

    await recordRefereeEndorsement(
      id,
      rawTokens[0],
      { signature: 'sig-a', method: 'webauthn' },
      db,
      audit,
    );
    const r = await recordRefereeEndorsement(
      id,
      rawTokens[1],
      { signature: 'sig-b', method: 'standard' },
      db,
      audit,
    );

    expect(r.verified).toBe(true);
    const updated = store.get(id)!;
    expect(updated.status).toBe('verified');
    expect(updated.verifiedAt).not.toBeNull();
    const actions = calls.map((c) => c.action);
    expect(actions).toContain('curriculum.claim.verified');
  });

  it('rejects an unknown token (no referee match → 404-equivalent)', async () => {
    const { id, db } = await seed();
    const { audit } = makeAudit();
    await expect(
      recordRefereeEndorsement(
        id,
        'deadbeef'.repeat(8), // 64 hex but not registered
        { signature: 'x', method: 'standard' },
        db,
        audit,
      ),
    ).rejects.toThrow(/token/i);
  });

  it('rejects when the parent claim is already verified (immutable)', async () => {
    const { id, rawTokens, db } = await seed();
    const { audit } = makeAudit();
    await recordRefereeEndorsement(id, rawTokens[0], { signature: 's1', method: 'standard' }, db, audit);
    await recordRefereeEndorsement(id, rawTokens[1], { signature: 's2', method: 'standard' }, db, audit);
    // Third attempt must be rejected — claim is now immutable.
    await expect(
      recordRefereeEndorsement(id, rawTokens[0], { signature: 's3', method: 'standard' }, db, audit),
    ).rejects.toThrow(/already (verified|endorsed)/i);
  });

  it('rejects when the claim is past expiresAt (auto-expires)', async () => {
    const { id, rawTokens, db, store } = await seed();
    // Force-expire the doc by rewriting expiresAt to the past.
    const stored = store.get(id)!;
    store.set(id, {
      ...stored,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { audit } = makeAudit();
    await expect(
      recordRefereeEndorsement(id, rawTokens[0], { signature: 's', method: 'standard' }, db, audit),
    ).rejects.toThrow(/expired/i);
  });

  it('does not re-trigger verification audit when the same referee signs twice', async () => {
    const { id, rawTokens, db } = await seed();
    const { audit, calls } = makeAudit();
    await recordRefereeEndorsement(id, rawTokens[0], { signature: 'a', method: 'standard' }, db, audit);
    // Same referee co-signs again — should be a no-op (or rejected),
    // but MUST NOT promote the claim to verified.
    await expect(
      recordRefereeEndorsement(id, rawTokens[0], { signature: 'b', method: 'standard' }, db, audit),
    ).rejects.toThrow(/already/i);
    expect(calls.filter((c) => c.action === 'curriculum.claim.verified')).toHaveLength(0);
  });
});

// --- getClaimsByWorker ---------------------------------------------------

describe('getClaimsByWorker', () => {
  it('returns the worker\'s claims and excludes other workers', async () => {
    const { db } = makeDb();
    const { audit } = makeAudit();
    await createClaim(basePayload, db, audit);
    await createClaim({ ...basePayload, workerId: 'other-uid' }, db, audit);
    await createClaim(basePayload, db, audit);

    const claims = await getClaimsByWorker('worker-uid-1', db);
    expect(claims).toHaveLength(2);
    for (const c of claims) {
      expect(c.workerId).toBe('worker-uid-1');
      // Tokens never leak through this read path:
      const json = JSON.stringify(c);
      // tokenHash is fine to expose; raw tokens must not be present
      // (they were never persisted, but assert the shape anyway).
      expect(c.referees[0]).not.toHaveProperty('rawToken');
    }
  });

  it('returns [] when the worker has no claims', async () => {
    const { db } = makeDb();
    const claims = await getClaimsByWorker('lonely-uid', db);
    expect(claims).toEqual([]);
  });
});

// Real-router supertest for src/server/routes/healthVault.ts (Sprint 26 VV).
//
// HealthVault QR sharing — the worker is the ABSOLUTE owner of their medical
// portfolio. These endpoints mint / consume / revoke share tokens a treating
// doctor uses (by scanning the QR) for time-boxed read access. Compliance
// target: Ley 20.584 (patient controls access), Ley 21.719 (personal data),
// Ley 16.744 (occupational exams). Praeventio NEVER diagnoses.
//
// Mounts the ACTUAL router over fakeFirestore and exercises the REAL handlers
// + the REAL vaultShare / vaultRecord services (UNMOCKED). Only firebase-admin,
// verifyAuth, logger, and observability are stubbed. The firebase-admin mock is
// extended inline with collectionGroup (the /view lookup uses it) and storage
// (the file-proxy streams a blob) — fakeFirestore exposes neither.
//
// Endpoints + cases:
//   POST   /share              401 / 400×4 (scope, topic, ttl, recordIds) / 201 happy
//                              (persists hash NOT secret, audit from token, identity
//                               server-stamped not body)
//   GET    /view/:id/:secret   404 invalid / 401 wrong secret / 410 revoked / 410 expired
//                              / 410 max_consumes / 200 happy (records w/ fileProxyPath,
//                               NO raw fileUri; consumeCount++; audit consumed) / 200 empty
//   GET    .../file/:recordId  404 invalid token / 410 revoked / 403 out_of_scope
//                              / 404 file_unavailable / 200 streams (audit file_accessed,
//                               does NOT burn a view)
//   POST   /share/:id/revoke   401 / 404 not_found / 403 forbidden (workerUid mismatch)
//                              / 200 happy (revokedAt set, audit revoked)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  // The file-proxy happy path streams from admin.storage().bucket(). The holder
  // lets each test configure the storage stub the firebase-admin mock returns.
  storage: {
    fileExists: true,
    contentType: 'application/pdf',
    body: 'PDF-BYTES',
  },
}));

// ── firebase-admin mock — collectionGroup + storage bolted on ────────────────
// The route uses admin.firestore().collectionGroup('health_vault_shares') to
// locate workerUid+id from a public /view request, and admin.storage().bucket()
// to stream a record's file. FakeFirestore supports neither, so we extend the
// firestore() return value (collectionGroup, mirroring externalAuditPortal.test)
// and provide a storage() stub driven by the H.storage holder.
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const base = adminMock(() => H.db!);
  const originalFirestoreFn = base.default.firestore;

  type FakeDb = ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore>;
  function withCollectionGroup(db: FakeDb) {
    const proxy = db as typeof db & {
      collectionGroup?: (name: string) => ReturnType<typeof db.collection>;
    };
    if (proxy.collectionGroup) return proxy;
    proxy.collectionGroup = function (name: string) {
      const allFilters: Array<{ field: string; op: string; value: unknown }> = [];

      function runCgQuery(
        filters: Array<{ field: string; op: string; value: unknown }>,
        lim: number | null,
      ) {
        const store = (db as typeof db & { _store: Map<string, Record<string, unknown>> })._store;
        const matchedDocs: Array<{ id: string; path: string; data: Record<string, unknown> }> = [];
        for (const [path, data] of store.entries()) {
          const segments = path.split('/');
          // A doc belongs to collectionGroup `name` if `name` is an even-indexed
          // (0-based) segment and the doc id is the next odd segment.
          for (let i = 0; i < segments.length - 1; i += 2) {
            if (segments[i] === name) {
              matchedDocs.push({ id: segments[i + 1], path, data });
              break;
            }
          }
        }
        const filtered = matchedDocs.filter((doc) =>
          filters.every((f) => {
            const v = f.field
              .split('.')
              .reduce<unknown>(
                (acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]),
                doc.data,
              );
            if (f.op === '==') return v === f.value;
            if (f.op === '!=') return v !== f.value;
            return false;
          }),
        );
        const sliced = lim != null ? filtered.slice(0, lim) : filtered;
        const docs = sliced.map(({ id, path, data }) => ({
          id,
          ref: db.doc(path),
          exists: true,
          data: () => ({ ...data }),
          get: (field: string) =>
            field
              .split('.')
              .reduce<unknown>(
                (acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]),
                data,
              ),
        }));
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (cb: (d: (typeof docs)[0]) => void) => docs.forEach(cb),
        };
      }

      function buildCgQuery(
        filters: Array<{ field: string; op: string; value: unknown }>,
        lim: number | null,
      ): ReturnType<typeof db.collection> {
        return {
          where: (field: string, op: string, value: unknown) =>
            buildCgQuery([...filters, { field, op, value }], lim),
          orderBy: (_field: string, _dir?: string) => buildCgQuery(filters, lim),
          limit: (n: number) => buildCgQuery(filters, n),
          get: async () => runCgQuery(filters, lim),
          count: () => ({
            get: async () => ({ data: () => ({ count: runCgQuery(filters, null).size }) }),
          }),
          doc: () => {
            throw new Error('collectionGroup does not support .doc()');
          },
          add: () => {
            throw new Error('collectionGroup does not support .add()');
          },
          path: `__collectionGroup__/${name}`,
        } as unknown as ReturnType<typeof db.collection>;
      }

      return buildCgQuery(allFilters, null);
    };
    return proxy;
  }

  const patchedFirestoreFn = Object.assign(() => withCollectionGroup(H.db!), originalFirestoreFn);

  // storage().bucket().file(path) — minimal surface the file-proxy uses:
  // exists(), getMetadata(), createReadStream(). Driven by H.storage.
  const storageFn = () => ({
    bucket: () => ({
      file: (_objectPath: string) => ({
        exists: async () => [H.storage.fileExists] as [boolean],
        getMetadata: async () => [{ contentType: H.storage.contentType }] as [{ contentType: string }],
        createReadStream: () => Readable.from([Buffer.from(H.storage.body)]),
      }),
    }),
  });

  const patched = {
    ...base,
    default: { ...base.default, firestore: patchedFirestoreFn, storage: storageFn },
    firestore: patchedFirestoreFn,
    storage: storageFn,
  };
  return patched;
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn(), isAvailable: false, name: 'noop' }),
}));

// ── imports (after mocks) ────────────────────────────────────────────────────

import healthVaultRouter from '../../server/routes/healthVault.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type { VaultShareToken } from '../../services/health/vaultShare.js';
import type { HealthRecord } from '../../services/health/vaultRecord.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/health-vault', healthVaultRouter);
  return app;
}

const WORKER = 'worker-1';
const OTHER = 'worker-2';

function sharesPrefix(uid = WORKER): string {
  return `users/${uid}/health_vault_shares/`;
}

function storedShares(uid = WORKER): VaultShareToken[] {
  const out: VaultShareToken[] = [];
  const store = H.db?._store;
  if (store) {
    for (const [key, value] of store.entries()) {
      if (key.startsWith(sharesPrefix(uid)) && key.split('/').length === 4) {
        out.push(value as unknown as VaultShareToken);
      }
    }
  }
  return out;
}

function auditRows(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const store = H.db?._store;
  if (store) {
    for (const [key, value] of store.entries()) {
      if (key.startsWith('audit_logs/')) rows.push(value as Record<string, unknown>);
    }
  }
  return rows;
}

/** Build a VaultShareToken whose hash matches `secret`, seedable directly. */
function makeShare(overrides: Partial<VaultShareToken> = {}): {
  record: VaultShareToken;
  secret: string;
} {
  const secret = overrides.tokenHash ? 'unused' : 'plaintext-secret-abc123';
  const tokenHash =
    overrides.tokenHash ?? createHash('sha256').update(secret).digest('hex');
  const now = 1_700_000_000_000;
  const record: VaultShareToken = {
    id: 'vs_test01_x',
    workerUid: WORKER,
    scope: 'full',
    tokenHash,
    tokenPrefix: secret.slice(0, 8),
    createdAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000 + 10 ** 13, // far-future so not expired
    maxConsumes: 5,
    consumeCount: 0,
    consumes: [],
    revokedAt: null,
    ...overrides,
  };
  return { record, secret };
}

function seedShare(record: VaultShareToken, uid = WORKER): void {
  H.db!._seed(`${sharesPrefix(uid)}${record.id}`, record as unknown as Record<string, unknown>);
}

function seedRecord(rec: HealthRecord, uid = WORKER): void {
  H.db!._seed(
    `users/${uid}/health_vault/${rec.id}`,
    rec as unknown as Record<string, unknown>,
  );
}

function makeRecord(overrides: Partial<HealthRecord> = {}): HealthRecord {
  return {
    id: 'rec-1',
    workerUid: WORKER,
    type: 'lab_result',
    uploadedAt: 1_700_000_000_000,
    uploadedBy: 'doctor',
    fileUri: 'gs://bucket/users/worker-1/health_vault/rec-1.pdf',
    meta: { title: 'Hemograma' },
    tags: ['blood'],
    shareScope: 'shared-via-qr',
    ...overrides,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed(`users/${WORKER}`, { displayName: 'Juan Pérez' });
  H.storage = { fileExists: true, contentType: 'application/pdf', body: 'PDF-BYTES' };
});

// ── POST /share ──────────────────────────────────────────────────────────────

describe('POST /api/health-vault/share', () => {
  it('401 without a token', async () => {
    const r = await request(buildApp())
      .post('/api/health-vault/share')
      .send({ scope: 'full' });
    expect(r.status).toBe(401);
  });

  it('400 invalid_scope when scope is missing/unknown', async () => {
    const missing = await request(buildApp())
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER)
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('invalid_scope');

    const bad = await request(buildApp())
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER)
      .send({ scope: 'everything' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_scope');
  });

  it('400 topic_required when scope=topic without a topic', async () => {
    const r = await request(buildApp())
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER)
      .send({ scope: 'topic' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('topic_required');
  });

  it('400 invalid_ttl when ttlHours is out of range', async () => {
    const tooHigh = await request(buildApp())
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER)
      .send({ scope: 'full', ttlHours: 1000 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error).toBe('invalid_ttl');
    expect(tooHigh.body.maxHours).toBe(168);

    const tooLow = await request(buildApp())
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER)
      .send({ scope: 'full', ttlHours: 0 });
    expect(tooLow.status).toBe(400);
    expect(tooLow.body.error).toBe('invalid_ttl');
  });

  it('400 invalid_recordIds when recordIds is not a string array', async () => {
    const r = await request(buildApp())
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER)
      .send({ scope: 'topic', topic: 'lumbalgia', recordIds: [1, 2] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_recordIds');
  });

  it('201 mints a share: persists the hash (NOT the raw secret), audits from the token', async () => {
    const r = await request(buildApp())
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER)
      .send({ scope: 'recent', ttlHours: 12 });

    expect(r.status).toBe(201);
    expect(typeof r.body.tokenId).toBe('string');
    expect(typeof r.body.secret).toBe('string');
    expect(typeof r.body.qrPayload).toBe('string');
    expect(typeof r.body.expiresAt).toBe('number');

    // The doc lives under the CALLER's subcollection and stores only the hash.
    const shares = storedShares();
    expect(shares).toHaveLength(1);
    const stored = shares[0];
    expect(stored.workerUid).toBe(WORKER);
    expect(stored.scope).toBe('recent');
    expect(typeof stored.tokenHash).toBe('string');
    // The raw secret must never be persisted.
    expect(JSON.stringify(stored)).not.toContain(r.body.secret);
    // Hash matches the returned secret.
    expect(createHash('sha256').update(r.body.secret as string).digest('hex')).toBe(
      stored.tokenHash,
    );

    // Audit: created, identity from the token.
    const audits = auditRows();
    const created = audits.find((a) => a.action === 'health_vault.share.created');
    expect(created).toBeDefined();
    expect(created!.userId).toBe(WORKER);
  });

  it('201 server-stamps identity: a worker cannot mint a share for someone else', async () => {
    // No body field lets the caller set workerUid; identity comes from the token.
    const r = await request(buildApp())
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER)
      .send({ scope: 'full', workerUid: OTHER });
    expect(r.status).toBe(201);
    const shares = storedShares(WORKER);
    expect(shares).toHaveLength(1);
    expect(shares[0].workerUid).toBe(WORKER);
    // Nothing landed under the other worker's vault.
    expect(storedShares(OTHER)).toHaveLength(0);
  });
});

// ── GET /view/:tokenId/:secret ───────────────────────────────────────────────

describe('GET /api/health-vault/view/:tokenId/:secret', () => {
  it('410 without enumerating whether the legacy token exists', async () => {
    const r = await request(buildApp()).get('/api/health-vault/view/nope/secret');
    expect(r.status).toBe(410);
    expect(r.body.error).toBe('legacy_share_reissue_required');
  });

  it('never reveals records, consumes a view or writes a clinical audit', async () => {
    const { record, secret } = makeShare({ scope: 'full' });
    seedShare(record);
    seedRecord(makeRecord({ id: 'rec-1' }));
    const r = await request(buildApp()).get(
      `/api/health-vault/view/${record.id}/${secret}`,
    );

    expect(r.status).toBe(410);
    expect(r.body.error).toBe('legacy_share_reissue_required');
    expect(r.body).not.toHaveProperty('records');
    expect(storedShares()[0].consumeCount).toBe(0);
    expect(auditRows().some((row) => row.action === 'health_vault.share.consumed')).toBe(false);
  });
});

// ── GET /view/:tokenId/:secret/file/:recordId ────────────────────────────────

describe('GET /api/health-vault/view/:tokenId/:secret/file/:recordId', () => {
  it('410 without enumerating whether the legacy file token exists', async () => {
    const r = await request(buildApp()).get(
      '/api/health-vault/view/nope/secret/file/rec-1',
    );
    expect(r.status).toBe(410);
    expect(r.body.error).toBe('legacy_share_reissue_required');
  });

  it('never streams or audits a file from a legacy bearer link', async () => {
    const { record, secret } = makeShare({ scope: 'full' });
    seedShare(record);
    seedRecord(makeRecord({ id: 'rec-1' }));
    const r = await request(buildApp()).get(
      `/api/health-vault/view/${record.id}/${secret}/file/rec-1`,
    );

    expect(r.status).toBe(410);
    expect(r.body.error).toBe('legacy_share_reissue_required');
    expect(r.headers['cache-control']).toContain('no-store');
    expect(storedShares()[0].consumeCount).toBe(0);
    expect(auditRows().some((row) => row.action === 'health_vault.share.file_accessed')).toBe(false);
  });
});

// ── POST /share/:tokenId/revoke ──────────────────────────────────────────────

describe('POST /api/health-vault/share/:tokenId/revoke', () => {
  it('401 without a token', async () => {
    const r = await request(buildApp()).post('/api/health-vault/share/vs_x/revoke');
    expect(r.status).toBe(401);
  });

  it('404 when the share does not exist for the caller', async () => {
    const r = await request(buildApp())
      .post('/api/health-vault/share/missing/revoke')
      .set('x-test-uid', WORKER);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_found');
  });

  it('403 when a doc under the caller path belongs to another worker', async () => {
    // Pins the workerUid !== callerUid guard: a doc stored under the caller's
    // subcollection but stamped with a foreign workerUid must not be revocable.
    const { record } = makeShare({ workerUid: OTHER, id: 'vs_foreign' });
    seedShare(record, WORKER); // physically under WORKER's path, foreign owner field
    const r = await request(buildApp())
      .post('/api/health-vault/share/vs_foreign/revoke')
      .set('x-test-uid', WORKER);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('forbidden');
  });

  it('200 revokes the share, sets revokedAt, and audits from the token', async () => {
    const { record } = makeShare({ id: 'vs_revoke_me' });
    seedShare(record);
    const r = await request(buildApp())
      .post('/api/health-vault/share/vs_revoke_me/revoke')
      .set('x-test-uid', WORKER);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.revokedAt).toBe('number');

    // Stored doc now carries revokedAt + revokedBy.
    const stored = storedShares().find((s) => s.id === 'vs_revoke_me');
    expect(stored).toBeDefined();
    expect(stored!.revokedAt).toBeTypeOf('number');
    expect(stored!.revokedBy).toBe(WORKER);

    // Audit: revoked, identity from the token.
    const revoked = auditRows().find((a) => a.action === 'health_vault.share.revoked');
    expect(revoked).toBeDefined();
    expect(revoked!.userId).toBe(WORKER);
  });
});

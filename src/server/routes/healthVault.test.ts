// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV — healthVault route integration tests.
//
// Mockea verifyAuth + firebase-admin (firestore) + servicios de records.
// Cubre:
//   1. POST /share happy path (worker autenticado, scope=full)
//   2. POST /share rechaza scope inválido
//   3. POST /share rechaza topic sin field
//   4. POST /share rechaza ttl fuera de rango
//   5. GET /view happy path con records
//   6. GET /view 410 expired
//   7. GET /view 410 revoked
//   8. GET /view 401 secret inválido
//   9. POST /share/:id/revoke happy path
//   10. POST /share/:id/revoke 404 not_found

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock auth — caller siempre = worker_a
vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: any, _res: any, next: any) => {
    req.user = { uid: 'worker_a' };
    next();
  },
}));

// Estado in-memory que el mock de firebase-admin lee/escribe.
const fakeStore: {
  shares: Map<string, any>;
  records: Map<string, any>;
  users: Map<string, any>;
  audits: any[];
} = {
  shares: new Map(),
  records: new Map(),
  users: new Map(),
  audits: [],
};

// Stub firebase-admin con la API mínima que las rutas tocan.
vi.mock('firebase-admin', () => {
  const makeDocRef = (path: string) => ({
    set: vi.fn(async (data: any) => {
      if (path.includes('/health_vault_shares/')) fakeStore.shares.set(path, data);
      else if (path.includes('/health_vault/')) fakeStore.records.set(path, data);
      else fakeStore.users.set(path, data);
    }),
    get: vi.fn(async () => {
      let data: any = undefined;
      if (path.includes('/health_vault_shares/')) data = fakeStore.shares.get(path);
      else if (path.includes('/health_vault/')) data = fakeStore.records.get(path);
      else data = fakeStore.users.get(path);
      return { exists: !!data, data: () => data };
    }),
    update: vi.fn(async (patch: any) => {
      const map = path.includes('/health_vault_shares/')
        ? fakeStore.shares
        : fakeStore.records;
      const existing = map.get(path) ?? {};
      map.set(path, { ...existing, ...patch });
    }),
  });

  const collection = (name: string): any => ({
    doc: (id: string) => ({
      ...makeDocRef(`${name}/${id}`),
      collection: (sub: string) => collection(`${name}/${id}/${sub}`),
    }),
    add: vi.fn(async (data: any) => {
      if (name === 'audit_logs') fakeStore.audits.push(data);
    }),
    orderBy: () => ({
      get: vi.fn(async () => {
        const prefix = `${name}/`;
        const docs = [...fakeStore.records.entries()]
          .filter(([k]) => k.startsWith(prefix) && k.split('/').length === prefix.split('/').length)
          .map(([_, data]) => ({ data: () => data }));
        docs.sort((a, b) => (a.data().uploadedAt as number) - (b.data().uploadedAt as number));
        return { docs };
      }),
    }),
  });

  const collectionGroup = (name: string) => ({
    where: (_field: string, _op: string, value: string) => ({
      limit: (_n: number) => ({
        get: vi.fn(async () => {
          if (name !== 'health_vault_shares') return { empty: true, docs: [] };
          const match = [...fakeStore.shares.values()].find((s) => s.id === value);
          if (!match) return { empty: true, docs: [] };
          return { empty: false, docs: [{ data: () => match }] };
        }),
      }),
    }),
  });

  // Minimal runTransaction: delegates to the same docRef get/update so the
  // route's CLAUDE.md #19 transaction works against the in-memory store.
  const runTransaction = async (fn: any) => {
    const txn: any = {
      get: (ref: any) => ref.get(),
      set: (ref: any, data: any, opts?: any) => {
        void ref.set(data, opts);
        return txn;
      },
      update: (ref: any, patch: any) => {
        void ref.update(patch);
        return txn;
      },
    };
    return fn(txn);
  };

  const firestore = () => ({
    collection,
    collectionGroup,
    runTransaction,
  });

  return {
    default: { firestore, auth: () => ({ verifyIdToken: async () => ({ uid: 'worker_a' }) }) },
    firestore,
  };
});

// Importar router DESPUÉS de los mocks
import healthVaultRouter from './healthVault.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/health-vault', healthVaultRouter);
  return app;
}

beforeEach(() => {
  fakeStore.shares.clear();
  fakeStore.records.clear();
  fakeStore.users.clear();
  fakeStore.audits.length = 0;
  // Sembrar perfil del worker
  fakeStore.users.set('users/worker_a', { displayName: 'Juan Pérez' });
  // Sembrar 2 records del worker
  fakeStore.records.set('users/worker_a/health_vault/r1', {
    id: 'r1',
    workerUid: 'worker_a',
    type: 'lab_result',
    uploadedAt: Date.now() - 86400000,
    uploadedBy: 'self',
    meta: { title: 'Hemograma' },
    tags: [],
    shareScope: 'private',
  });
  fakeStore.records.set('users/worker_a/health_vault/r2', {
    id: 'r2',
    workerUid: 'worker_a',
    type: 'imaging',
    uploadedAt: Date.now() - 172800000,
    uploadedBy: 'doctor',
    meta: { title: 'RX columna' },
    tags: [],
    shareScope: 'private',
  });
});

describe('POST /api/health-vault/share', () => {
  it('creates a share token (scope=full) and returns secret + qrPayload', async () => {
    const res = await request(makeApp())
      .post('/api/health-vault/share')
      .send({ scope: 'full' });
    expect(res.status).toBe(201);
    expect(res.body.tokenId).toMatch(/^vs_/);
    expect(typeof res.body.secret).toBe('string');
    expect(res.body.qrPayload).toContain(res.body.secret);
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
    expect(fakeStore.audits.some((a) => a.action === 'health_vault.share.created')).toBe(true);
  });

  it('rejects invalid scope', async () => {
    const res = await request(makeApp())
      .post('/api/health-vault/share')
      .send({ scope: 'public' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
  });

  it('rejects topic scope without topic field', async () => {
    const res = await request(makeApp())
      .post('/api/health-vault/share')
      .send({ scope: 'topic' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('topic_required');
  });

  it('rejects ttl out of range', async () => {
    const res = await request(makeApp())
      .post('/api/health-vault/share')
      .send({ scope: 'full', ttlHours: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_ttl');
  });
});

describe('GET /api/health-vault/view/:tokenId/:secret', () => {
  async function createShare(scope: 'full' | 'recent' | 'topic', extra: any = {}) {
    const res = await request(makeApp())
      .post('/api/health-vault/share')
      .send({ scope, ...extra });
    return res.body as { tokenId: string; secret: string };
  }

  it('returns workerName + records on happy path', async () => {
    const { tokenId, secret } = await createShare('full');
    const res = await request(makeApp()).get(
      `/api/health-vault/view/${tokenId}/${secret}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.workerName).toBe('Juan Pérez');
    expect(res.body.records).toHaveLength(2);
    // ordenado uploadedAt desc
    expect(res.body.records[0].id).toBe('r1');
    expect(res.body.records[1].id).toBe('r2');
    expect(fakeStore.audits.some((a) => a.action === 'health_vault.share.consumed')).toBe(true);
  });

  it('returns 410 expired', async () => {
    const { tokenId, secret } = await createShare('full');
    // Forzar expiración: bajar expiresAt en el store
    const path = `users/worker_a/health_vault_shares/${tokenId}`;
    const rec = fakeStore.shares.get(path);
    fakeStore.shares.set(path, { ...rec, expiresAt: Date.now() - 1000 });
    const res = await request(makeApp()).get(
      `/api/health-vault/view/${tokenId}/${secret}`,
    );
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('expired');
  });

  it('returns 410 revoked', async () => {
    const { tokenId, secret } = await createShare('full');
    const path = `users/worker_a/health_vault_shares/${tokenId}`;
    const rec = fakeStore.shares.get(path);
    fakeStore.shares.set(path, { ...rec, revokedAt: Date.now() });
    const res = await request(makeApp()).get(
      `/api/health-vault/view/${tokenId}/${secret}`,
    );
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('revoked');
  });

  it('returns 401 invalid_token on bad secret', async () => {
    const { tokenId } = await createShare('full');
    const res = await request(makeApp()).get(
      `/api/health-vault/view/${tokenId}/bogus_secret`,
    );
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 404 invalid for unknown tokenId', async () => {
    const res = await request(makeApp()).get(
      '/api/health-vault/view/vs_unknown/whatever',
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('invalid');
  });
});

describe('POST /api/health-vault/share/:tokenId/revoke', () => {
  it('revokes an existing token', async () => {
    const create = await request(makeApp())
      .post('/api/health-vault/share')
      .send({ scope: 'full' });
    const tokenId: string = create.body.tokenId;

    const res = await request(makeApp())
      .post(`/api/health-vault/share/${tokenId}/revoke`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.revokedAt).toBe('number');
    expect(fakeStore.audits.some((a) => a.action === 'health_vault.share.revoked')).toBe(true);
  });

  it('returns 404 when token does not belong to caller', async () => {
    const res = await request(makeApp())
      .post('/api/health-vault/share/vs_doesnotexist/revoke')
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

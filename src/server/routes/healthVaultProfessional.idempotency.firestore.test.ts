// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const runtime = vi.hoisted(() => ({ uid: 'patient-1' }));
vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    req.user = { uid: runtime.uid } as import('express').Request['user'];
    next();
  },
}));
vi.mock('../middleware/auditLog.js', () => ({ auditServerEvent: vi.fn(async () => true) }));

import { createHealthVaultProfessionalRouter } from './healthVaultProfessional';
import { getEmulatorAdminFirestore } from '../../test/firestore-emulator-setup';

const record = {
  id: 'record-1', workerUid: 'patient-1', type: 'lab_result', uploadedAt: Date.now(),
  uploadedBy: 'self', meta: { title: 'Hemograma' }, tags: [], shareScope: 'private',
};
const payload = {
  version: 2, scope: 'full', resourceIds: ['record-1'],
  purpose: 'continuity_of_care', ttlHours: 24, maxSessions: 3,
};

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/health-vault', createHealthVaultProfessionalRouter());
  return server;
}

async function postShare(server: express.Express, key: string, body = payload) {
  return request(server).post('/api/health-vault/share').set('Idempotency-Key', key).send(body);
}

beforeEach(async () => {
  runtime.uid = 'patient-1';
  await getEmulatorAdminFirestore().collection('users').doc('patient-1')
    .collection('health_vault').doc(record.id).set(record);
});
afterEach(() => vi.clearAllMocks());

describe('Health Vault share idempotency with real Firestore transactions', () => {
  it('serializes parallel duplicate consent requests and replays the encrypted original result', async () => {
    const db = getEmulatorAdminFirestore();
    const key = 'emulator-share-retry-0000000001';
    const server = app();
    const [left, right] = await Promise.all([
      postShare(server, key),
      postShare(server, key),
    ]);

    expect([left.status, right.status].every(status => status === 201 || status === 409)).toBe(true);
    expect([left.status, right.status]).toContain(201);
    const firstSuccess = left.status === 201 ? left : right;
    const concurrentRetry = left.status === 201 ? right : left;
    let replay = firstSuccess;
    if (concurrentRetry.status === 409) replay = await postShare(server, key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(firstSuccess.body);

    const grants = await db.collection('users').doc('patient-1').collection('health_vault_shares').get();
    expect(grants.size).toBe(1);
    const createdAudits = await db.collection('audit_logs').where('action', '==', 'health_vault.grant.created').get();
    expect(createdAudits.size).toBe(1);
    const claims = await db.collection('system_idempotency_cache')
      .where('route', '==', 'health_vault_share_create').get();
    expect(claims.size).toBe(1);
    const claimData = claims.docs[0].data();
    expect(claimData.state).toBe('completed');
    expect(claimData.expiresAt.toMillis()).toBe(grants.docs[0].data().expiresAt);
    expect(JSON.stringify(claimData)).not.toContain(firstSuccess.body.secret);
    expect(JSON.stringify(grants.docs[0].data())).not.toContain(firstSuccess.body.secret);
    expect(claims.docs[0].id).not.toContain(key);
  });

  it('rejects same key with a different consent fingerprint without a second grant', async () => {
    const db = getEmulatorAdminFirestore();
    const key = 'emulator-share-retry-0000000002';
    const server = app();
    const first = await postShare(server, key);
    const mismatch = await postShare(server, key, { ...payload, purpose: 'second_opinion' });

    expect(first.status).toBe(201);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error).toBe('idempotency_key_payload_mismatch');
    const grants = await db.collection('users').doc('patient-1').collection('health_vault_shares').get();
    expect(grants.size).toBe(1);
    const audits = await db.collection('audit_logs').where('action', '==', 'health_vault.grant.created').get();
    expect(audits.size).toBe(1);
  });

  it('scopes the same client key to the authenticated owner', async () => {
    const db = getEmulatorAdminFirestore();
    const server = app();
    const key = 'emulator-share-retry-0000000003';
    const ownerA = await postShare(server, key);
    runtime.uid = 'patient-2';
    await db.collection('users').doc('patient-2').collection('health_vault').doc('record-1').set({
      ...record, workerUid: 'patient-2', id: 'record-1',
    });
    const ownerB = await postShare(server, key);

    expect(ownerA.status).toBe(201);
    expect(ownerB.status).toBe(201);
    expect(ownerB.body.grantId).not.toBe(ownerA.body.grantId);
    const claims = await db.collection('system_idempotency_cache')
      .where('route', '==', 'health_vault_share_create').get();
    expect(claims.size).toBe(2);
  });
});

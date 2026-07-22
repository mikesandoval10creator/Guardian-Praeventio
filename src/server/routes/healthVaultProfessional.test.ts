import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import type { HealthProfessionalIdentity } from '../../services/health/professionalIdentity';
import type { HealthAccessGrantV2 } from '../../services/health/vaultShare';
import type { VaultAccessSession } from '../../services/health/vaultAccessSession';
import type { HealthRecord } from '../../services/health/vaultRecord';

const caller: { uid: string } = { uid: 'patient-1' };
vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: any, _res: any, next: any) => {
    req.user = { uid: caller.uid };
    next();
  },
}));

import { createHealthVaultProfessionalRouter } from './healthVaultProfessional';

function professional(uid: string, status: HealthProfessionalIdentity['status'] = 'provisional') {
  return {
    uid,
    status,
    webauthnRequired: true,
  } as HealthProfessionalIdentity;
}

function record(id: string): HealthRecord {
  return {
    id,
    workerUid: 'patient-1',
    type: 'lab_result',
    uploadedAt: 1_753_056_000_000,
    uploadedBy: 'self',
    meta: { title: `Registro ${id}` },
    tags: [],
    shareScope: 'private',
    fileUri: `private/${id}.pdf`,
  };
}

function setup() {
  const grants = new Map<string, HealthAccessGrantV2>();
  const sessions = new Map<string, VaultAccessSession>();
  const records = new Map([['record-1', record('record-1')], ['record-2', record('record-2')]]);
  const professionals = new Map([
    ['doctor-1', professional('doctor-1')],
    ['doctor-2', professional('doctor-2', 'verified')],
  ]);
  const deps = {
    createGrant: vi.fn(async (grant: HealthAccessGrantV2) => grants.set(grant.id, grant)),
    getGrant: vi.fn(async (id: string) => grants.get(id) ?? null),
    replaceGrant: vi.fn(async (grant: HealthAccessGrantV2) => grants.set(grant.id, grant)),
    activateSession: vi.fn(
      async (grant: HealthAccessGrantV2, session: VaultAccessSession) => {
        grants.set(grant.id, grant);
        sessions.set(session.id, session);
      },
    ),
    getSession: vi.fn(async (id: string) => sessions.get(id) ?? null),
    getProfessional: vi.fn(async (uid: string) => professionals.get(uid) ?? null),
    getRecordsByIds: vi.fn(async (_uid: string, ids: string[]) =>
      ids.map((id) => records.get(id)).filter(Boolean) as HealthRecord[],
    ),
    getOwnerRecords: vi.fn(async () => [...records.values()]),
    getRecordById: vi.fn(async (_uid: string, id: string) => records.get(id) ?? null),
    getOwnerName: vi.fn(async () => 'Paciente Uno'),
    issueChallenge: vi.fn(async () => ({ challengeId: 'challenge-health-1', challenge: 'eA==' })),
    verifyAssertion: vi.fn(async () => ({ verified: true, credentialId: 'credential-1' })),
    auditAccess: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ({ bytes: Buffer.from('%PDF secure'), contentType: 'application/pdf' })),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/health-vault', createHealthVaultProfessionalRouter(deps));
  return { app, deps, grants, sessions, records, professionals };
}

async function createGrant(app: express.Express, recipientProfessionalUid = 'doctor-1') {
  const response = await request(app).post('/api/health-vault/share').send({
    version: 2,
    scope: 'full',
    resourceIds: ['record-1', 'record-2'],
    recipientProfessionalUid,
    purpose: 'continuity_of_care',
    ttlHours: 24,
    maxSessions: 3,
  });
  return response;
}

describe('Health Vault professional v2 routes', () => {
  beforeEach(() => {
    caller.uid = 'patient-1';
  });

  it('creates an owner-bound grant with an explicit resource snapshot and fragment secret', async () => {
    const { app, grants } = setup();
    const response = await createGrant(app);

    expect(response.status).toBe(201);
    expect(response.body.qrPayload).toBe(
      `https://praeventio.app/vault/share/${response.body.grantId}#${response.body.secret}`,
    );
    const persisted = grants.get(response.body.grantId)!;
    expect(persisted.ownerUid).toBe('patient-1');
    expect(persisted.resourceIds).toEqual(['record-1', 'record-2']);
    expect(JSON.stringify(persisted)).not.toContain(response.body.secret);
  });

  it('lists only safe metadata so the owner can choose records explicitly', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/health-vault/records');

    expect(response.status).toBe(200);
    expect(response.body.records.map((row: any) => row.id)).toEqual(['record-1', 'record-2']);
    expect(response.body.records.every((row: any) => row.fileUri === undefined)).toBe(true);
  });

  it('rejects any resource id that is not in the authenticated owner vault', async () => {
    const { app } = setup();
    const response = await request(app).post('/api/health-vault/share').send({
      version: 2,
      scope: 'full',
      resourceIds: ['record-1', 'record-from-another-patient'],
      recipientProfessionalUid: 'doctor-1',
      purpose: 'continuity_of_care',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('health_records_not_owned');
    expect(response.body.message).toMatch(/seleccionados/i);
  });

  it('issues a challenge bound to an external professional and grant without tenant membership', async () => {
    const { app, deps } = setup();
    const created = await createGrant(app);
    caller.uid = 'doctor-1';
    const response = await request(app).get(
      `/api/health-vault/view/${created.body.grantId}/challenge`,
    );

    expect(response.status).toBe(200);
    expect(deps.issueChallenge).toHaveBeenCalledWith('doctor-1', created.body.grantId);
    expect(response.body.challengeId).toBe('challenge-health-1');
  });

  it('verifies WebAuthn and creates a short-lived session only for the selected doctor', async () => {
    const { app, deps } = setup();
    const created = await createGrant(app);
    caller.uid = 'doctor-1';
    const response = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/session`)
      .send({ secret: created.body.secret, assertion: { challengeId: 'challenge-health-1' } });

    expect(response.status).toBe(201);
    expect(response.body.sessionToken).toMatch(/^hvs_[^.]+\.[A-Za-z0-9_-]+$/);
    expect(deps.verifyAssertion).toHaveBeenCalledWith(
      'doctor-1',
      created.body.grantId,
      expect.objectContaining({ challengeId: 'challenge-health-1' }),
    );
    expect(deps.activateSession).toHaveBeenCalledTimes(1);
  });

  it('rejects another valid doctor with a human recipient message', async () => {
    const { app } = setup();
    const created = await createGrant(app);
    caller.uid = 'doctor-2';
    const response = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/session`)
      .send({ secret: created.body.secret, assertion: { challengeId: 'challenge-health-1' } });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('recipient_mismatch');
    expect(response.body.message).toMatch(/otro profesional/i);
  });

  it('returns exactly the frozen records and no raw file URI', async () => {
    const { app, records } = setup();
    const created = await createGrant(app);
    records.set('record-future', record('record-future'));
    caller.uid = 'doctor-1';
    const sessionResponse = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/session`)
      .send({ secret: created.body.secret, assertion: { challengeId: 'challenge-health-1' } });

    const response = await request(app)
      .get(`/api/health-vault/view/${created.body.grantId}/records`)
      .set('X-Health-Vault-Session', sessionResponse.body.sessionToken);

    expect(response.status).toBe(200);
    expect(response.body.records.map((row: any) => row.id)).toEqual(['record-1', 'record-2']);
    expect(response.body.records.every((row: any) => row.fileUri === undefined)).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('record-future');
  });

  it('revalidates revocation before every records request', async () => {
    const { app, grants } = setup();
    const created = await createGrant(app);
    caller.uid = 'doctor-1';
    const sessionResponse = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/session`)
      .send({ secret: created.body.secret, assertion: { challengeId: 'challenge-health-1' } });
    const grant = grants.get(created.body.grantId)!;
    grants.set(grant.id, { ...grant, status: 'revoked', revokedAt: Date.now() });

    const response = await request(app)
      .get(`/api/health-vault/view/${created.body.grantId}/records`)
      .set('X-Health-Vault-Session', sessionResponse.body.sessionToken);

    expect(response.status).toBe(410);
    expect(response.body.error).toBe('revoked');
    expect(response.body.message).toMatch(/revocó/i);
  });

  it('fails closed if the critical clinical audit cannot be written', async () => {
    const { app, deps } = setup();
    const created = await createGrant(app);
    caller.uid = 'doctor-1';
    const sessionResponse = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/session`)
      .send({ secret: created.body.secret, assertion: { challengeId: 'challenge-health-1' } });
    deps.auditAccess.mockRejectedValueOnce(new Error('audit unavailable'));

    const response = await request(app)
      .get(`/api/health-vault/view/${created.body.grantId}/records`)
      .set('X-Health-Vault-Session', sessionResponse.body.sessionToken);

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('clinical_audit_unavailable');
    expect(response.body.message).toMatch(/seguridad/i);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import type { HealthProfessionalIdentity } from '../../services/health/professionalIdentity';
import {
  activateGrantSession,
  revokeHealthAccessGrant,
  type HealthAccessGrantV2,
} from '../../services/health/vaultShare';
import type { VaultAccessSession } from '../../services/health/vaultAccessSession';
import type { HealthRecord } from '../../services/health/vaultRecord';

const caller: { uid: string } = { uid: 'patient-1' };
vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: any, _res: any, next: any) => {
    req.user = { uid: caller.uid };
    next();
  },
}));

import {
  activateVaultSessionAtomically,
  createHealthVaultProfessionalRouter,
} from './healthVaultProfessional';

function professional(uid: string, status: HealthProfessionalIdentity['status'] = 'provisional') {
  return {
    uid,
    displayName: uid === 'doctor-1' ? 'Dra. Elena Morales' : 'Dr. Pedro Soto',
    registryNumber: uid === 'doctor-1' ? 'RNPI-12345' : 'RNPI-9988',
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
    analytics: { track: vi.fn(async () => undefined) },
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
    const { app, grants, deps } = setup();
    const response = await createGrant(app);

    expect(response.status).toBe(201);
    expect(response.body.qrPayload).toBe(
      `https://praeventio.app/vault/share/${response.body.grantId}#${response.body.secret}`,
    );
    const persisted = grants.get(response.body.grantId)!;
    expect(persisted.ownerUid).toBe('patient-1');
    expect(persisted.resourceIds).toEqual(['record-1', 'record-2']);
    expect(JSON.stringify(persisted)).not.toContain(response.body.secret);
    expect(deps.analytics.track).toHaveBeenCalledWith('health.share.recipient_confirmed', {
      country: 'CL',
      verification_status: 'provisional',
      channel: 'directory',
      duration_bucket: '1_to_24h',
      outcome_code: 'success',
    });
  });

  it('blocks cached clients from creating a legacy link that no viewer can open', async () => {
    const { app, deps } = setup();
    const response = await request(app).post('/api/health-vault/share').send({
      scope: 'full',
      ttlHours: 24,
    });

    expect(response.status).toBe(426);
    expect(response.body.error).toBe('health_vault_client_upgrade_required');
    expect(response.body.message).toMatch(/actualiza/i);
    expect(deps.createGrant).not.toHaveBeenCalled();
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

  it('persists recipient confirmation with an explicit audit action', async () => {
    const { app, deps } = setup();
    const created = await request(app).post('/api/health-vault/share').send({
      version: 2,
      scope: 'full',
      resourceIds: ['record-1'],
      purpose: 'second_opinion',
    });

    const response = await request(app)
      .post(`/api/health-vault/share/${created.body.grantId}/confirm-recipient`)
      .send({ professionalUid: 'doctor-2' });

    expect(response.status).toBe(200);
    expect(deps.replaceGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'active', recipientProfessionalUid: 'doctor-2' }),
      {
        action: 'health_vault.grant.recipient_confirmed',
        actorUid: 'patient-1',
      },
    );
    expect(deps.analytics.track).toHaveBeenCalledWith('health.share.recipient_confirmed', {
      country: 'CL',
      verification_status: 'verified',
      channel: 'qr',
      duration_bucket: '1_to_24h',
      outcome_code: 'success',
    });
  });

  it('lets the verified QR holder request access and waits for owner confirmation', async () => {
    const { app, deps, grants } = setup();
    const created = await request(app).post('/api/health-vault/share').send({
      version: 2,
      scope: 'full',
      resourceIds: ['record-1'],
      purpose: 'second_opinion',
    });
    caller.uid = 'doctor-1';

    const claim = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/claim`)
      .send({ secret: created.body.secret });

    expect(claim.status).toBe(202);
    expect(claim.body).toEqual({ status: 'pending', confirmationRequired: true });
    expect(deps.replaceGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        recipientProfessionalUid: undefined,
        recipientClaim: expect.objectContaining({
          professionalUid: 'doctor-1',
          registryNumber: 'RNPI-12345',
        }),
      }),
      {
        action: 'health_vault.grant.recipient_claimed',
        actorUid: 'doctor-1',
      },
    );
    expect(grants.get(created.body.grantId)?.status).toBe('pending');
  });

  it('does not let a QR holder claim with an invalid secret', async () => {
    const { app, deps } = setup();
    const created = await request(app).post('/api/health-vault/share').send({
      version: 2,
      scope: 'full',
      resourceIds: ['record-1'],
      purpose: 'second_opinion',
    });
    caller.uid = 'doctor-1';

    const claim = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/claim`)
      .send({ secret: 'not-the-right-secret-but-long-enough' });

    expect(claim.status).toBe(401);
    expect(claim.body.error).toBe('invalid_token');
    expect(deps.replaceGrant).not.toHaveBeenCalled();
  });

  it('persists owner revocation with an explicit audit action', async () => {
    const { app, deps } = setup();
    const created = await createGrant(app);

    const response = await request(app)
      .post(`/api/health-vault/share/${created.body.grantId}/revoke`)
      .send({ version: 2 });

    expect(response.status).toBe(200);
    expect(deps.replaceGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'revoked' }),
      {
        action: 'health_vault.grant.revoked',
        actorUid: 'patient-1',
      },
    );
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
    expect(deps.analytics.track).toHaveBeenCalledWith('health.share.session_started', {
      country: 'CL',
      verification_status: 'provisional',
      channel: 'qr',
      duration_bucket: '1_to_24h',
      outcome_code: 'success',
    });
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

  it('serves an authorized file through a body id and retires the identifier URL', async () => {
    const { app, deps } = setup();
    const created = await createGrant(app);
    caller.uid = 'doctor-1';
    const sessionResponse = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/session`)
      .send({ secret: created.body.secret, assertion: { challengeId: 'challenge-health-1' } });

    const response = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/file`)
      .set('X-Health-Vault-Session', sessionResponse.body.sessionToken)
      .send({ recordId: 'record-1' });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(deps.readFile).toHaveBeenCalledWith('private/record-1.pdf');
    expect(deps.auditAccess).toHaveBeenCalledWith(expect.objectContaining({
      action: 'health_vault.session.file_access_attempted',
    }));
    expect(deps.auditAccess).toHaveBeenCalledWith(expect.objectContaining({
      action: 'health_vault.session.file_ready',
    }));
    expect(deps.auditAccess).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'health_vault.session.file_accessed',
    }));

    const legacy = await request(app)
      .get(`/api/health-vault/view/${created.body.grantId}/file/record-1`)
      .set('X-Health-Vault-Session', sessionResponse.body.sessionToken);
    expect(legacy.status).toBe(426);
    expect(legacy.body.error).toBe('health_vault_client_upgrade_required');
  });

  it('audits an unavailable file as an attempt and never as a completed access', async () => {
    const { app, deps } = setup();
    const created = await createGrant(app);
    caller.uid = 'doctor-1';
    const sessionResponse = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/session`)
      .send({ secret: created.body.secret, assertion: { challengeId: 'challenge-health-1' } });
    deps.readFile.mockResolvedValueOnce(null as any);

    const response = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/file`)
      .set('X-Health-Vault-Session', sessionResponse.body.sessionToken)
      .send({ recordId: 'record-1' });

    expect(response.status).toBe(404);
    expect(deps.auditAccess).toHaveBeenCalledWith(expect.objectContaining({
      action: 'health_vault.session.file_access_attempted',
    }));
    expect(deps.auditAccess).toHaveBeenCalledWith(expect.objectContaining({
      action: 'health_vault.session.file_unavailable',
    }));
    expect(deps.auditAccess).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'health_vault.session.file_ready',
    }));
  });

  it('audits an authorized request even when the record has no downloadable file', async () => {
    const { app, deps } = setup();
    const created = await createGrant(app);
    caller.uid = 'doctor-1';
    const sessionResponse = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/session`)
      .send({ secret: created.body.secret, assertion: { challengeId: 'challenge-health-1' } });
    deps.getRecordById.mockResolvedValueOnce(null as any);

    const response = await request(app)
      .post(`/api/health-vault/view/${created.body.grantId}/file`)
      .set('X-Health-Vault-Session', sessionResponse.body.sessionToken)
      .send({ recordId: 'record-1' });

    expect(response.status).toBe(404);
    expect(deps.auditAccess).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'health_vault.session.file_access_attempted',
    }));
    expect(deps.auditAccess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'health_vault.session.file_unavailable',
    }));
    expect(deps.readFile).not.toHaveBeenCalled();
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

  it('rejects a stale session activation when Firestore observes a concurrent revocation', async () => {
    const { app, grants } = setup();
    const created = await createGrant(app);
    const original = grants.get(created.body.grantId)!;
    const staleActivated = activateGrantSession(original, 'doctor-1', 'credential-hash');
    const concurrentlyRevoked = revokeHealthAccessGrant(original, 'patient-1');
    const session: VaultAccessSession = {
      id: 'session-race',
      grantId: original.id,
      professionalUid: 'doctor-1',
      tokenHash: 'a'.repeat(64),
      createdAt: Date.now(),
      expiresAt: Date.now() + 300_000,
      revokedAt: null,
    };
    const grantRef = { kind: 'grant' };
    const professionalRef = { kind: 'professional' };
    const sessionRef = { kind: 'session' };
    const auditRef = { kind: 'audit' };
    const transaction = {
      get: vi.fn(async (ref: any) => ref === grantRef
        ? { exists: true, data: () => concurrentlyRevoked }
        : { exists: true, data: () => professional('doctor-1') }),
      set: vi.fn(),
      create: vi.fn(),
    };
    const fakeDb = {
      runTransaction: vi.fn(async (callback: any) => callback(transaction)),
      collection: vi.fn(() => ({ doc: () => auditRef })),
    };

    await expect(activateVaultSessionAtomically({
      db: fakeDb as any,
      grantRef: grantRef as any,
      professionals: { doc: () => professionalRef } as any,
      sessions: { doc: () => sessionRef } as any,
      grant: staleActivated,
      session,
    })).rejects.toThrow(/revoked/i);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.create).not.toHaveBeenCalled();
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

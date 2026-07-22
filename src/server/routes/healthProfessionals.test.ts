import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import type {
  HealthProfessionalIdentity,
  ProfessionalPublicProfile,
} from '../../services/health/professionalIdentity';

const caller = { uid: 'patient-1', admin: false };

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: any, _res: any, next: any) => {
    req.user = { ...caller };
    next();
  },
}));

import {
  createHealthProfessionalsRouter,
  parseProfessionalLookupKeys,
} from './healthProfessionals';

const pendingIdentity = {
  uid: 'doctor-external-1',
  displayName: 'Dra. Elena Morales',
  profession: 'physician',
  country: 'CL',
  registryAuthority: 'superintendencia_salud_cl',
  registryNumber: 'RNPI-12345',
  status: 'pending',
  webauthnRequired: true,
  registryAssurance: {
    provider: 'superintendencia_salud_cl_stub',
    status: 'not_configured',
    checkedAt: 1,
  },
  createdAt: 1,
  updatedAt: 1,
} as unknown as HealthProfessionalIdentity;

function setup() {
  const hasWebAuthnCredential = vi.fn(async () => true);
  const analytics = { track: vi.fn(async () => undefined) };
  const store = {
    enroll: vi.fn(async (input: any) => ({ ...pendingIdentity, ...input, rut: undefined })),
    get: vi.fn(async (uid: string) => (uid === pendingIdentity.uid ? pendingIdentity : null)),
    listPublic: vi.fn(async () => [
      {
        uid: 'doctor-verified-1',
        displayName: 'Dr. Pedro Soto',
        profession: 'physician',
        country: 'CL',
        registryAuthority: 'superintendencia_salud_cl',
        registryNumber: 'RNPI-9988',
        status: 'provisional',
      },
    ] satisfies ProfessionalPublicProfile[]),
    approveProvisional: vi.fn(async ({ targetUid }: any) => ({
      ...pendingIdentity,
      uid: targetUid,
      status: 'provisional' as const,
    })),
    transitionStatus: vi.fn(async ({ targetUid, to }: any) => ({
      ...pendingIdentity,
      uid: targetUid,
      status: to,
    })),
    revalidate: vi.fn(async ({ targetUid }: any) => ({
      identity: { ...pendingIdentity, uid: targetUid },
      verification: {
        status: 'not_configured' as const,
        provider: 'superintendencia_salud_cl_stub' as const,
      },
    })),
    reindexLookupKeys: vi.fn(async () => ({
      processed: 0,
      updated: 0,
      unchanged: 0,
      done: true,
    })),
  };
  const router = createHealthProfessionalsRouter({ store, hasWebAuthnCredential, analytics });
  const app = express();
  app.use(express.json());
  app.use('/api/health-professionals', router);
  return { app, store, hasWebAuthnCredential, analytics };
}

describe('health professional routes', () => {
  beforeEach(() => {
    caller.uid = 'patient-1';
    caller.admin = false;
  });

  it('parses active and previous lookup keys in declared rotation order', () => {
    expect(parseProfessionalLookupKeys(JSON.stringify({
      '2026-07': 'n'.repeat(64),
      '2026-01': 'o'.repeat(64),
    }), undefined)).toEqual([
      { version: '2026-07', key: 'n'.repeat(64) },
      { version: '2026-01', key: 'o'.repeat(64) },
    ]);
    expect(parseProfessionalLookupKeys('{bad-json', undefined)).toEqual([]);
  });

  it('enrolls only the authenticated account and returns no RUT', async () => {
    caller.uid = 'doctor-external-1';
    const { app, store, analytics } = setup();
    const response = await request(app).post('/api/health-professionals/enroll').send({
      displayName: 'Dra. Elena Morales',
      rut: '12.345.678-5',
      registryNumber: 'RNPI-12345',
      uid: 'attacker-selected-uid',
    });

    expect(response.status).toBe(201);
    expect(store.enroll).toHaveBeenCalledWith({
      uid: 'doctor-external-1',
      displayName: 'Dra. Elena Morales',
      rut: '12.345.678-5',
      registryNumber: 'RNPI-12345',
    });
    expect(JSON.stringify(response.body)).not.toContain('12.345.678-5');
    expect(analytics.track).toHaveBeenCalledWith('health.professional.onboarding_completed', {
      country: 'CL',
      outcome_code: 'success',
    });
    expect(analytics.track).toHaveBeenCalledWith('health.professional.verification_pending', {
      country: 'CL',
      verification_status: 'pending',
      outcome_code: 'success',
    });
    expect(response.body.message).toMatch(/revisión/i);
  });

  it('returns the caller professional state without RUT or tenant data', async () => {
    caller.uid = 'doctor-external-1';
    const { app } = setup();
    const response = await request(app).get('/api/health-professionals/me');

    expect(response.status).toBe(200);
    expect(response.body.identity.status).toBe('pending');
    expect(response.body.identity).not.toHaveProperty('rutCiphertext');
    expect(response.body.identity).not.toHaveProperty('rutLookupHmac');
    expect(response.body.identity).not.toHaveProperty('tenantId');
  });

  it('searches eligible professionals without tenant membership', async () => {
    const { app } = setup();
    const response = await request(app)
      .get('/api/health-professionals/search')
      .query({ q: 'Pedro' });

    expect(response.status).toBe(200);
    expect(response.body.professionals).toHaveLength(1);
    expect(response.body.professionals[0]).not.toHaveProperty('tenantId');
    expect(response.body.professionals[0]).not.toHaveProperty('rut');
  });

  it('denies tenant admins and requires the platform admin claim for review', async () => {
    const { app, store, analytics } = setup();
    const response = await request(app)
      .post('/api/health-professionals/review/doctor-external-1')
      .send({ evidenceReference: 'consulta-registro-2026-07-21' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'professional_review_not_authorized',
      message: 'No tienes autorización para revisar identidades profesionales.',
    });
    expect(store.approveProvisional).not.toHaveBeenCalled();
  });

  it('records an audited provisional decision but cannot call it officially verified', async () => {
    caller.uid = 'platform-reviewer-1';
    caller.admin = true;
    const { app, store, analytics } = setup();
    const response = await request(app)
      .post('/api/health-professionals/review/doctor-external-1')
      .send({ evidenceReference: 'consulta-registro-2026-07-21' });

    expect(response.status).toBe(200);
    expect(response.body.identity.status).toBe('provisional');
    expect(response.body.identity.status).not.toBe('verified');
    expect(store.approveProvisional).toHaveBeenCalledWith({
      targetUid: 'doctor-external-1',
      reviewerUid: 'platform-reviewer-1',
      evidenceReference: 'consulta-registro-2026-07-21',
    });
    expect(analytics.track).toHaveBeenCalledWith('health.professional.provisional_approved', {
      country: 'CL',
      verification_status: 'provisional',
      outcome_code: 'success',
    });
  });

  it('does not approve a professional until a server-verifiable WebAuthn credential exists', async () => {
    caller.uid = 'platform-reviewer-1';
    caller.admin = true;
    const { app, store, hasWebAuthnCredential } = setup();
    hasWebAuthnCredential.mockResolvedValue(false);

    const response = await request(app)
      .post('/api/health-professionals/review/doctor-external-1')
      .send({ evidenceReference: 'consulta-registro-2026-07-21' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'professional_webauthn_required',
      message: 'El profesional debe registrar una huella o llave de seguridad antes de ser habilitado.',
    });
    expect(hasWebAuthnCredential).toHaveBeenCalledWith('doctor-external-1');
    expect(store.approveProvisional).not.toHaveBeenCalled();
  });

  it('returns human validation errors instead of raw status codes', async () => {
    caller.uid = 'doctor-external-1';
    const { app } = setup();
    const response = await request(app).post('/api/health-professionals/enroll').send({
      displayName: '',
      rut: 'bad',
      registryNumber: '',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_professional_identity');
    expect(response.body.message).toMatch(/revisa/i);
  });

  it('provides an audited platform operation to suspend a professional', async () => {
    caller.uid = 'platform-reviewer-1';
    caller.admin = true;
    const { app, store } = setup();

    const response = await request(app)
      .post('/api/health-professionals/suspend/doctor-external-1')
      .send({ evidenceReference: 'credencial-comprometida-incidente-2026-07-21' });

    expect(response.status).toBe(200);
    expect(response.body.identity.status).toBe('suspended');
    expect(store.transitionStatus).toHaveBeenCalledWith({
      targetUid: 'doctor-external-1',
      reviewerUid: 'platform-reviewer-1',
      to: 'suspended',
      evidenceReference: 'credencial-comprometida-incidente-2026-07-21',
    });
  });

  it('exposes a fail-closed revalidation seam while the official API is unavailable', async () => {
    caller.uid = 'platform-reviewer-1';
    caller.admin = true;
    const { app, store } = setup();

    const response = await request(app)
      .post('/api/health-professionals/revalidate/doctor-external-1');

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('official_registry_not_configured');
    expect(response.body.message).toMatch(/conserva su estado actual/i);
    expect(store.revalidate).toHaveBeenCalledWith({
      targetUid: 'doctor-external-1',
      reviewerUid: 'platform-reviewer-1',
    });
  });
});

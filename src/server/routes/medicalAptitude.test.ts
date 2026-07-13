// Praeventio Guard — Sprint 35 Bucket — /api/medical/aptitude-cert tests.
//
// Praeventio NO push a MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Authenticated by default. The "worker forbidden" test overrides
// `currentRole` to a worker role.
const callerState: { uid: string; role: string } = { uid: 'uid-doc-1', role: 'medico_ocupacional' };

const adminState = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: any, _res: any, next: any) => {
    req.user = { uid: callerState.uid };
    next();
  },
}));

// Stub firebase-admin auth().getUser() so role resolution returns the
// expected custom claim per test.
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  const auth = {
    getUser: async (_uid: string) => ({ customClaims: { role: callerState.role } }),
  };
  return adminMock(() => adminState.db!, auth);
});

// Audit/observability — no-op so absence of firebase-admin firestore() doesn't crash.
vi.mock('../middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => true),
}));

// ── WebAuthn hardening (F4) — mock the canonical verifier + its collaborators
// so the /sign + /sign-challenge real-router flow is exercised without GCP.
const H = vi.hoisted(() => ({
  verdict: { verified: true, verifiedCredentialId: 'cred-doc-1' } as {
    verified: boolean;
    verifiedCredentialId?: string;
    reason?: string;
  },
}));
vi.mock('../auth/webauthnAssertion.js', () => ({
  verifyWebAuthnAssertion: vi.fn(async () => H.verdict),
}));
vi.mock('../auth/rpId.js', () => ({
  getWebauthnRpId: () => 'localhost',
  getWebauthnExpectedOrigin: () => 'http://localhost:5173',
}));
vi.mock('./curriculum.js', () => ({
  buildWebAuthnDb: () => ({}),
  buildWebAuthnCredentialsDb: () => ({}),
}));
vi.mock('../../services/auth/webauthnChallenge.js', () => ({
  generateWebAuthnChallenge: () => ({ challengeId: 'ch-1', challenge: 'Y2hhbGxlbmdl' }),
  storeWebAuthnChallenge: vi.fn(async () => undefined),
}));

import medicalAptitudeRouter from './medicalAptitude.js';
import * as aptitudeGenerator from '../../services/medical/aptitudeCertGenerator.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const { generateAptitudeCert } = aptitudeGenerator;

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/medical', medicalAptitudeRouter);
  return app;
}

const validInput = {
  workerUid: 'uid-worker-1',
  workerRut: '12.345.678-9',
  workerName: 'José Ñuñez',
  workerOccupation: 'Operario',
  doctorUid: 'uid-doc-1',
  doctorRut: '11.111.111-1',
  doctorName: 'Dra. Peña',
  doctorRsm: 'RSM-12345',
  examType: 'pre_empleo' as const,
  examDate: '2026-05-05',
  fitnessVerdict: 'apto' as const,
  restrictions: [],
  employerRut: '76.543.210-K',
  projectId: 'proj-alpha',
};

function seedMedicalProject(members = ['uid-doc-1', 'uid-worker-1']) {
  adminState.db!._seed(`projects/${validInput.projectId}`, {
    members,
    createdBy: 'project-owner',
    tenantId: 'tenant-alpha',
  });
  if (members.includes(validInput.workerUid)) {
    adminState.db!._seed(`projects/${validInput.projectId}/workers/${validInput.workerUid}`, {
      uid: validInput.workerUid,
      active: true,
    });
  }
}

describe('POST /api/medical/aptitude-cert/generate', () => {
  beforeEach(() => {
    adminState.db = createFakeFirestore();
    callerState.uid = 'uid-doc-1';
    callerState.role = 'medico_ocupacional';
    seedMedicalProject();
  });

  it('doctor caller succeeds with 200 and returns certId/certHash/pdfBase64', async () => {
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/generate')
      .send(validInput);
    expect(res.status).toBe(200);
    expect(res.body.certId).toMatch(/^APT-/);
    expect(res.body.certHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof res.body.pdfBase64).toBe('string');
    expect(res.body.pdfBase64.length).toBeGreaterThan(100);
    expect(res.body.json.legal.pushedToMutual).toBe(false);
  });

  it('admin caller also succeeds (admin can generate on behalf)', async () => {
    callerState.role = 'admin';
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/generate')
      .send(validInput);
    expect(res.status).toBe(200);
  });

  it('worker role gets 403 doctor_or_admin_required', async () => {
    callerState.role = 'worker';
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/generate')
      .send(validInput);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('doctor_or_admin_required');
  });

  it('Zod fail (bad RUT) returns 400 invalid_input', async () => {
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/generate')
      .send({ ...validInput, workerRut: 'NOT-A-RUT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
  });

  it('403 before generating when doctor is not a member of the requested project', async () => {
    adminState.db = createFakeFirestore();
    seedMedicalProject(['uid-worker-1', 'other-doctor']);
    const generateSpy = vi.spyOn(aptitudeGenerator, 'generateAptitudeCert');

    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/generate')
      .send(validInput);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect(generateSpy).not.toHaveBeenCalled();
    generateSpy.mockRestore();
  });

  it('403 before generating when worker is not in the project roster', async () => {
    adminState.db = createFakeFirestore();
    seedMedicalProject(['uid-doc-1']);
    const generateSpy = vi.spyOn(aptitudeGenerator, 'generateAptitudeCert');

    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/generate')
      .send(validInput);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect(generateSpy).not.toHaveBeenCalled();
    generateSpy.mockRestore();
  });
});

const FIXED_NOW = { now: () => new Date('2026-05-05T10:00:00Z') };
function signBody(certJson: unknown, certHash: string) {
  return {
    cert: certJson,
    certHash,
    signerRut: '11.111.111-1',
    // signedAt is deliberately NOT sent — the server stamps it.
    webauthnAssertion: {
      credentialId: 'cred-doc-1',
      rawId: 'cred-doc-1',
      clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0=',
      authenticatorData: 'YXV0aGVudGljYXRvckRhdGE=',
      signature: 'c2lnbmF0dXJl',
      challengeId: 'ch-1',
      type: 'public-key',
      clientExtensionResults: {},
    },
  };
}

describe('GET /api/medical/aptitude-cert/sign-challenge', () => {
  beforeEach(() => {
    adminState.db = createFakeFirestore();
    callerState.uid = 'uid-doc-1';
    callerState.role = 'medico_ocupacional';
    seedMedicalProject();
  });

  it('doctor gets a single-use server-issued challenge', async () => {
    const res = await request(makeApp()).get('/api/medical/aptitude-cert/sign-challenge');
    expect(res.status).toBe(200);
    expect(res.body.challengeId).toBe('ch-1');
    expect(res.body.challenge).toBe('Y2hhbGxlbmdl');
  });

  it('worker gets 403', async () => {
    callerState.role = 'worker';
    const res = await request(makeApp()).get('/api/medical/aptitude-cert/sign-challenge');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/medical/aptitude-cert/sign', () => {
  beforeEach(() => {
    adminState.db = createFakeFirestore();
    callerState.uid = 'uid-doc-1';
    callerState.role = 'medico_ocupacional';
    H.verdict = { verified: true, verifiedCredentialId: 'cred-doc-1' };
    seedMedicalProject();
  });

  it('200 signs with the VERIFIED registered credential when the assertion verifies', async () => {
    const cert = await generateAptitudeCert(validInput, FIXED_NOW);
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/sign')
      .send(signBody(cert.json, cert.certHash));
    expect(res.status).toBe(200);
    expect(res.body.certHash).toBe(cert.certHash);
    // Provenance = the server-VERIFIED credentialId, never a client-supplied key.
    expect(res.body.json.signature.credentialId).toBe('cred-doc-1');
    expect(res.body.json.signature.signerUid).toBe('uid-doc-1');
    expect(res.body.json.signature.payloadHashHex).toBe(cert.certHash);
    // signedAt is server-stamped (a valid recent ISO), never a client value.
    expect(res.body.json.signature.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.body.signedAt).toBe(res.body.json.signature.signedAt);
  });

  it('401 when the WebAuthn assertion fails to verify (no forged signature passes)', async () => {
    H.verdict = { verified: false, reason: 'unknown_credential' };
    const cert = await generateAptitudeCert(validInput, FIXED_NOW);
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/sign')
      .send(signBody(cert.json, cert.certHash));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('signature_invalid');
  });

  it('403 when a doctor signs a cert that is not theirs', async () => {
    callerState.uid = 'uid-OTHER-doctor';
    seedMedicalProject(['uid-doc-1', 'uid-worker-1', 'uid-OTHER-doctor']);
    const cert = await generateAptitudeCert(validInput, FIXED_NOW);
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/sign')
      .send(signBody(cert.json, cert.certHash));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('doctor_uid_mismatch');
  });

  it('403 before signing when doctor is not a member of the cert project', async () => {
    const cert = await generateAptitudeCert(validInput, FIXED_NOW);
    adminState.db = createFakeFirestore();
    seedMedicalProject(['uid-worker-1', 'other-doctor']);

    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/sign')
      .send(signBody(cert.json, cert.certHash));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on a cert_hash mismatch (signed payload must be THIS cert)', async () => {
    const cert = await generateAptitudeCert(validInput, FIXED_NOW);
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/sign')
      .send(signBody(cert.json, 'f'.repeat(64)));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cert_hash_mismatch');
  });

  it('403 for a worker caller', async () => {
    callerState.role = 'worker';
    const cert = await generateAptitudeCert(validInput, FIXED_NOW);
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/sign')
      .send(signBody(cert.json, cert.certHash));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('doctor_or_admin_required');
  });

  it('400 on a malformed body (missing webauthnAssertion)', async () => {
    const cert = await generateAptitudeCert(validInput, FIXED_NOW);
    const res = await request(makeApp())
      .post('/api/medical/aptitude-cert/sign')
      .send({ cert: cert.json, certHash: cert.certHash, signerRut: '11.111.111-1', signedAt: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
  });
});

// Praeventio Guard — Sprint 35 Bucket — /api/medical/aptitude-cert tests.
//
// Praeventio NO push a MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Authenticated by default. The "worker forbidden" test overrides
// `currentRole` to a worker role.
const callerState: { uid: string; role: string } = { uid: 'uid-doc-1', role: 'medico_ocupacional' };

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: any, _res: any, next: any) => {
    req.user = { uid: callerState.uid };
    next();
  },
}));

// Stub firebase-admin auth().getUser() so role resolution returns the
// expected custom claim per test.
vi.mock('firebase-admin', () => {
  const auth = () => ({
    getUser: async (_uid: string) => ({ customClaims: { role: callerState.role } }),
  });
  return {
    default: { auth },
    auth,
  };
});

// Audit/observability — no-op so absence of firebase-admin firestore() doesn't crash.
vi.mock('../middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => true),
}));

import medicalAptitudeRouter from './medicalAptitude.js';

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

describe('POST /api/medical/aptitude-cert/generate', () => {
  beforeEach(() => {
    callerState.uid = 'uid-doc-1';
    callerState.role = 'medico_ocupacional';
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
});

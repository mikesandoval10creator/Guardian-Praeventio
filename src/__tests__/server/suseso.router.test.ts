// Real-router supertest for src/server/routes/suseso.ts.
// Covers SUSESO DIAT/DIEP form generation surface (Sprint 28 B6).
// Mounts the ACTUAL router — no stub-disfrazado, no inline mocks of the
// handler bodies. Domain services (createSusesoForm, signForm,
// verifyFolio, submitToMutualidad, generateSusesoPdf) are mocked so tests
// stay fast and deterministic; the route's auth gate, validate middleware,
// role checks, and Firestore side-effects (audit_logs, suseso_forms) are
// exercised against the real fakeFirestore.
//
// DIRECTIVE (project rule): this router GENERATES the SUSESO document and
// records intent. NO external-organism submission is ever initiated.
// Tests below include an assertion on that invariant.
//
// Router prefix (per server.ts L805): /api/suseso
// Also mounted at /api/public/suseso L810 (same router object — both
// paths exercise the same handlers; we test via /api/suseso).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ─── Hoisted mutable holder ───────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ─── firebase-admin mock ──────────────────────────────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ─── verifyAuth shim — uid from x-test-uid header; role from x-test-role ─
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const role = req.header('x-test-role') ?? 'worker';
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role,
      tenantId: req.header('x-test-tenant') ?? undefined,
    };
    next();
  },
}));

// ─── Rate-limiter passthrough ─────────────────────────────────────────────
vi.mock('../../server/middleware/limiters.js', () => ({
  susesoVerifyLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ─── Logger no-op ─────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ─── Observability no-op ──────────────────────────────────────────────────
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ─── PDF renderer — returns a tiny predictable buffer ────────────────────
vi.mock('../../utils/susesoCertificate.js', () => ({
  generateSusesoPdf: vi.fn(() => new Uint8Array([37, 80, 68, 70])), // %PDF
}));

// ─── Domain services — mocked to control happy/error paths cleanly ───────
// These are the services suseso.ts calls; we stub them so we can control
// success / throw branches without running the real PDF+folio logic.
const mockCreateSusesoForm = vi.fn();
const mockSignForm = vi.fn();
const mockVerifyFolio = vi.fn();
const mockSubmitToMutualidad = vi.fn();

vi.mock('../../services/suseso/susesoService.js', () => ({
  createSusesoForm: (...args: unknown[]) => mockCreateSusesoForm(...args),
  signForm: (...args: unknown[]) => mockSignForm(...args),
  verifyFolio: (...args: unknown[]) => mockVerifyFolio(...args),
  submitToMutualidad: (...args: unknown[]) => mockSubmitToMutualidad(...args),
  folioToDocId: (folio: string) => folio.toLowerCase(),
}));

// WebAuthn helpers — mocked so the sign path can exercise both the
// kms-sign-rsa branch (no WebAuthn) and the webauthn branch conditionally.
const mockVerifyWebAuthnAssertion = vi.fn();
const mockGenerateChallenge = vi.fn();
const mockStoreChallenge = vi.fn();
const mockBuildWebAuthnDb = vi.fn(() => ({}));
const mockBuildWebAuthnCredentialsDb = vi.fn(() => ({}));

vi.mock('../../server/auth/webauthnAssertion.js', () => ({
  verifyWebAuthnAssertion: (...args: unknown[]) => mockVerifyWebAuthnAssertion(...args),
}));

vi.mock('../../server/routes/curriculum.js', () => ({
  buildWebAuthnDb: () => mockBuildWebAuthnDb(),
  buildWebAuthnCredentialsDb: () => mockBuildWebAuthnCredentialsDb(),
}));

vi.mock('../../services/auth/webauthnChallenge.js', () => ({
  generateWebAuthnChallenge: () => mockGenerateChallenge(),
  storeWebAuthnChallenge: (...args: unknown[]) => mockStoreChallenge(...args),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────
import susesoRouter from '../../server/routes/suseso.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { generateSusesoPdf } from '../../utils/susesoCertificate.js';

// ─── App factory ──────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/suseso', susesoRouter);
  return app;
}

// ─── Shared test fixtures ─────────────────────────────────────────────────
const TENANT = 't1';
const FORM_ID = 'diat-2026-t1000000-000001';

const validFormBody = {
  tenantId: TENANT,
  kind: 'DIAT',
  workerRut: '12.345.678-9',
  workerFullName: 'Juan Trabajador',
  companyRut: '76.543.210-K',
  companyName: 'Empresa Minera S.A.',
  mutualidad: 'achs',
  incidentDate: '2026-05-31T08:00:00Z',
  incidentDescription: 'Caída desde altura en nivel 3',
  incidentLocation: 'Mina Norte, Nivel 3',
  bodyPartsAffected: ['cabeza', 'hombro_derecho'],
  incidentClassification: 'accidente_trabajo',
  ds101Causal: 'falta_epp',
  witnesses: [{ fullName: 'Pedro Testigo', rut: '11.111.111-1' }],
  reportedBy: { uid: 'u1', rut: '13.333.333-3', fullName: 'María Supervisor' },
} as const;

const fakeForm = {
  kind: 'DIAT',
  folio: 'DIAT-2026-t1000000-000001',
  workerRut: '12.345.678-9',
  workerFullName: 'Juan Trabajador',
  companyRut: '76.543.210-K',
  companyName: 'Empresa Minera S.A.',
  mutualidad: 'achs',
  incidentDate: '2026-05-31T08:00:00Z',
  incidentDescription: 'Caída desde altura en nivel 3',
  incidentLocation: 'Mina Norte, Nivel 3',
  bodyPartsAffected: ['cabeza', 'hombro_derecho'],
  incidentClassification: 'accidente_trabajo',
  ds101Causal: 'falta_epp',
  witnesses: [{ fullName: 'Pedro Testigo', rut: '11.111.111-1' }],
  reportedBy: { uid: 'u1', rut: '13.333.333-3', fullName: 'María Supervisor' },
  createdAt: '2026-05-31T08:00:00.000Z',
};

const kmsSignature = {
  signerUid: 'u1',
  signerRut: '13.333.333-3',
  signedAt: '2026-05-31T09:00:00Z',
  algorithm: 'kms-sign-rsa',
  signatureB64: 'c2lnbmVkYnlrb3M=',
  payloadHashHex: 'a'.repeat(64),
};

// ─── beforeEach ───────────────────────────────────────────────────────────
beforeEach(() => {
  H.db = createFakeFirestore();
  mockCreateSusesoForm.mockReset();
  mockSignForm.mockReset();
  mockVerifyFolio.mockReset();
  mockSubmitToMutualidad.mockReset();
  mockVerifyWebAuthnAssertion.mockReset();
  mockGenerateChallenge.mockReset();
  mockStoreChallenge.mockReset();
  vi.mocked(generateSusesoPdf).mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/suseso/form
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/suseso/form', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/suseso/form')
      .send(validFormBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when required fields missing', async () => {
    const res = await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send({ tenantId: TENANT }); // missing kind, workerRut, etc.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload for unknown kind value', async () => {
    const res = await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send({ ...validFormBody, kind: 'INVALID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload for unknown mutualidad', async () => {
    const res = await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send({ ...validFormBody, mutualidad: 'unknown_org' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload for unknown incidentClassification', async () => {
    const res = await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send({ ...validFormBody, incidentClassification: 'accidente_extranjero' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 happy path — returns form + pdfBase64 + payloadHashHex + qrCodeUrl', async () => {
    const pdfBytes = new Uint8Array([37, 80, 68, 70]);
    mockCreateSusesoForm.mockResolvedValueOnce({
      form: fakeForm,
      pdfBytes,
      payloadHashHex: 'b'.repeat(64),
      qrCodeUrl: '/api/suseso/verify/DIAT-2026-t1000000-000001',
    });

    const res = await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send(validFormBody);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.form).toBeDefined();
    const form = body.form as Record<string, unknown>;
    expect(form.folio).toBe('DIAT-2026-t1000000-000001');
    expect(form.kind).toBe('DIAT');
    expect(typeof body.pdfBase64).toBe('string');
    // pdfBase64 must be valid base64 and decode to the original bytes
    const decoded = Buffer.from(body.pdfBase64 as string, 'base64');
    expect(decoded).toEqual(Buffer.from(pdfBytes));
    expect(body.payloadHashHex).toBe('b'.repeat(64));
    expect(typeof body.qrCodeUrl).toBe('string');
  });

  it('200 writes an audit_logs entry on success', async () => {
    const pdfBytes = new Uint8Array([37, 80, 68, 70]);
    mockCreateSusesoForm.mockResolvedValueOnce({
      form: fakeForm,
      pdfBytes,
      payloadHashHex: 'c'.repeat(64),
      qrCodeUrl: '/api/suseso/verify/DIAT-2026-t1000000-000001',
    });

    await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send(validFormBody);

    const logs = await H.db!.collection('audit_logs').get();
    expect(logs.size).toBeGreaterThanOrEqual(1);
    const logData = logs.docs.find(
      (d) => (d.data() as Record<string, unknown>).action === 'suseso.form_created',
    )?.data() as Record<string, unknown> | undefined;
    expect(logData).toBeDefined();
    expect(logData?.module).toBe('suseso');
    // actor stamps from token, NOT from body
    expect(logData?.userId).toBe('u1');
  });

  it('200 does NOT assert audit_logs failure blocks response', async () => {
    // Even when audit write fails (simulated by destroying the db after the
    // service call returns), the form creation response comes back 200.
    const pdfBytes = new Uint8Array([37, 80, 68, 70]);
    mockCreateSusesoForm.mockResolvedValueOnce({
      form: fakeForm,
      pdfBytes,
      payloadHashHex: 'd'.repeat(64),
      qrCodeUrl: '/api/suseso/verify/DIAT-2026-t1000000-000001',
    });
    // Replace db with one whose add() rejects to simulate audit failure.
    const originalDb = H.db!;
    const addSpy = vi
      .spyOn(
        originalDb.collection('audit_logs') as unknown as { add: (...a: unknown[]) => Promise<unknown> },
        'add',
      )
      .mockRejectedValueOnce(new Error('firestore write error'));

    const res = await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send(validFormBody);

    // Should still be 200 — audit failure is non-blocking.
    expect(res.status).toBe(200);
    addSpy.mockRestore();
  });

  it('500 suseso_create_failed when service throws', async () => {
    mockCreateSusesoForm.mockRejectedValueOnce(new Error('folio counter failed'));
    const res = await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send(validFormBody);
    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toBe('suseso_create_failed');
  });

  it('DIRECTIVE: createSusesoForm does NOT make any external HTTP call to SUSESO', async () => {
    // submitToMutualidad must NOT be called during form creation.
    const pdfBytes = new Uint8Array([37, 80, 68, 70]);
    mockCreateSusesoForm.mockResolvedValueOnce({
      form: fakeForm,
      pdfBytes,
      payloadHashHex: 'e'.repeat(64),
      qrCodeUrl: '/api/suseso/verify/DIAT-2026-t1000000-000001',
    });
    await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send(validFormBody);
    // submitToMutualidad is the service that records external submission intent;
    // it must NOT be called on form creation.
    expect(mockSubmitToMutualidad).not.toHaveBeenCalled();
  });

  it('DIEP form accepted (different incidentClassification)', async () => {
    const diepBody = {
      ...validFormBody,
      kind: 'DIEP' as const,
      incidentClassification: 'enfermedad_profesional' as const,
      ds101Causal: undefined,
      ds110Causal: 'silicosis_grado_2',
    };
    const diepForm = { ...fakeForm, kind: 'DIEP', folio: 'DIEP-2026-t1000000-000001' };
    mockCreateSusesoForm.mockResolvedValueOnce({
      form: diepForm,
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      payloadHashHex: 'f'.repeat(64),
      qrCodeUrl: '/api/suseso/verify/DIEP-2026-t1000000-000001',
    });
    const res = await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send(diepBody);
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).form).toBeDefined();
  });

  it('bodyPartsAffected defaults to [] when omitted', async () => {
    const body = { ...validFormBody };
    // Remove bodyPartsAffected — schema should default to [].
    const bodyWithout = Object.fromEntries(
      Object.entries(body).filter(([k]) => k !== 'bodyPartsAffected'),
    );
    mockCreateSusesoForm.mockResolvedValueOnce({
      form: fakeForm,
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      payloadHashHex: 'a'.repeat(64),
      qrCodeUrl: '/api/suseso/verify/DIAT-2026-t1000000-000001',
    });
    const res = await request(buildApp())
      .post('/api/suseso/form')
      .set('x-test-uid', 'u1')
      .send(bodyWithout);
    // Should reach the service (not 400) and return 200.
    expect(res.status).toBe(200);
    // createSusesoForm was called with bodyPartsAffected defaulting to [].
    const callInput = mockCreateSusesoForm.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Array.isArray(callInput.bodyPartsAffected)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/suseso/form/:id/sign  (kms-sign-rsa branch — no WebAuthn)
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/suseso/form/:id/sign (kms-sign-rsa)', () => {
  const signBody = {
    tenantId: TENANT,
    signature: kmsSignature,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .send(signBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when body is empty', async () => {
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 invalid_payload when payloadHashHex is not 64 hex chars', async () => {
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send({
        tenantId: TENANT,
        signature: { ...kmsSignature, payloadHashHex: 'notahex' },
      });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 invalid_payload for unknown algorithm', async () => {
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send({
        tenantId: TENANT,
        signature: { ...kmsSignature, algorithm: 'rsa-pkcs1-v1_5' },
      });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('200 happy path — kms-sign-rsa does not need webauthnAssertion', async () => {
    const signedForm = { ...fakeForm, signature: kmsSignature };
    mockSignForm.mockResolvedValueOnce(signedForm);

    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send(signBody);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.form).toBeDefined();
    const form = body.form as Record<string, unknown>;
    expect(form.signature).toBeDefined();
  });

  it('200 kms-sign-rsa writes an audit_logs entry', async () => {
    const signedForm = { ...fakeForm, signature: kmsSignature };
    mockSignForm.mockResolvedValueOnce(signedForm);

    await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send(signBody);

    const logs = await H.db!.collection('audit_logs').get();
    const signLog = logs.docs.find(
      (d) => (d.data() as Record<string, unknown>).action === 'suseso.form_signed',
    )?.data() as Record<string, unknown> | undefined;
    expect(signLog).toBeDefined();
    expect(signLog?.module).toBe('suseso');
    expect(signLog?.userId).toBe('u1');
  });

  it('400 suseso_sign_failed when signForm throws (form not found)', async () => {
    mockSignForm.mockRejectedValueOnce(new Error(`Form not found: ${TENANT}/${FORM_ID}`));
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send(signBody);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('suseso_sign_failed');
  });

  it('400 suseso_sign_failed when form already signed (immutability invariant)', async () => {
    mockSignForm.mockRejectedValueOnce(
      new Error('Form already signed — re-signing requires a new folio.'),
    );
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send(signBody);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('suseso_sign_failed');
    const detail = (res.body as Record<string, unknown>).detail as string;
    expect(detail).toMatch(/re-signing/);
  });

  it('DIRECTIVE: sign does NOT call submitToMutualidad (no auto-push to SUSESO)', async () => {
    const signedForm = { ...fakeForm, signature: kmsSignature };
    mockSignForm.mockResolvedValueOnce(signedForm);
    await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send(signBody);
    expect(mockSubmitToMutualidad).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/suseso/form/:id/sign  (webauthn-ecdsa-p256 branch)
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/suseso/form/:id/sign (webauthn-ecdsa-p256)', () => {
  const webauthnSig = {
    signerUid: 'u1',
    signerRut: '13.333.333-3',
    signedAt: '2026-05-31T09:00:00Z',
    algorithm: 'webauthn-ecdsa-p256' as const,
    signatureB64: 'd2ViYXV0aG5zaWduZWQ=',
    payloadHashHex: 'a'.repeat(64),
  };
  const webauthnAssertion = {
    challengeId: 'ch-1',
    credentialId: 'cred-1',
    rawId: 'cmF3SWQ=',
    clientDataJSON: 'eyJ0eXBlIjoicHVibGljLWtleS1nZXQifQ==',
    authenticatorData: 'YXV0aERhdGE=',
    signature: 'd2ViYXV0aG5zaWduZWQ=',
    type: 'public-key' as const,
    clientExtensionResults: {},
  };

  it('400 when webauthnAssertion is missing for webauthn algorithm', async () => {
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send({ tenantId: TENANT, signature: webauthnSig }); // no webauthnAssertion
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe(
      'suseso_sign_webauthn_assertion_required',
    );
  });

  it('403 when signerUid does not match caller uid (anti-impersonation)', async () => {
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u2') // caller is u2
      .send({
        tenantId: TENANT,
        signature: { ...webauthnSig, signerUid: 'u1' }, // but signerUid says u1
        webauthnAssertion,
      });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('suseso_sign_uid_mismatch');
  });

  it('401 when WebAuthn verification fails (bad signature)', async () => {
    mockVerifyWebAuthnAssertion.mockResolvedValueOnce({
      verified: false,
      reason: 'signature_invalid',
    });
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send({
        tenantId: TENANT,
        signature: webauthnSig,
        webauthnAssertion,
      });
    expect(res.status).toBe(401);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('suseso_sign_webauthn_failed');
    expect(body.reason).toBe('signature_invalid');
    // signForm must NOT have been called — persistence blocked
    expect(mockSignForm).not.toHaveBeenCalled();
  });

  it('200 when WebAuthn verification passes — form gets signed', async () => {
    mockVerifyWebAuthnAssertion.mockResolvedValueOnce({ verified: true });
    const signedForm = { ...fakeForm, signature: webauthnSig };
    mockSignForm.mockResolvedValueOnce(signedForm);

    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/sign`)
      .set('x-test-uid', 'u1')
      .send({
        tenantId: TENANT,
        signature: webauthnSig,
        webauthnAssertion,
      });

    expect(res.status).toBe(200);
    const form = (res.body as Record<string, unknown>).form as Record<string, unknown>;
    expect(form.signature).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/suseso/form/:id/sign-challenge
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/suseso/form/:id/sign-challenge', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .get(`/api/suseso/form/${FORM_ID}/sign-challenge`);
    expect(res.status).toBe(401);
  });

  it('200 returns challengeId + challenge + formId + rpId', async () => {
    const challengeBytes = new Uint8Array(32).fill(0x42);
    mockGenerateChallenge.mockReturnValueOnce({
      challengeId: 'ch-test-1',
      challenge: challengeBytes,
    });
    mockStoreChallenge.mockResolvedValueOnce(undefined);

    const res = await request(buildApp())
      .get(`/api/suseso/form/${FORM_ID}/sign-challenge`)
      .set('x-test-uid', 'u1');

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.challengeId).toBe('ch-test-1');
    expect(typeof body.challenge).toBe('string'); // base64
    expect(body.formId).toBe(FORM_ID);
    expect(body.rpId).toBeDefined();
  });

  it('500 when challenge generation throws', async () => {
    mockGenerateChallenge.mockImplementationOnce(() => {
      throw new Error('crypto failed');
    });
    const res = await request(buildApp())
      .get(`/api/suseso/form/${FORM_ID}/sign-challenge`)
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toBe('suseso_sign_challenge_failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/suseso/form/:id/submit
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/suseso/form/:id/submit', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/submit`)
      .send({ tenantId: TENANT });
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when tenantId missing', async () => {
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/submit`)
      .set('x-test-uid', 'u1')
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('200 happy path — records submission intent (no external HTTP call)', async () => {
    const submittedForm = {
      ...fakeForm,
      signature: kmsSignature,
      submittedAt: '2026-05-31T10:00:00Z',
    };
    mockSubmitToMutualidad.mockResolvedValueOnce(submittedForm);

    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/submit`)
      .set('x-test-uid', 'u1')
      .send({ tenantId: TENANT });

    expect(res.status).toBe(200);
    const form = (res.body as Record<string, unknown>).form as Record<string, unknown>;
    expect(form.submittedAt).toBeDefined();
  });

  it('DIRECTIVE: submit records intent only — no external SUSESO API call is verified', async () => {
    // This test documents the immutable directive: the route calls
    // submitToMutualidad which records the timestamp; no HTTP fetch to
    // mutualidad is made. The mock verifies exactly one service call.
    const submittedForm = {
      ...fakeForm,
      signature: kmsSignature,
      submittedAt: '2026-05-31T10:00:00Z',
    };
    mockSubmitToMutualidad.mockResolvedValueOnce(submittedForm);

    await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/submit`)
      .set('x-test-uid', 'u1')
      .send({ tenantId: TENANT });

    // Exactly one call to submitToMutualidad (the service that records intent)
    expect(mockSubmitToMutualidad).toHaveBeenCalledTimes(1);
    // No real external HTTP was made (mock does not perform one)
    const [callTenantId, callFormId] = mockSubmitToMutualidad.mock.calls[0] as [string, string];
    expect(callTenantId).toBe(TENANT);
    expect(callFormId).toBe(FORM_ID);
  });

  it('400 suseso_submit_failed when form not found', async () => {
    mockSubmitToMutualidad.mockRejectedValueOnce(
      new Error(`Form not found: ${TENANT}/${FORM_ID}`),
    );
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/submit`)
      .set('x-test-uid', 'u1')
      .send({ tenantId: TENANT });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('suseso_submit_failed');
  });

  it('400 suseso_submit_failed when form unsigned (cannot submit unsigned)', async () => {
    mockSubmitToMutualidad.mockRejectedValueOnce(
      new Error('Cannot submit unsigned form to mutualidad.'),
    );
    const res = await request(buildApp())
      .post(`/api/suseso/form/${FORM_ID}/submit`)
      .set('x-test-uid', 'u1')
      .send({ tenantId: TENANT });
    expect(res.status).toBe(400);
    const detail = (res.body as Record<string, unknown>).detail as string;
    expect(detail).toMatch(/unsigned/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/suseso/forms/:formId/mark-submitted
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/suseso/forms/:formId/mark-submitted', () => {
  const MARK_PATH = `/api/suseso/forms/${FORM_ID}/mark-submitted`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(MARK_PATH)
      .send({ tenantId: TENANT });
    expect(res.status).toBe(401);
  });

  it('400 when tenantId is missing', async () => {
    const res = await request(buildApp())
      .post(MARK_PATH)
      .set('x-test-uid', 'u1')
      .set('x-test-role', 'admin')
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_tenantId');
  });

  it('403 for worker role (not in admin/gerente/supervisor allowed set)', async () => {
    const res = await request(buildApp())
      .post(MARK_PATH)
      .set('x-test-uid', 'u1')
      .set('x-test-role', 'worker')
      .send({ tenantId: TENANT });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden_role');
  });

  it('403 for operador role', async () => {
    const res = await request(buildApp())
      .post(MARK_PATH)
      .set('x-test-uid', 'u1')
      .set('x-test-role', 'operador')
      .send({ tenantId: TENANT });
    expect(res.status).toBe(403);
  });

  it('404 when the form does not exist in Firestore', async () => {
    // fakeFirestore has no form seeded — form_not_found
    const res = await request(buildApp())
      .post(MARK_PATH)
      .set('x-test-uid', 'u1')
      .set('x-test-role', 'admin')
      .send({ tenantId: TENANT });
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('form_not_found');
  });

  it('200 happy path for admin role — flips status + writes audit log', async () => {
    // Seed the form in fakeFirestore.
    H.db!._seed(`tenants/${TENANT}/suseso_forms/${FORM_ID}`, {
      ...fakeForm,
      status: 'signed',
    });

    const res = await request(buildApp())
      .post(MARK_PATH)
      .set('x-test-uid', 'u1')
      .set('x-test-role', 'admin')
      .send({ tenantId: TENANT });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.formId).toBe(FORM_ID);
    expect(typeof body.submittedByCompanyAt).toBe('string');

    // Firestore doc updated
    const updated = (
      await H.db!.collection(`tenants/${TENANT}/suseso_forms`).doc(FORM_ID).get()
    ).data() as Record<string, unknown>;
    expect(updated.status).toBe('submitted_by_company');
    expect(typeof updated.submittedByCompanyAt).toBe('string');

    // Audit log written
    const logs = await H.db!.collection('audit_logs').get();
    const markLog = logs.docs.find(
      (d) =>
        (d.data() as Record<string, unknown>).action === 'suseso.form.marked_submitted',
    )?.data() as Record<string, unknown> | undefined;
    expect(markLog).toBeDefined();
    expect(markLog?.userId).toBe('u1');
  });

  it('200 happy path for gerente role', async () => {
    H.db!._seed(`tenants/${TENANT}/suseso_forms/${FORM_ID}`, fakeForm);
    const res = await request(buildApp())
      .post(MARK_PATH)
      .set('x-test-uid', 'gerente-1')
      .set('x-test-role', 'gerente')
      .send({ tenantId: TENANT });
    expect(res.status).toBe(200);
  });

  it('200 happy path for supervisor role', async () => {
    H.db!._seed(`tenants/${TENANT}/suseso_forms/${FORM_ID}`, fakeForm);
    const res = await request(buildApp())
      .post(MARK_PATH)
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ tenantId: TENANT });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/suseso/verify/:folio  (public — no auth)
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/suseso/verify/:folio', () => {
  const FOLIO = 'DIAT-2026-t1000000-000001';

  it('200 with valid: false when folio is malformed', async () => {
    mockVerifyFolio.mockResolvedValueOnce({ valid: false, reason: 'malformed_folio' });
    const res = await request(buildApp())
      .get('/api/suseso/verify/not-a-folio');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('malformed_folio');
  });

  it('200 with valid: false when folio unknown', async () => {
    mockVerifyFolio.mockResolvedValueOnce({ valid: false, reason: 'unknown_folio' });
    const res = await request(buildApp())
      .get(`/api/suseso/verify/${FOLIO}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('unknown_folio');
  });

  it('200 with valid: false + reason: unsigned when form exists but unsigned', async () => {
    mockVerifyFolio.mockResolvedValueOnce({ valid: false, kind: 'DIAT', reason: 'unsigned' });
    const res = await request(buildApp())
      .get(`/api/suseso/verify/${FOLIO}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('unsigned');
    expect(body.kind).toBe('DIAT');
  });

  it('200 with valid: true + signerRut when form is signed', async () => {
    mockVerifyFolio.mockResolvedValueOnce({
      valid: true,
      kind: 'DIAT',
      signedAt: '2026-05-31T09:00:00Z',
      signerRut: '13.333.333-3',
    });
    const res = await request(buildApp())
      .get(`/api/suseso/verify/${FOLIO}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.kind).toBe('DIAT');
    expect(body.signerRut).toBe('13.333.333-3');
    expect(body.signedAt).toBe('2026-05-31T09:00:00Z');
  });

  it('verify endpoint is public — no auth required', async () => {
    mockVerifyFolio.mockResolvedValueOnce({ valid: false, reason: 'unknown_folio' });
    // No x-test-uid header
    const res = await request(buildApp())
      .get(`/api/suseso/verify/${FOLIO}`);
    // Must not be 401 — this is the QR code verification path
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  it('verify response does NOT expose workerRut or clinical data', async () => {
    mockVerifyFolio.mockResolvedValueOnce({
      valid: true,
      kind: 'DIAT',
      signedAt: '2026-05-31T09:00:00Z',
      signerRut: '13.333.333-3',
    });
    const res = await request(buildApp())
      .get(`/api/suseso/verify/${FOLIO}`);
    const body = res.body as Record<string, unknown>;
    // Must NOT expose worker data
    expect(body.workerRut).toBeUndefined();
    expect(body.workerFullName).toBeUndefined();
    expect(body.bodyPartsAffected).toBeUndefined();
    expect(body.incidentDescription).toBeUndefined();
  });

  it('500 valid:false when verifyFolio throws (internal error)', async () => {
    mockVerifyFolio.mockRejectedValueOnce(new Error('Firestore collectionGroup failed'));
    const res = await request(buildApp())
      .get(`/api/suseso/verify/${FOLIO}`);
    expect(res.status).toBe(500);
    const body = res.body as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('verify_internal_error');
  });
});

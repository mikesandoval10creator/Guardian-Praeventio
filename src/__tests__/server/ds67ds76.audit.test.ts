// P0 security fix tests: ds67ds76 router must await auditServerEvent and
// route failures (helper returns false) to Sentry via captureRouteError
// without breaking the response. Verifies the regression fix for the
// previous fire-and-forget pattern that silently dropped compliance trail
// rows on Firestore outages.
//
// Codex P2 3308579646 fix applied: auditServerEvent returns boolean (never
// throws), so we mock with mockResolvedValue(false) — not mockRejectedValue.
// The helper logs its own failures internally, so the route only adds a
// Sentry breadcrumb via captureRouteError.
//
// We verify:
//   - The endpoint still returns 200 (response not blocked).
//   - captureRouteError was called with a synthetic 'audit_write_failed'
//     error tagged to the audit event.
// Happy path: audit resolves true → no Sentry capture.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ─── Hoisted mocks (vitest hoists vi.mock above imports) ────────────────────

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { uid: string; email: string; tenantId?: string } }).user = {
      uid: 'doctor-uid',
      email: 'doctor@example.com',
      // B5: tenantId now comes from the verified token. Default to the tenant
      // the test bodies use ('t-1'); cross-tenant tests override via header.
      tenantId: req.header('x-test-tenant') ?? 't-1',
    };
    next();
  },
}));

const auditMock = vi.fn();
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: (...args: unknown[]) => auditMock(...args),
}));

const captureRouteErrorMock = vi.fn();
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: (...args: unknown[]) => captureRouteErrorMock(...args),
}));

const loggerErrorMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerDebugMock = vi.fn();
const loggerInfoMock = vi.fn();
vi.mock('../../utils/logger.js', () => ({
  logger: {
    error: (...args: unknown[]) => loggerErrorMock(...args),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    debug: (...args: unknown[]) => loggerDebugMock(...args),
    info: (...args: unknown[]) => loggerInfoMock(...args),
  },
}));

vi.mock('../../services/compliance/ds67/ds67Service.js', () => ({
  createDs67Form: vi.fn(async () => ({
    form: { folio: 'DS67-2026-000001', signature: null },
    pdfBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    payloadHashHex: 'a'.repeat(64),
  })),
  signForm: vi.fn(async () => ({ folio: 'DS67-2026-000001' })),
  ds67FolioToDocId: (f: string) => f,
}));
vi.mock('../../services/compliance/ds76/ds76Service.js', () => ({
  createDs76Form: vi.fn(async () => ({
    form: { folio: 'DS76-2026-000001', signature: null },
    pdfBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    payloadHashHex: 'b'.repeat(64),
  })),
  signForm: vi.fn(async () => ({ folio: 'DS76-2026-000001' })),
  ds76FolioToDocId: (f: string) => f,
}));
vi.mock('../../utils/ds67Certificate.js', () => ({
  generateDs67Pdf: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
}));
vi.mock('../../utils/ds76Certificate.js', () => ({
  generateDs76Pdf: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
}));

vi.mock('firebase-admin', () => ({
  default: {
    firestore: () => ({
      runTransaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ get: async () => ({ exists: false }), set: () => undefined }),
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ set: async () => undefined, get: async () => ({ exists: false }), update: async () => undefined }) }) }) }),
      doc: () => ({ set: () => undefined }),
    }),
  },
}));

// §2.9 — the sign handlers dynamically import these; mock them so the
// verification gate is observable without a real WebAuthn ceremony /
// the heavy curriculum.js module graph.
const verifyAssertionMock = vi.fn();
vi.mock('../../server/auth/webauthnAssertion.js', () => ({
  verifyWebAuthnAssertion: (...args: unknown[]) => verifyAssertionMock(...args),
}));
vi.mock('../../server/routes/curriculum.js', () => ({
  buildWebAuthnDb: () => ({}),
  buildWebAuthnCredentialsDb: () => ({}),
}));

import ds67ds76Router from '../../server/routes/ds67ds76.js';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/compliance', ds67ds76Router);
  return app;
}

const validDs67Body = {
  tenantId: 't-1',
  companyName: 'ACME SpA',
  companyRut: '11.111.111-1',
  companyAddress: 'Av Siempre Viva 1',
  scopeOfApplication: 'All workers',
  workerObligations: ['use PPE'],
  workerProhibitions: ['smoking on site'],
  sanctions: 'per DS 54',
  complaintProcedure: 'via supervisor',
  effectiveFrom: '2026-01-01',
};

const validDs76Body = {
  tenantId: 't-1',
  principalCompanyName: 'Minera Principal',
  principalCompanyRut: '99.999.999-9',
  contractorCompanyName: 'Contratista X',
  contractorCompanyRut: '88.888.888-8',
  worksiteName: 'Mina Norte',
  worksiteAddress: 'Sector 4',
  sstManagementPlan: 'Plan v1',
  managementSystemDescription: 'ISO 45001',
  supervisionScheme: 'Daily walkdown',
  trainingItems: [{ topic: 'PPE', hours: 2 }],
  susesoFiscalizationRecord: 'last visit 2026-03',
};

describe('ds67ds76 router — audit failure surfacing (P0 fix, Codex P2 contract)', () => {
  beforeEach(() => {
    auditMock.mockReset();
    captureRouteErrorMock.mockReset();
    loggerErrorMock.mockReset();
    loggerWarnMock.mockReset();
    loggerDebugMock.mockReset();
    loggerInfoMock.mockReset();
  });

  describe('POST /api/compliance/ds67', () => {
    it('responds 200 even when auditServerEvent returns false', async () => {
      auditMock.mockResolvedValue(false);
      const app = buildApp();
      const res = await request(app).post('/api/compliance/ds67').send(validDs67Body);
      expect(res.status).toBe(200);
      expect(res.body.form.folio).toBe('DS67-2026-000001');
    });

    it('captures audit failure via captureRouteError when helper returns false', async () => {
      auditMock.mockResolvedValue(false);
      const app = buildApp();
      await request(app).post('/api/compliance/ds67').send(validDs67Body);
      expect(captureRouteErrorMock).toHaveBeenCalledTimes(1);
      const [errArg, endpointArg, extrasArg] = captureRouteErrorMock.mock.calls[0];
      expect(errArg).toBeInstanceOf(Error);
      expect((errArg as Error).message).toBe('audit_write_failed');
      expect(endpointArg).toBe('ds67.audit');
      expect(extrasArg).toMatchObject({
        audit_event: 'compliance.ds67_created',
        folio: 'DS67-2026-000001',
      });
    });

    it('does not capture when auditServerEvent returns true (happy path)', async () => {
      auditMock.mockResolvedValue(true);
      const app = buildApp();
      const res = await request(app).post('/api/compliance/ds67').send(validDs67Body);
      expect(res.status).toBe(200);
      expect(captureRouteErrorMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/compliance/ds76', () => {
    it('responds 200 even when auditServerEvent returns false', async () => {
      auditMock.mockResolvedValue(false);
      const app = buildApp();
      const res = await request(app).post('/api/compliance/ds76').send(validDs76Body);
      expect(res.status).toBe(200);
      expect(res.body.form.folio).toBe('DS76-2026-000001');
    });

    it('captures audit failure via captureRouteError when helper returns false', async () => {
      auditMock.mockResolvedValue(false);
      const app = buildApp();
      await request(app).post('/api/compliance/ds76').send(validDs76Body);
      expect(captureRouteErrorMock).toHaveBeenCalledTimes(1);
      const [errArg, endpointArg, extrasArg] = captureRouteErrorMock.mock.calls[0];
      expect(errArg).toBeInstanceOf(Error);
      expect((errArg as Error).message).toBe('audit_write_failed');
      expect(endpointArg).toBe('ds76.audit');
      expect(extrasArg).toMatchObject({
        audit_event: 'compliance.ds76_created',
        folio: 'DS76-2026-000001',
      });
    });
  });
});

// §2.9 — server-side WebAuthn verification gate. Previously the sign endpoints
// persisted any client-supplied signatureB64 with NO cryptographic check.
describe('ds67ds76 router — WebAuthn sign verification gate (§2.9)', () => {
  const baseSig = {
    signerUid: 'doctor-uid', // matches the mocked verifyAuth caller
    signerRut: '11.111.111-1',
    signedAt: '2026-06-01T00:00:00.000Z',
    algorithm: 'webauthn-ecdsa-p256' as const,
    signatureB64: 'AAAA',
    payloadHashHex: 'a'.repeat(64),
  };
  const assertion = {
    challengeId: 'ch-1',
    credentialId: 'cred-1',
    rawId: 'raw-1',
    clientDataJSON: 'cdj',
    authenticatorData: 'ad',
    signature: 'AAAA',
    type: 'public-key' as const,
    clientExtensionResults: {},
  };

  beforeEach(() => {
    verifyAssertionMock.mockReset();
    auditMock.mockResolvedValue(true);
    captureRouteErrorMock.mockReset();
  });

  for (const ds of ['ds67', 'ds76'] as const) {
    describe(`POST /api/compliance/${ds}/:formId/sign`, () => {
      const url = `/api/compliance/${ds}/F-1/sign`;

      it('400 when algorithm=webauthn but webauthnAssertion is absent', async () => {
        const res = await request(buildApp())
          .post(url)
          .send({ tenantId: 't-1', signature: baseSig });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(`${ds}_sign_webauthn_assertion_required`);
        expect(verifyAssertionMock).not.toHaveBeenCalled();
      });

      it('403 when signerUid does not match the authenticated caller', async () => {
        const res = await request(buildApp())
          .post(url)
          .send({
            tenantId: 't-1',
            signature: { ...baseSig, signerUid: 'someone-else' },
            webauthnAssertion: assertion,
          });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe(`${ds}_sign_uid_mismatch`);
        expect(verifyAssertionMock).not.toHaveBeenCalled();
      });

      it('401 when the assertion fails cryptographic verification', async () => {
        verifyAssertionMock.mockResolvedValue({
          verified: false,
          reason: 'signature_invalid',
        });
        const res = await request(buildApp())
          .post(url)
          .send({ tenantId: 't-1', signature: baseSig, webauthnAssertion: assertion });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe(`${ds}_sign_webauthn_failed`);
        expect(res.body.reason).toBe('signature_invalid');
        expect(verifyAssertionMock).toHaveBeenCalledTimes(1);
      });

      it('200 when the assertion verifies — persists + audits the sign', async () => {
        verifyAssertionMock.mockResolvedValue({
          verified: true,
          newCounter: 1,
          verifiedCredentialId: 'cred-1',
        });
        const res = await request(buildApp())
          .post(url)
          .send({ tenantId: 't-1', signature: baseSig, webauthnAssertion: assertion });
        expect(res.status).toBe(200);
        expect(verifyAssertionMock).toHaveBeenCalledTimes(1);
        expect(auditMock).toHaveBeenCalledWith(
          expect.anything(),
          `compliance.${ds}_signed`,
          'compliance',
          expect.objectContaining({ webauthnVerified: true }),
        );
      });

      it('200 with kms-sign-rsa requires no assertion (backward compat)', async () => {
        const res = await request(buildApp())
          .post(url)
          .send({ tenantId: 't-1', signature: { ...baseSig, algorithm: 'kms-sign-rsa' } });
        expect(res.status).toBe(200);
        expect(verifyAssertionMock).not.toHaveBeenCalled();
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// B5 — tenantId is authoritative from the token, not the body/query.
// ═══════════════════════════════════════════════════════════════════════════
describe('ds67ds76 router — B5 tenant-from-token (cross-tenant defense)', () => {
  it('403 tenant_mismatch on POST /ds67 when the body forges another tenant', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/ds67')
      .set('x-test-tenant', 't-1')
      .send({ ...validDs67Body, tenantId: 't-2' });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_mismatch');
  });

  it('403 tenant_mismatch on GET /ds67/:formId/pdf when the query forges another tenant', async () => {
    const res = await request(buildApp())
      .get('/api/compliance/ds67/form-1/pdf?tenantId=t-2')
      .set('x-test-tenant', 't-1');
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_mismatch');
  });

  it('403 tenant_mismatch on POST /ds76 when the body forges another tenant', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/ds76')
      .set('x-test-tenant', 't-1')
      .send({ ...validDs76Body, tenantId: 't-2' });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_mismatch');
  });

  it('403 no_tenant_binding when the token carries no tenant', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/ds67')
      .set('x-test-tenant', '')
      .send(validDs67Body);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('no_tenant_binding');
  });
});

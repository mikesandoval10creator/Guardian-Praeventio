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
    (req as Request & { user: { uid: string; email: string } }).user = {
      uid: 'doctor-uid',
      email: 'doctor@example.com',
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

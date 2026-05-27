// P0 security fix tests: ds67ds76 router must await auditServerEvent and
// route failures to logger + Sentry (captureRouteError) without breaking
// the response. Verifies the regression fix for the previous fire-and-
// forget pattern that silently dropped compliance trail rows on Firestore
// outages.
//
// We mock auditServerEvent to REJECT, then verify:
//   - The endpoint still returns 200 (response not blocked).
//   - logger.error was called with 'audit_event_failed'.
//   - captureRouteError was called (Sentry surface).
//
// Sister test verifies the happy path: audit resolves → no error log
// → no Sentry capture.

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

// Stub the ds67/ds76 services so the route reaches the audit path.
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

// Stub firebase-admin so the router doesn't need a live SDK.
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

describe('ds67ds76 router — audit failure surfacing (P0 fix)', () => {
  beforeEach(() => {
    auditMock.mockReset();
    captureRouteErrorMock.mockReset();
    loggerErrorMock.mockReset();
    loggerWarnMock.mockReset();
    loggerDebugMock.mockReset();
    loggerInfoMock.mockReset();
  });

  describe('POST /api/compliance/ds67', () => {
    it('responds 200 even when auditServerEvent rejects', async () => {
      auditMock.mockRejectedValue(new Error('firestore_unavailable'));
      const app = buildApp();
      const res = await request(app).post('/api/compliance/ds67').send(validDs67Body);
      expect(res.status).toBe(200);
      expect(res.body.form.folio).toBe('DS67-2026-000001');
    });

    it('logs audit_event_failed when auditServerEvent rejects', async () => {
      auditMock.mockRejectedValue(new Error('firestore_unavailable'));
      const app = buildApp();
      await request(app).post('/api/compliance/ds67').send(validDs67Body);
      const matched = loggerErrorMock.mock.calls.find(
        ([msg]) => msg === 'audit_event_failed',
      );
      expect(matched, 'expected logger.error("audit_event_failed", ...)').toBeDefined();
      expect(matched?.[1]).toMatchObject({
        event: 'compliance.ds67_created',
        folio: 'DS67-2026-000001',
      });
    });

    it('captures the audit failure via captureRouteError (Sentry surface)', async () => {
      const auditError = new Error('firestore_unavailable');
      auditMock.mockRejectedValue(auditError);
      const app = buildApp();
      await request(app).post('/api/compliance/ds67').send(validDs67Body);
      expect(captureRouteErrorMock).toHaveBeenCalled();
      const [errArg, endpointArg, extrasArg] = captureRouteErrorMock.mock.calls[0];
      expect(errArg).toBe(auditError);
      expect(endpointArg).toBe('ds67.audit');
      expect(extrasArg).toMatchObject({ audit_event: 'compliance.ds67_created' });
    });

    it('emits no error log when auditServerEvent resolves (happy path)', async () => {
      auditMock.mockResolvedValue(true);
      const app = buildApp();
      const res = await request(app).post('/api/compliance/ds67').send(validDs67Body);
      expect(res.status).toBe(200);
      const audit_failed = loggerErrorMock.mock.calls.find(
        ([msg]) => msg === 'audit_event_failed',
      );
      expect(audit_failed).toBeUndefined();
      expect(captureRouteErrorMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/compliance/ds76', () => {
    it('responds 200 even when auditServerEvent rejects', async () => {
      auditMock.mockRejectedValue(new Error('firestore_unavailable'));
      const app = buildApp();
      const res = await request(app).post('/api/compliance/ds76').send(validDs76Body);
      expect(res.status).toBe(200);
      expect(res.body.form.folio).toBe('DS76-2026-000001');
    });

    it('logs + captures the audit failure', async () => {
      const auditError = new Error('firestore_unavailable');
      auditMock.mockRejectedValue(auditError);
      const app = buildApp();
      await request(app).post('/api/compliance/ds76').send(validDs76Body);
      const matched = loggerErrorMock.mock.calls.find(
        ([msg]) => msg === 'audit_event_failed',
      );
      expect(matched?.[1]).toMatchObject({
        event: 'compliance.ds76_created',
        folio: 'DS76-2026-000001',
      });
      expect(captureRouteErrorMock).toHaveBeenCalled();
      const [, endpointArg, extrasArg] = captureRouteErrorMock.mock.calls[0];
      expect(endpointArg).toBe('ds76.audit');
      expect(extrasArg).toMatchObject({ audit_event: 'compliance.ds76_created' });
    });
  });
});

// Praeventio Guard — src/server/routes/import.ts coverage.
//
// Covers the two endpoints in the Excel importer router. The route file
// itself depends on `verifyAuth`, `idempotencyKey`, audit logging, the
// `excelImporter` service barrel, and `admin.firestore()`. All of those
// are mocked here so the tests are deterministic and never touch real
// Firestore. The mocking pattern mirrors oauthGoogle.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ─── Module mocks (must be hoisted via vi.mock before route import) ────

const verifyAuthMock = vi.fn();
const idempotencyKeyMiddleware = vi.fn(
  (_req: Request, _res: Response, _next: NextFunction): void => {},
);
const idempotencyKeyFactory = vi.fn(
  (_opts?: unknown) => idempotencyKeyMiddleware,
);
const auditServerEventMock = vi.fn(async () => true);
const captureRouteErrorMock = vi.fn();

const parseXlsxMock = vi.fn();
const validateRowsMock = vi.fn();
const dedupeMock = vi.fn();

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) =>
    verifyAuthMock(req, res, next),
}));

vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: (opts?: unknown) => idempotencyKeyFactory(opts),
}));

vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: auditServerEventMock,
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: captureRouteErrorMock,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// The excelImporter barrel re-exports parseXlsx / validateRows / dedupe /
// XlsxReaderError / UNIQUE_KEY_BY_KIND. We mock the whole barrel so the
// route's imports resolve against a deterministic surface.
class FakeXlsxReaderError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'XlsxReaderError';
    this.code = code;
  }
}

vi.mock('../../services/excelImporter/index.js', () => ({
  parseXlsx: (...args: unknown[]) => parseXlsxMock(...args),
  validateRows: (...args: unknown[]) => validateRowsMock(...args),
  dedupe: (...args: unknown[]) => dedupeMock(...args),
  XlsxReaderError: FakeXlsxReaderError,
  UNIQUE_KEY_BY_KIND: {
    workers: 'rut',
    epp: 'serial',
    trainings: null,
    incidents: 'id',
    projects: 'name',
    risks: 'id',
  },
}));

// firebase-admin is referenced by the route for admin.firestore() and
// admin.firestore.FieldValue.serverTimestamp(). The default export is the
// `admin` namespace object. We stub the surface the route actually uses.
const batchSetMock = vi.fn((_ref: unknown, _data: unknown): void => {});
const batchCommitMock = vi.fn(async (): Promise<void> => undefined);
const collectionDocMock = vi.fn((_id?: string) => ({ id: 'doc-fake' }));

vi.mock('firebase-admin', () => {
  // The route walks: db.collection().doc().collection().doc().collection()
  // and also db.collection().doc().collection() for the no-projectId branch.
  // A single recursive proxy avoids hand-rolling each level (and the
  // duplicate-key warning that came with it).
  function makeColl(): any {
    return {
      doc: (_id?: string) => makeDoc(),
      limit: (_n: number) => ({ get: async () => ({ forEach: () => {} }) }),
      get: async () => ({ forEach: () => {} }),
    };
  }
  function makeDoc(): any {
    return {
      id: 'doc-fake',
      collection: (_n: string) => makeColl(),
      get: async () => ({ exists: false, data: () => undefined }),
    };
  }
  const firestoreFn: any = () => ({
    collection: (_n: string) => {
      // Capture the final `.doc()` call from `colRef.doc()` (commit-path)
      // so we can assert on the doc factory if needed.
      const c = makeColl();
      const origDoc = c.doc;
      c.doc = (id?: string) => {
        collectionDocMock(id);
        return origDoc(id);
      };
      return c;
    },
    batch: () => ({
      set: batchSetMock,
      commit: batchCommitMock,
    }),
  });
  firestoreFn.FieldValue = {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  };
  return {
    default: {
      firestore: firestoreFn,
    },
  };
});

// Build an Express app that mounts the import router under /api.
async function buildApp(): Promise<Express> {
  const mod = await import('../../server/routes/import.js');
  const importRouter = (mod as { default: express.Router }).default;
  const app = express();
  app.use('/api', importRouter);
  return app;
}

beforeEach(() => {
  vi.resetModules();
  verifyAuthMock.mockReset();
  idempotencyKeyMiddleware.mockReset();
  idempotencyKeyFactory.mockClear();
  auditServerEventMock.mockClear();
  captureRouteErrorMock.mockClear();
  parseXlsxMock.mockReset();
  validateRowsMock.mockReset();
  dedupeMock.mockReset();
  batchSetMock.mockReset();
  batchCommitMock.mockReset();
  batchCommitMock.mockResolvedValue(undefined);
  collectionDocMock.mockClear();

  // Default: idempotency middleware is a pass-through (no key sent → next()).
  idempotencyKeyMiddleware.mockImplementation(
    (_req: Request, _res: Response, next: NextFunction) => next(),
  );
});

// ── Helpers to stamp req.user from a stub verifyAuth ───────────────────
function authOK(uid = 'uid-test') {
  verifyAuthMock.mockImplementation(
    (req: Request, _res: Response, next: NextFunction) => {
      req.user = { uid, email: `${uid}@test.com` };
      next();
    },
  );
}

function authReject(status = 401, body: object = { error: 'Unauthorized' }) {
  verifyAuthMock.mockImplementation(
    (_req: Request, res: Response, _next: NextFunction) => {
      res.status(status).json(body);
    },
  );
}

describe('POST /api/import/excel — validate-only', () => {
  it('returns 401 when verifyAuth rejects', async () => {
    authReject(401, { error: 'Unauthorized: No token provided' });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/import/excel')
      .send({ kind: 'workers', base64: 'AAAA' });
    expect(res.status).toBe(401);
    expect(parseXlsxMock).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid payload (missing base64)', async () => {
    authOK();
    const app = await buildApp();
    const res = await request(app)
      .post('/api/import/excel')
      .send({ kind: 'workers' }); // base64 missing
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(parseXlsxMock).not.toHaveBeenCalled();
  });

  it('returns 400 when XlsxReaderError is thrown by parseXlsx', async () => {
    authOK();
    parseXlsxMock.mockRejectedValueOnce(
      new FakeXlsxReaderError('Archivo corrupto', 'invalid_file'),
    );
    const app = await buildApp();
    const res = await request(app)
      .post('/api/import/excel')
      .send({ kind: 'workers', base64: 'AAAA' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_file');
    expect(res.body.message).toMatch(/corrupto/);
    expect(captureRouteErrorMock).not.toHaveBeenCalled();
  });

  it('happy path: returns 200 with summary { valid, invalid, duplicates, errors, sample, validRecords }', async () => {
    authOK('uid-happy');
    parseXlsxMock.mockResolvedValueOnce({
      sheets: [
        {
          name: 'Workers',
          rows: [
            { rowNumber: 2, data: { rut: '11.111.111-1', fullName: 'Ana' } },
            { rowNumber: 3, data: { rut: '22.222.222-2', fullName: 'Beto' } },
          ],
          columns: ['rut', 'fullName'],
        },
      ],
      primarySheet: {
        name: 'Workers',
        rows: [
          { rowNumber: 2, data: { rut: '11.111.111-1', fullName: 'Ana' } },
          { rowNumber: 3, data: { rut: '22.222.222-2', fullName: 'Beto' } },
        ],
        columns: ['rut', 'fullName'],
      },
    });
    validateRowsMock.mockReturnValueOnce({
      valid: [
        { rowNumber: 2, record: { rut: '11.111.111-1', fullName: 'Ana' } },
        { rowNumber: 3, record: { rut: '22.222.222-2', fullName: 'Beto' } },
      ],
      invalid: [],
      totalIssues: 0,
    });
    dedupeMock.mockReturnValueOnce({
      unique: [
        { rowNumber: 2, record: { rut: '11.111.111-1', fullName: 'Ana' } },
        { rowNumber: 3, record: { rut: '22.222.222-2', fullName: 'Beto' } },
      ],
      duplicates: [],
    });

    const app = await buildApp();
    const res = await request(app)
      .post('/api/import/excel')
      .send({ kind: 'workers', base64: 'AAAA' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'workers',
      totalRows: 2,
      valid: 2,
      invalid: 0,
      duplicates: 0,
      sheetName: 'Workers',
    });
    expect(res.body).toHaveProperty('errors');
    expect(res.body).toHaveProperty('sample');
    expect(res.body).toHaveProperty('validRecords');
    expect(res.body.validRecords).toHaveLength(2);
    expect(res.body.sample).toHaveLength(2);
    expect(auditServerEventMock).toHaveBeenCalledWith(
      expect.anything(),
      'import.excel.validated',
      'import',
      expect.objectContaining({ kind: 'workers', totalRows: 2, valid: 2 }),
    );
  });

  it('returns 200 with totalRows=0 when sheet is empty', async () => {
    authOK();
    parseXlsxMock.mockResolvedValueOnce({
      sheets: [{ name: 'Sheet1', rows: [], columns: [] }],
      primarySheet: { name: 'Sheet1', rows: [], columns: [] },
    });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/import/excel')
      .send({ kind: 'workers', base64: 'AAAA' });
    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(0);
    expect(res.body.valid).toBe(0);
    expect(res.body.invalid).toBe(0);
    expect(res.body.duplicates).toBe(0);
    expect(res.body.errors).toEqual([]);
    expect(res.body.sample).toEqual([]);
    expect(res.body.validRecords).toEqual([]);
    // validateRows is short-circuited when there are no rows.
    expect(validateRowsMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/import/commit — persist a validated batch', () => {
  it('returns 401 when verifyAuth rejects', async () => {
    authReject();
    const app = await buildApp();
    const res = await request(app)
      .post('/api/import/commit')
      .send({ kind: 'workers', records: [{ rut: '1' }], projectId: 'p1' });
    expect(res.status).toBe(401);
    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid payload (records empty)', async () => {
    authOK();
    const app = await buildApp();
    const res = await request(app)
      .post('/api/import/commit')
      .send({ kind: 'workers', records: [], projectId: 'p1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid payload (kind not in enum)', async () => {
    authOK();
    const app = await buildApp();
    const res = await request(app)
      .post('/api/import/commit')
      .send({ kind: 'invalid-kind', records: [{ x: 1 }], projectId: 'p1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('happy path: returns 200 after committing records', async () => {
    authOK('uid-commit');
    const app = await buildApp();
    const records = [
      { rut: '11.111.111-1', fullName: 'Ana' },
      { rut: '22.222.222-2', fullName: 'Beto' },
    ];
    const res = await request(app)
      .post('/api/import/commit')
      .send({ kind: 'workers', records, projectId: 'proj-X' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      kind: 'workers',
      projectId: 'proj-X',
      writtenCount: 2,
      failedRowNumbers: [],
    });
    expect(batchSetMock).toHaveBeenCalledTimes(2);
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
    expect(auditServerEventMock).toHaveBeenCalledWith(
      expect.anything(),
      'import.excel.committed',
      'import',
      expect.objectContaining({
        kind: 'workers',
        projectId: 'proj-X',
        writtenCount: 2,
        failedCount: 0,
      }),
    );
  });

  it('idempotency: middleware shortcut returns the cached response without invoking the handler', async () => {
    authOK('uid-idem');
    // Simulate cache HIT: the idempotency middleware ends the response
    // itself with the previously-captured body.
    idempotencyKeyMiddleware.mockImplementation(
      (_req: Request, res: Response, _next: NextFunction) => {
        res
          .status(200)
          .setHeader('Idempotent-Replayed', 'true')
          .json({
            success: true,
            kind: 'workers',
            projectId: 'proj-X',
            writtenCount: 2,
            failedRowNumbers: [],
            __replayed: true,
          });
      },
    );

    const app = await buildApp();
    const res = await request(app)
      .post('/api/import/commit')
      .set('Idempotency-Key', 'idem-key-1')
      .send({
        kind: 'workers',
        records: [{ rut: '1' }, { rut: '2' }],
        projectId: 'proj-X',
      });

    expect(res.status).toBe(200);
    expect(res.body.__replayed).toBe(true);
    expect(res.headers['idempotent-replayed']).toBe('true');
    // Handler must NOT have executed.
    expect(batchCommitMock).not.toHaveBeenCalled();
    expect(auditServerEventMock).not.toHaveBeenCalled();
  });
});

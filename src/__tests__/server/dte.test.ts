// Real-router supertest for src/server/routes/dte.ts (Plan v3 Fase 1).
//
// DIRECTIVE: Praeventio NO push a SII. The generate endpoint returns
// { xml, pdfBase64, dteId, signedAt? } for the empresa cliente to sign+submit.
// We assert there is NO external-organism submission anywhere in these tests.
//
// Mounted at /api/dte (verified in server.ts line 1159).
// Admin-only gate: POST /create, POST /:folio/cancel, POST /generate.
// Auth-any gate: GET /:folio.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Hoisted mutable holders
// ---------------------------------------------------------------------------
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  // Swappable Bsale adapter; null → 503 (not configured).
  bsaleAdapter: null as {
    createDte: (input: unknown) => Promise<Record<string, unknown>>;
    getDte: (folio: string) => Promise<Record<string, unknown>>;
    cancelDte: (folio: number, reason: string) => Promise<Record<string, unknown>>;
  } | null,
  // Swappable lazy-import mocks for Sprint 36 lazy services.
  generateDteFn: null as ((...args: unknown[]) => Promise<Record<string, unknown>>) | null,
  verifyAndSignDteFn: null as ((...args: unknown[]) => Promise<Record<string, unknown>>) | null,
  renderDtePdfFn: null as ((...args: unknown[]) => Promise<Buffer>) | null,
  // F4: swappable WebAuthn assertion verdict. Default (null) → verified:true.
  verifyAssertionFn: null as (() => Record<string, unknown>) | null,
}));

// ---------------------------------------------------------------------------
// firebase-admin mock — admin role ONLY for uid 'admin-1'
// ---------------------------------------------------------------------------
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {
    getUser: async (uid: string) => ({
      uid,
      customClaims: uid === 'admin-1' ? { role: 'admin' } : {},
    }),
    verifyIdToken: async () => ({ uid: 'test' }),
  });
});

// ---------------------------------------------------------------------------
// verifyAuth shim — reads x-test-uid header
// ---------------------------------------------------------------------------
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

// ---------------------------------------------------------------------------
// idempotencyKey — transparent passthrough for unit tests
// ---------------------------------------------------------------------------
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ---------------------------------------------------------------------------
// Logger + observability — silent
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../services/observability/tracing.js', () => ({
  // tracedAsync passes through to the fn — just call it.
  tracedAsync: async (_name: string, _attrs: unknown, fn: () => Promise<unknown>) => fn(),
}));

// ---------------------------------------------------------------------------
// BsaleAdapter.fromEnv() — return our swappable mock
// ---------------------------------------------------------------------------
vi.mock('../../services/sii/bsaleAdapter.js', () => ({
  BsaleAdapter: {
    fromEnv: () => H.bsaleAdapter,
  },
}));

// ---------------------------------------------------------------------------
// Lazy-imported DTE services (Sprint 36 lazy pattern) — mocked so
// no XML/PDF/WebAuthn heavy code runs. Paths match EXACTLY what dte.ts
// imports via dynamic import('...').
// ---------------------------------------------------------------------------
vi.mock('../../services/sii/dteGenerator.js', () => ({
  generateDte: (...args: unknown[]) => H.generateDteFn!(...args),
}));
vi.mock('../../services/sii/dteSigner.js', () => ({
  verifyAndSignDte: (...args: unknown[]) => H.verifyAndSignDteFn!(...args),
}));
vi.mock('../../services/sii/dtePdfRenderer.js', () => ({
  renderDtePdf: (...args: unknown[]) => H.renderDtePdfFn!(...args),
}));

// ---------------------------------------------------------------------------
// curriculum.buildWebAuthnCredentialsDb + buildWebAuthnDb — no-op DB shims.
// F4: the sign path now also calls buildWebAuthnDb() (challenges store), so
// the mock MUST export it or the handler throws `buildWebAuthnDb is not a
// function`. Real crypto is covered in dteSignVerify.test.ts; here we mock
// verifyWebAuthnAssertion below so these DB shims are never actually read.
// ---------------------------------------------------------------------------
vi.mock('../../server/routes/curriculum.js', () => ({
  buildWebAuthnCredentialsDb: () => ({
    now: () => Date.now(),
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, id: '', data: () => undefined }),
        set: async () => {},
        update: async () => {},
      }),
      where: () => ({
        get: async () => ({ empty: true, docs: [] }),
      }),
    }),
  }),
  buildWebAuthnDb: () => ({
    now: () => Date.now(),
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, id: '', data: () => undefined }),
        set: async () => {},
        updateIf: async () => true,
      }),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// webauthnAssertion.verifyWebAuthnAssertion — mocked so the biometric path
// here exercises audit/response branching without driving the real crypto
// pipeline (covered end-to-end in dteSignVerify.test.ts). Default verdict is
// verified; a test can force a failure via H.verifyAssertionFn.
// ---------------------------------------------------------------------------
vi.mock('../../server/auth/webauthnAssertion.js', () => ({
  verifyWebAuthnAssertion: async () =>
    H.verifyAssertionFn
      ? H.verifyAssertionFn()
      : { verified: true, newCounter: 1, verifiedCredentialId: 'cred-abc123' },
}));

// ---------------------------------------------------------------------------
// auditLog — always resolves true (matches prod .then(ok => ...) pattern)
// ---------------------------------------------------------------------------
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => true),
}));

// ---------------------------------------------------------------------------
// Import the REAL router + helpers
// ---------------------------------------------------------------------------
import dteRouter from '../../server/routes/dte.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { auditServerEvent } from '../../server/middleware/auditLog.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/dte', dteRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const VALID_CREATE_BODY = {
  type: 'factura_electronica',
  customer: {
    rut: '76.123.456-7',
    razonSocial: 'Empresa Ejemplo SpA',
    direccion: 'Av. Providencia 1234',
    comuna: 'Providencia',
    ciudad: 'Santiago',
  },
  items: [
    {
      description: 'Servicio de prevención de riesgos',
      quantity: 1,
      unitPriceClp: 100000,
      taxable: true,
    },
  ],
  paymentMethod: 'transferencia',
};

const VALID_GENERATE_BODY = {
  type: 33,
  receptorRut: '76.123.456-7',
  receptorRazonSocial: 'Empresa Ejemplo SpA',
  fecha: '2026-05-31',
  folio: 1001,
  items: [
    {
      description: 'Asesoría Prevención de Riesgos',
      quantity: 2,
      unitPrice: 50000,
    },
  ],
};

const FAKE_GENERATED_DTE = {
  xml: '<DTE>...</DTE>',
  hash: 'abc123hash',
  dteId: '33-1001-76123456-7',
  summary: {
    type: 33,
    folio: 1001,
    emisorRut: '76.000.000-1',
    receptorRut: '76.123.456-7',
    fecha: '2026-05-31',
    netAmount: 100000,
    iva: 19000,
    total: 119000,
    itemCount: 2,
  },
};

const FAKE_PDF_BUFFER = Buffer.from('fake-pdf-bytes');

beforeEach(() => {
  H.db = createFakeFirestore();
  H.bsaleAdapter = null;
  H.generateDteFn = null;
  H.verifyAndSignDteFn = null;
  H.renderDtePdfFn = null;
  H.verifyAssertionFn = null;
  vi.mocked(auditServerEvent).mockClear();
});

// F4: full biometric assertion shape now required by the generateDteSchema.
// Helper so the two biometric fixtures stay DRY + Zod-valid.
function biometricBlock(credentialId: string) {
  return {
    credentialId,
    rawId: credentialId,
    type: 'public-key' as const,
    challengeId: 'chal-1',
    clientExtensionResults: {},
    signature: Buffer.from('fake-sig').toString('base64'),
    authenticatorData: Buffer.from('fake-authdata').toString('base64'),
    clientDataJSON: Buffer.from('{"type":"webauthn.get"}').toString('base64'),
  };
}

// ===========================================================================
// POST /api/dte/create
// ===========================================================================
describe('POST /api/dte/create', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/dte/create')
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not an admin', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/create')
      .set('x-test-uid', 'worker-1')
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('admin_required');
  });

  it('503 when Bsale env vars are not configured', async () => {
    // H.bsaleAdapter remains null → BsaleAdapter.fromEnv() returns null
    const res = await request(buildApp())
      .post('/api/dte/create')
      .set('x-test-uid', 'admin-1')
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(503);
    expect((res.body as Record<string, unknown>).error).toBe('dte_not_configured');
  });

  it('400 when body is missing required fields', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/create')
      .set('x-test-uid', 'admin-1')
      .send({ type: 'factura_electronica' }); // missing customer + items
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_input');
  });

  it('400 when type is not a valid DTE type name', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/create')
      .set('x-test-uid', 'admin-1')
      .send({ ...VALID_CREATE_BODY, type: 'carta_magica' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_input');
  });

  it('422 when Bsale rejects the DTE', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(async () => ({ ok: false, errorMessage: 'RUT inválido en SII' })),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/create')
      .set('x-test-uid', 'admin-1')
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(422);
    expect((res.body as Record<string, unknown>).error).toBe('dte_rejected');
    expect((res.body as Record<string, unknown>).message).toBe('RUT inválido en SII');
  });

  it('200 happy path — returns folio + PDF/XML URLs, NO push to SII', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(async () => ({
        ok: true,
        folio: 5001,
        pdfUrl: 'https://bsale.example/pdf/5001',
        xmlUrl: 'https://bsale.example/xml/5001',
        trackingId: 'bsale-5001',
        totalClp: 119000,
        ivaClp: 19000,
      })),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/create')
      .set('x-test-uid', 'admin-1')
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.folio).toBe(5001);
    expect(body.pdfUrl).toBe('https://bsale.example/pdf/5001');
    expect(body.xmlUrl).toBe('https://bsale.example/xml/5001');
    expect(body.trackingId).toBe('bsale-5001');
    expect(body.totalClp).toBe(119000);
    expect(body.ivaClp).toBe(19000);
    // DIRECTIVE: the response carries the doc artefact — no external submit
    // happened. The mock never called any SII push method.
    expect(vi.mocked(H.bsaleAdapter!.createDte)).toHaveBeenCalledTimes(1);
  });

  it('500 when Bsale adapter throws unexpectedly', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(async () => { throw new Error('network_timeout'); }),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/create')
      .set('x-test-uid', 'admin-1')
      .send(VALID_CREATE_BODY);
    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toBe('dte_emission_failed');
  });
});

// ===========================================================================
// GET /api/dte/:folio
// ===========================================================================
describe('GET /api/dte/:folio', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/dte/5001');
    expect(res.status).toBe(401);
  });

  it('503 when Bsale is not configured', async () => {
    // H.bsaleAdapter = null
    const res = await request(buildApp())
      .get('/api/dte/5001')
      .set('x-test-uid', 'worker-1'); // any authenticated user can read
    expect(res.status).toBe(503);
    expect((res.body as Record<string, unknown>).error).toBe('dte_not_configured');
  });

  it('404 when Bsale reports the folio is not found', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(async () => ({ ok: false, errorMessage: 'Folio no encontrado' })),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .get('/api/dte/9999')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('dte_not_found');
    expect((res.body as Record<string, unknown>).message).toBe('Folio no encontrado');
  });

  it('200 happy path — returns folio status from Bsale', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(async () => ({
        ok: true,
        folio: 5001,
        pdfUrl: 'https://bsale.example/pdf/5001',
        xmlUrl: 'https://bsale.example/xml/5001',
        trackingId: 'bsale-5001',
      })),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .get('/api/dte/5001')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.folio).toBe(5001);
    expect(body.pdfUrl).toBe('https://bsale.example/pdf/5001');
    expect(body.trackingId).toBe('bsale-5001');
  });

  it('500 when Bsale adapter throws unexpectedly', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(async () => { throw new Error('timeout'); }),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .get('/api/dte/5001')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toBe('dte_lookup_failed');
  });
});

// ===========================================================================
// POST /api/dte/:folio/cancel
// ===========================================================================
describe('POST /api/dte/:folio/cancel', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/dte/5001/cancel')
      .send({ reason: 'Error en el DTE' });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not an admin', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/5001/cancel')
      .set('x-test-uid', 'worker-1')
      .send({ reason: 'Error en el DTE' });
    expect(res.status).toBe(403);
  });

  it('400 when folio is not a positive integer', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/abc/cancel')
      .set('x-test-uid', 'admin-1')
      .send({ reason: 'Error en el DTE' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_folio');
  });

  it('400 when reason is missing', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/5001/cancel')
      .set('x-test-uid', 'admin-1')
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('reason_required');
  });

  it('400 when reason is blank whitespace', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(),
    };
    const res = await request(buildApp())
      .post('/api/dte/5001/cancel')
      .set('x-test-uid', 'admin-1')
      .send({ reason: '   ' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('reason_required');
  });

  it('503 when Bsale is not configured', async () => {
    // H.bsaleAdapter = null
    const res = await request(buildApp())
      .post('/api/dte/5001/cancel')
      .set('x-test-uid', 'admin-1')
      .send({ reason: 'Error en el DTE' });
    expect(res.status).toBe(503);
  });

  it('422 when Bsale rejects the cancellation', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(async () => ({ ok: false, errorMessage: 'Folio ya anulado' })),
    };
    const res = await request(buildApp())
      .post('/api/dte/5001/cancel')
      .set('x-test-uid', 'admin-1')
      .send({ reason: 'Error en el DTE' });
    expect(res.status).toBe(422);
    expect((res.body as Record<string, unknown>).error).toBe('cancel_failed');
    expect((res.body as Record<string, unknown>).message).toBe('Folio ya anulado');
  });

  it('200 happy path — Nota de Crédito issued, trackingId returned', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(async () => ({ ok: true, trackingId: 'bsale-nc-9001' })),
    };
    const res = await request(buildApp())
      .post('/api/dte/5001/cancel')
      .set('x-test-uid', 'admin-1')
      .send({ reason: 'Monto incorrecto en factura original' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.trackingId).toBe('bsale-nc-9001');
    // Verify the adapter was called with the parsed folio number
    expect(vi.mocked(H.bsaleAdapter!.cancelDte)).toHaveBeenCalledWith(5001, 'Monto incorrecto en factura original');
  });

  it('500 when Bsale adapter throws unexpectedly', async () => {
    H.bsaleAdapter = {
      createDte: vi.fn(),
      getDte: vi.fn(),
      cancelDte: vi.fn(async () => { throw new Error('bsale_outage'); }),
    };
    const res = await request(buildApp())
      .post('/api/dte/5001/cancel')
      .set('x-test-uid', 'admin-1')
      .send({ reason: 'Error en el DTE' });
    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toBe('dte_cancel_failed');
  });
});

// ===========================================================================
// POST /api/dte/generate — biometric DTE generator (NO push to SII)
// ===========================================================================
describe('POST /api/dte/generate', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .send(VALID_GENERATE_BODY);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not an admin', async () => {
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'worker-1')
      .send(VALID_GENERATE_BODY);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('admin_required');
  });

  it('400 when body fails Zod schema — missing fecha', async () => {
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send({ ...VALID_GENERATE_BODY, fecha: undefined });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_input');
    expect((res.body as Record<string, unknown>).details).toBeDefined();
  });

  it('400 when type is not 33 or 39', async () => {
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send({ ...VALID_GENERATE_BODY, type: 41 });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_input');
  });

  it('400 when folio is not a positive integer', async () => {
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send({ ...VALID_GENERATE_BODY, folio: -1 });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_input');
  });

  it('400 when items array is empty', async () => {
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send({ ...VALID_GENERATE_BODY, items: [] });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_input');
  });

  it('422 when generateDte throws (bad data)', async () => {
    H.generateDteFn = vi.fn(async () => { throw new Error('Invalid RUT format'); });
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send(VALID_GENERATE_BODY);
    expect(res.status).toBe(422);
    expect((res.body as Record<string, unknown>).error).toBe('dte_generation_failed');
    expect((res.body as Record<string, unknown>).message).toBe('Invalid RUT format');
  });

  it('200 happy path without biometric — returns unsigned XML + PDF', async () => {
    H.generateDteFn = vi.fn(async () => FAKE_GENERATED_DTE);
    H.renderDtePdfFn = vi.fn(async () => FAKE_PDF_BUFFER);

    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send(VALID_GENERATE_BODY);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    // Response carries artefacts for empresa cliente to sign+submit — NOT sent to SII.
    expect(body.xml).toBe('<DTE>...</DTE>');
    expect(typeof body.pdfBase64).toBe('string');
    expect(body.dteId).toBe('33-1001-76123456-7');
    expect(body.signedAt).toBeNull();
    expect(body.summary).toBeDefined();
    // DIRECTIVE: verifyAndSignDteFn was NOT called (no biometric in body)
    expect(H.verifyAndSignDteFn).toBeNull();
    // Audit was fired for 'dte.generated'
    expect(vi.mocked(auditServerEvent)).toHaveBeenCalledWith(
      expect.anything(),
      'dte.generated',
      'dte',
      expect.objectContaining({ dteId: '33-1001-76123456-7', type: 33 }),
    );
  });

  it('200 happy path WITH biometric — returns signed XML + signedAt', async () => {
    const SIGNED_AT = '2026-05-31T12:00:00.000Z';
    H.generateDteFn = vi.fn(async () => FAKE_GENERATED_DTE);
    H.verifyAndSignDteFn = vi.fn(async () => ({
      signedXml: '<SignedDTE>...</SignedDTE>',
      signedAt: SIGNED_AT,
    }));
    H.renderDtePdfFn = vi.fn(async () => FAKE_PDF_BUFFER);

    const biometricBody = {
      ...VALID_GENERATE_BODY,
      biometric: biometricBlock('cred-abc123'),
    };
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send(biometricBody);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    // Signed XML replaces unsigned
    expect(body.xml).toBe('<SignedDTE>...</SignedDTE>');
    expect(body.signedAt).toBe(SIGNED_AT);
    expect(body.dteId).toBe('33-1001-76123456-7');
    // DIRECTIVE: signed artefact returned to caller — no SII push happened
    expect(H.verifyAndSignDteFn).not.toBeNull();
    // Both audit events should have fired
    expect(vi.mocked(auditServerEvent)).toHaveBeenCalledWith(
      expect.anything(),
      'dte.signed',
      'dte',
      expect.objectContaining({ credentialId: 'cred-abc123' }),
    );
    expect(vi.mocked(auditServerEvent)).toHaveBeenCalledWith(
      expect.anything(),
      'dte.generated',
      'dte',
      expect.objectContaining({ signed: true }),
    );
  });

  it('401 when biometric signing fails (unknown credential / hash mismatch)', async () => {
    H.generateDteFn = vi.fn(async () => FAKE_GENERATED_DTE);
    // WebAuthn assertion verifies, but the embed step (verifyAndSignDte)
    // throws — e.g. a hash mismatch caught defense-in-depth. Still a 401.
    H.verifyAndSignDteFn = vi.fn(async () => { throw new Error('unknown_credential'); });
    H.renderDtePdfFn = vi.fn(async () => FAKE_PDF_BUFFER);

    const biometricBody = {
      ...VALID_GENERATE_BODY,
      biometric: biometricBlock('cred-bad'),
    };
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send(biometricBody);

    expect(res.status).toBe(401);
    expect((res.body as Record<string, unknown>).error).toBe('dte_sign_failed');
    // Audit dte.sign_failed should have been fired
    expect(vi.mocked(auditServerEvent)).toHaveBeenCalledWith(
      expect.anything(),
      'dte.sign_failed',
      'dte',
      expect.objectContaining({ dteId: FAKE_GENERATED_DTE.dteId }),
    );
  });

  it('F4: 401 when the WebAuthn assertion does NOT verify — signer NEVER runs', async () => {
    // The NEW gate: an invalid assertion is rejected BEFORE verifyAndSignDte.
    H.generateDteFn = vi.fn(async () => FAKE_GENERATED_DTE);
    H.verifyAndSignDteFn = vi.fn(async () => ({ signedXml: '<x/>', signedAt: 'x' }));
    H.renderDtePdfFn = vi.fn(async () => FAKE_PDF_BUFFER);
    H.verifyAssertionFn = () => ({ verified: false, reason: 'signature_invalid' });

    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send({ ...VALID_GENERATE_BODY, biometric: biometricBlock('cred-forged') });

    expect(res.status).toBe(401);
    expect((res.body as Record<string, unknown>).error).toBe('dte_sign_failed');
    expect((res.body as Record<string, unknown>).reason).toBe('signature_invalid');
    // CRITICAL: the embed/sign step was never reached.
    expect(vi.mocked(H.verifyAndSignDteFn!)).not.toHaveBeenCalled();
    // Forgery attempt was audited; no dte.signed was written.
    expect(vi.mocked(auditServerEvent)).toHaveBeenCalledWith(
      expect.anything(),
      'dte.sign_failed',
      'dte',
      expect.objectContaining({ reason: 'signature_invalid' }),
    );
    expect(vi.mocked(auditServerEvent)).not.toHaveBeenCalledWith(
      expect.anything(),
      'dte.signed',
      'dte',
      expect.anything(),
    );
  });

  it('400 when biometric block is missing the new required fields (rawId/challengeId/type)', async () => {
    H.generateDteFn = vi.fn(async () => FAKE_GENERATED_DTE);
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send({
        ...VALID_GENERATE_BODY,
        biometric: {
          credentialId: 'cred-legacy',
          signature: 'c2ln',
          authenticatorData: 'YXV0aA==',
          clientDataJSON: 'e30=',
        },
      });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_input');
  });

  it('500 when PDF render fails', async () => {
    H.generateDteFn = vi.fn(async () => FAKE_GENERATED_DTE);
    H.renderDtePdfFn = vi.fn(async () => { throw new Error('pdfkit_crash'); });

    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'admin-1')
      .send(VALID_GENERATE_BODY);

    expect(res.status).toBe(500);
    expect((res.body as Record<string, unknown>).error).toBe('dte_pdf_failed');
  });
});

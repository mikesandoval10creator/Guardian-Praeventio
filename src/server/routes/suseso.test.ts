// SPDX-License-Identifier: MIT
// Sprint 49 D.8.a — route tests for the new admin-gated SUSESO surface.
//
// We rebuild a minimal Express app (mirroring photogrammetry.test.ts /
// iot.test.ts pattern) so the tests don't need firebase-admin. The router
// under test reads `req.user.role` so we forge it directly via a custom
// fake-auth middleware.
//
// Node ≥24 removed `util.isRegExp`, which the `qs` library (Express's
// default extended query parser) calls. We pin `app.set('query parser',
// 'simple')` to skip the qs codepath entirely — fine here since none of
// the SUSESO endpoints read query strings.
//
// Coverage:
//   1. POST /api/suseso/folio/generate — admin happy path
//   2. POST /api/suseso/folio/generate — non-admin → 403
//   3. POST /api/suseso/folio/generate — missing auth → 401
//   4. POST /api/suseso/folio/generate — invalid kind → 400
//   5. POST /api/suseso/folio/generate — sequence increments
//   6. POST /api/suseso/diat/render — admin + valid HMAC → 200 + pdfBase64
//   7. POST /api/suseso/diat/render — admin but bad HMAC → 403
//   8. POST /api/suseso/diat/render — future eventDate → 400
//   9. POST /api/suseso/diat/render — malformed RUT → 400
//  10. POST /api/suseso/diat/render — lat/lng outside Chile + jurisdiction=CL → 400
//  11. POST /api/suseso/diat/render — admin role 'gerente' accepted
//  12. POST /api/suseso/diep/render — admin + valid HMAC → 200
//  13. POST /api/suseso/diep/render — non-admin (supervisor) → 403
//  14. GET /api/suseso/verify/:folio — unknown folio → valid:false (public, no auth)
//  15. GET /api/suseso/verify/:folio — malformed folio shape → reason:malformed_folio

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { validate } from '../middleware/validate.js';
import { isAdminRole } from '../../types/roles.js';
import {
  canonicalize,
  verifyEmployerSignature,
} from '../../services/suseso/susesoServerOnlyHelpers.js';
import {
  nextFolio,
  parseFolio,
  type MinimalFolioStore,
} from '../../services/suseso/folioGenerator.js';

const STRONG_TOKEN = 'a'.repeat(64);
const TEST_ENV = {
  SUSESO_MUTUALITY_ID: 'achs',
  SUSESO_EMPLOYER_TOKEN: STRONG_TOKEN,
} as unknown as NodeJS.ProcessEnv;

function buildInMemoryFolioStore(): MinimalFolioStore {
  const data = new Map<string, { lastSeq: number }>();
  return {
    async runTransaction(fn) {
      return fn({
        async get(path) {
          const v = data.get(path);
          return v ? { exists: true, data: v } : { exists: false };
        },
        set(path, value) {
          data.set(path, value);
        },
      });
    },
  };
}

interface InMemoryForms {
  byTenantAndId: Map<string, unknown>;
}
function newForms(): InMemoryForms {
  return { byTenantAndId: new Map() };
}

const folioGenerateSchema = z.object({
  tenantId: z.string().min(1).max(128),
  kind: z.enum(['DIAT', 'DIEP']),
  year: z.number().int().min(2020).max(2100).optional(),
});

function isReasonableEventDate(iso: string, now: Date = new Date()): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t <= now.getTime() + 5 * 60 * 1000;
}

const renderSchema = z.object({
  tenantId: z.string().min(1).max(128),
  folio: z.string().regex(/^(DIAT|DIEP)-\d{4}-[a-z0-9]{8}-\d{6}$/).optional(),
  victimUid: z.string().min(1),
  victimRut: z.string().regex(/^\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]$/, 'malformed_rut'),
  victimFullName: z.string().min(1).max(256),
  companyRut: z.string().regex(/^\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]$/, 'malformed_company_rut'),
  companyName: z.string().min(1).max(256),
  mutualidad: z.enum(['achs', 'mutual_seguridad', 'ist', 'isl']),
  eventDate: z.string().refine(isReasonableEventDate, {
    message: 'eventDate is in the future or unparseable',
  }),
  eventLocation: z.string().min(1).max(512),
  eventDescription: z.string().min(1).max(4096),
  eventLat: z.number().min(-90).max(90).optional(),
  eventLng: z.number().min(-180).max(180).optional(),
  jurisdiction: z.enum(['CL', 'INT']).default('CL'),
  bodyPartsAffected: z.array(z.string().min(1).max(64)).max(20).default([]),
  witnesses: z
    .array(z.object({
      fullName: z.string().min(1).max(256),
      rut: z.string().regex(/^\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]$/),
    }))
    .max(10)
    .default([]),
  employerSignatureToken: z.string().regex(/^[0-9a-f]{64}$/i),
});

const CL_BBOX = { latMin: -56.5, latMax: -17.4, lngMin: -109.5, lngMax: -66.5 };

interface AppDeps {
  folioStore: MinimalFolioStore;
  forms: InMemoryForms;
  knownFolios: Set<string>;
}

function buildApp(deps: AppDeps, env: NodeJS.ProcessEnv = TEST_ENV): Express {
  const app = express();
  // Node ≥24 + Express 4 + qs incompatibility: qs calls util.isRegExp,
  // removed in Node 24. We don't read query strings, so 'simple' is enough.
  app.set('query parser', 'simple');
  app.use(express.json());

  const verifyAuth = (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = auth.slice('Bearer '.length);
    const [uid, role] = token.split(':');
    if (!uid) return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    req.user = { uid, role: role ?? 'worker' };
    next();
  };

  const verifyAdmin = (req: any, res: any, next: any) => {
    const role = req.user?.role;
    if (!isAdminRole(role)) {
      return res.status(403).json({ error: 'forbidden_role', reason: 'requires_admin' });
    }
    next();
  };

  app.post(
    '/api/suseso/folio/generate',
    verifyAuth,
    verifyAdmin,
    validate(folioGenerateSchema),
    async (req: any, res: any) => {
      const { tenantId, kind, year } = req.validated;
      try {
        const resolvedYear = year ?? new Date().getUTCFullYear();
        const folio = await nextFolio(deps.folioStore, tenantId, kind, resolvedYear);
        deps.knownFolios.add(folio);
        const parsed = parseFolio(folio);
        return res.json({
          folio,
          kind,
          year: resolvedYear,
          sequenceNumber: parsed?.seq ?? null,
        });
      } catch {
        return res.status(500).json({ error: 'folio_generate_failed' });
      }
    },
  );

  const renderHandler = (kind: 'DIAT' | 'DIEP') => async (req: any, res: any) => {
    const input = req.validated;
    if (
      input.jurisdiction === 'CL' &&
      typeof input.eventLat === 'number' &&
      typeof input.eventLng === 'number'
    ) {
      if (
        input.eventLat < CL_BBOX.latMin ||
        input.eventLat > CL_BBOX.latMax ||
        input.eventLng < CL_BBOX.lngMin ||
        input.eventLng > CL_BBOX.lngMax
      ) {
        return res.status(400).json({
          error: 'invalid_payload',
          reason: 'event_location_outside_chile',
        });
      }
    }
    const hmacPayload = {
      kind,
      tenantId: input.tenantId,
      victimRut: input.victimRut,
      companyRut: input.companyRut,
      eventDate: input.eventDate,
      eventLocation: input.eventLocation,
    };
    if (!verifyEmployerSignature(input.employerSignatureToken, hmacPayload, env)) {
      return res.status(403).json({
        error: 'forbidden_employer_signature',
        reason: 'hmac_mismatch_or_credentials_missing',
      });
    }
    const resolvedYear = new Date().getUTCFullYear();
    const folio = await nextFolio(deps.folioStore, input.tenantId, kind, resolvedYear);
    deps.knownFolios.add(folio);
    deps.forms.byTenantAndId.set(`${input.tenantId}/${folio}`, {
      kind,
      folio,
      ...input,
    });
    const pdfBytes = Buffer.from(`%PDF-fake-${folio}`);
    return res.json({
      folio,
      pdfBase64: pdfBytes.toString('base64'),
      sha256: 'a'.repeat(64),
      signedAt: new Date().toISOString(),
    });
  };

  app.post(
    '/api/suseso/diat/render',
    verifyAuth,
    verifyAdmin,
    validate(renderSchema),
    renderHandler('DIAT'),
  );

  app.post(
    '/api/suseso/diep/render',
    verifyAuth,
    verifyAdmin,
    validate(renderSchema),
    renderHandler('DIEP'),
  );

  app.get('/api/suseso/verify/:folio', (req: any, res: any) => {
    const folio = req.params.folio;
    if (!parseFolio(folio)) {
      return res.json({ valid: false, reason: 'malformed_folio' });
    }
    if (!deps.knownFolios.has(folio)) {
      return res.json({ valid: false, reason: 'unknown_folio' });
    }
    return res.json({ valid: true, kind: parseFolio(folio)?.kind });
  });

  return app;
}

function sign(payload: Record<string, unknown>, key: string = STRONG_TOKEN): string {
  return createHmac('sha256', key).update(canonicalize(payload)).digest('hex');
}

function makeRenderBody(overrides: Record<string, any> = {}): Record<string, any> {
  const base: Record<string, any> = {
    tenantId: 'tenant-a',
    victimUid: 'uid-victim-1',
    victimRut: '11.111.111-1',
    victimFullName: 'Juan Perez',
    companyRut: '76.123.456-7',
    companyName: 'Constructora Acme SpA',
    mutualidad: 'achs',
    eventDate: '2026-05-01T10:00:00.000Z',
    eventLocation: 'Obra Calle Falsa 123, Santiago',
    eventDescription: 'Resbalon en pasarela mojada, contusion en rodilla.',
    jurisdiction: 'CL',
    bodyPartsAffected: ['rodilla_derecha'],
    witnesses: [],
  };
  const merged = { ...base, ...overrides };
  const hmacPayload = {
    kind: overrides.kind ?? 'DIAT',
    tenantId: merged.tenantId,
    victimRut: merged.victimRut,
    companyRut: merged.companyRut,
    eventDate: merged.eventDate,
    eventLocation: merged.eventLocation,
  };
  merged.employerSignatureToken = overrides.employerSignatureToken ?? sign(hmacPayload);
  delete merged.kind;
  return merged;
}

describe('POST /api/suseso/folio/generate', () => {
  let deps: AppDeps;
  beforeEach(() => {
    deps = { folioStore: buildInMemoryFolioStore(), forms: newForms(), knownFolios: new Set() };
  });

  // Cold-start of the supertest + express stack on this Node version can
  // exceed the default 5s timeout on the first request; subsequent tests
  // share the warm module graph and run in <50ms.
  it('returns a folio for an admin caller', async () => {
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/suseso/folio/generate')
      .set('Authorization', 'Bearer uid-1:admin')
      .send({ tenantId: 'tenant-a', kind: 'DIAT', year: 2026 });
    expect(res.status).toBe(200);
    expect(res.body.folio).toMatch(/^DIAT-2026-[a-z0-9]{8}-000001$/);
    expect(res.body.sequenceNumber).toBe(1);
  }, 15000);

  it('rejects a non-admin caller with 403', async () => {
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/suseso/folio/generate')
      .set('Authorization', 'Bearer uid-1:worker')
      .send({ tenantId: 'tenant-a', kind: 'DIAT' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('rejects missing auth with 401', async () => {
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/suseso/folio/generate')
      .send({ tenantId: 'tenant-a', kind: 'DIAT' });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid kind with 400', async () => {
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/suseso/folio/generate')
      .set('Authorization', 'Bearer uid-1:admin')
      .send({ tenantId: 'tenant-a', kind: 'NOPE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('increments the sequence number across calls', async () => {
    const app = buildApp(deps);
    const a = await request(app)
      .post('/api/suseso/folio/generate')
      .set('Authorization', 'Bearer uid-1:admin')
      .send({ tenantId: 'tenant-a', kind: 'DIAT', year: 2026 });
    const b = await request(app)
      .post('/api/suseso/folio/generate')
      .set('Authorization', 'Bearer uid-1:admin')
      .send({ tenantId: 'tenant-a', kind: 'DIAT', year: 2026 });
    expect(a.body.sequenceNumber).toBe(1);
    expect(b.body.sequenceNumber).toBe(2);
  });
});

describe('POST /api/suseso/diat/render', () => {
  let deps: AppDeps;
  beforeEach(() => {
    deps = { folioStore: buildInMemoryFolioStore(), forms: newForms(), knownFolios: new Set() };
  });

  it('renders a DIAT PDF for an admin caller with a valid HMAC', async () => {
    const app = buildApp(deps);
    const body = makeRenderBody({ kind: 'DIAT' });
    const res = await request(app)
      .post('/api/suseso/diat/render')
      .set('Authorization', 'Bearer uid-1:admin')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.folio).toMatch(/^DIAT-/);
    expect(res.body.pdfBase64).toBeTruthy();
    expect(typeof res.body.signedAt).toBe('string');
  });

  it('rejects render with a bad HMAC token', async () => {
    const app = buildApp(deps);
    const body = makeRenderBody({
      kind: 'DIAT',
      employerSignatureToken: 'f'.repeat(64),
    });
    const res = await request(app)
      .post('/api/suseso/diat/render')
      .set('Authorization', 'Bearer uid-1:admin')
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_employer_signature');
  });

  it('rejects a future eventDate (>5min ahead)', async () => {
    const app = buildApp(deps);
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const body = makeRenderBody({ kind: 'DIAT', eventDate: future });
    const res = await request(app)
      .post('/api/suseso/diat/render')
      .set('Authorization', 'Bearer uid-1:admin')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('rejects a malformed RUT', async () => {
    const app = buildApp(deps);
    const body = makeRenderBody({ kind: 'DIAT', victimRut: 'not-a-rut' });
    const res = await request(app)
      .post('/api/suseso/diat/render')
      .set('Authorization', 'Bearer uid-1:admin')
      .send(body);
    expect(res.status).toBe(400);
  });

  it('rejects lat/lng outside Chile with jurisdiction=CL', async () => {
    const app = buildApp(deps);
    const body = makeRenderBody({
      kind: 'DIAT',
      eventLat: 40.0,
      eventLng: -74.0,
    });
    const res = await request(app)
      .post('/api/suseso/diat/render')
      .set('Authorization', 'Bearer uid-1:admin')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('event_location_outside_chile');
  });

  it('accepts a gerente role as admin', async () => {
    const app = buildApp(deps);
    const body = makeRenderBody({ kind: 'DIAT' });
    const res = await request(app)
      .post('/api/suseso/diat/render')
      .set('Authorization', 'Bearer uid-1:gerente')
      .send(body);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/suseso/diep/render', () => {
  let deps: AppDeps;
  beforeEach(() => {
    deps = { folioStore: buildInMemoryFolioStore(), forms: newForms(), knownFolios: new Set() };
  });

  it('renders a DIEP PDF for an admin caller', async () => {
    const app = buildApp(deps);
    const body = makeRenderBody({ kind: 'DIEP' });
    const res = await request(app)
      .post('/api/suseso/diep/render')
      .set('Authorization', 'Bearer uid-1:admin')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.folio).toMatch(/^DIEP-/);
  });

  it('rejects a non-admin (supervisor) caller', async () => {
    const app = buildApp(deps);
    const body = makeRenderBody({ kind: 'DIEP' });
    const res = await request(app)
      .post('/api/suseso/diep/render')
      .set('Authorization', 'Bearer uid-1:supervisor')
      .send(body);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/suseso/verify/:folio (public)', () => {
  let deps: AppDeps;
  beforeEach(() => {
    deps = { folioStore: buildInMemoryFolioStore(), forms: newForms(), knownFolios: new Set() };
  });

  it('returns valid:false for an unknown folio (no auth required)', async () => {
    const app = buildApp(deps);
    const res = await request(app).get('/api/suseso/verify/DIAT-2026-aaaaaaaa-000999');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe('unknown_folio');
  });

  it('returns valid:false reason=malformed_folio on a bad folio shape', async () => {
    const app = buildApp(deps);
    const res = await request(app).get('/api/suseso/verify/not-a-folio');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe('malformed_folio');
  });
});

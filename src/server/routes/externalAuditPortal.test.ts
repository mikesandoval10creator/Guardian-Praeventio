// Praeventio Guard — externalAuditPortal contract tests.
//
// Wire-orphan Bloque 3 §3.7. 8 tests covering:
//   1. admin POST /create requires Bearer; 401 without
//   2. admin POST /create persists portal and returns plaintext token once
//   3. public GET /public/:token allows access within scope + appends log
//   4. public GET /public/:token denies (403) after `expiresAt` (token expiry)
//   5. public GET /public/:token denies (403) when module/project NOT in scope
//   6. admin GET /admin/list is tenant-scoped (other tenant's portal NOT seen)
//   7. admin POST /:portalId/revoke flips status and blocks subsequent public GETs
//   8. admin GET /:portalId/access-log returns the logged entries
//
// Pattern mirrors visitors.test.ts: minimal Express app rebuilt with the
// engine + adapter, the AuditPortalAdapter wired to a `createFakeFirestore`,
// and a stubbed verifyAuth that resolves a token→user from a Map. We DO NOT
// boot firebase-admin in tests; the route's behavioral surface is exercised
// directly.

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import {
  createPortal,
  derivePortalStatus,
  revokePortal,
  checkAccess,
  PortalValidationError,
  type AuditModule,
  type AuditorAffiliation,
} from '../../services/auditPortal/externalAuditPortal.js';
import {
  AuditPortalAdapter,
  hashAccessToken,
  type StoredAuditPortal,
} from '../../services/auditPortal/auditPortalFirestoreAdapter.js';
import { createFakeFirestore, type FakeFirestoreDb } from '../../test/fakeFirestore.js';

// ────────────────────────────────────────────────────────────────────────
// Test scaffolding — mirror of visitors.test.ts buildApp pattern
// ────────────────────────────────────────────────────────────────────────

interface FakeUser {
  uid: string;
  tenantId: string;
}

interface TestDeps {
  users: Map<string, FakeUser>;
  firestore: FakeFirestoreDb;
}

const MODULES: readonly AuditModule[] = [
  'documents',
  'iper_matrix',
  'trainings',
  'epp',
  'incidents',
  'corrective_actions',
  'evidences',
  'compliance_snapshot',
];
const AFFILIATIONS: readonly AuditorAffiliation[] = [
  'mandante',
  'suseso',
  'mutualidad',
  'iso',
  'seremi',
  'dt',
  'cliente',
  'other',
];

const createSchema = z.object({
  id: z.string().min(1).max(200),
  auditorName: z.string().min(3).max(500),
  auditorAffiliation: z.enum(AFFILIATIONS as readonly [AuditorAffiliation, ...AuditorAffiliation[]]),
  auditorEmail: z.string().email().max(500).optional(),
  scopeProjectIds: z.array(z.string().min(1).max(200)).min(1).max(500),
  scopeModules: z
    .array(z.enum(MODULES as readonly [AuditModule, ...AuditModule[]]))
    .min(1)
    .max(MODULES.length),
  ttlDays: z.number().int().min(1).max(90),
  internalNotes: z.string().max(5000).optional(),
});

const revokeSchema = z.object({
  reason: z.string().min(10).max(5000),
});

const publicQuerySchema = z.object({
  module: z.enum(MODULES as readonly [AuditModule, ...AuditModule[]]),
  projectId: z.string().min(1).max(200),
  download: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional(),
});

interface StoredWithCollectionGroupLookup {
  /** Stored portal record (hash, not plaintext). */
  stored: StoredAuditPortal;
  tenantId: string;
}

/**
 * Test-only collection-group emulation. The real route uses Firestore's
 * collectionGroup() which we don't have on the fake. Iterate all known
 * tenants and scan their audit_portals collections for the matching hash.
 */
async function emulateCollectionGroupFindByTokenHash(
  db: FakeFirestoreDb,
  tokenHash: string,
): Promise<StoredWithCollectionGroupLookup | null> {
  const dump = db._dump();
  for (const [path, col] of dump.entries()) {
    if (!path.startsWith('tenants/')) continue;
    if (!path.endsWith('/audit_portals')) continue;
    const tenantId = path.split('/')[1];
    for (const [, doc] of col.entries()) {
      if ((doc as StoredAuditPortal).accessTokenHash === tokenHash) {
        return { stored: doc as StoredAuditPortal, tenantId };
      }
    }
  }
  return null;
}

function projectToAdminView(stored: StoredAuditPortal, now: Date) {
  const { accessTokenHash, ...rest } = stored;
  void accessTokenHash;
  const status = derivePortalStatus(
    rest as unknown as Parameters<typeof derivePortalStatus>[0],
    now,
  );
  return { ...rest, status };
}

function buildApp(deps: TestDeps): Express {
  const app = express();
  app.use(express.json());

  const verifyAuth = (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: No token provided' });
      return;
    }
    const token = auth.slice('Bearer '.length);
    const user = deps.users.get(token);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }
    (req as any).user = user;
    next();
  };

  // ── POST /api/audit-portal/create ────────────────────────────────────
  app.post(
    '/api/audit-portal/create',
    verifyAuth,
    validate(createSchema),
    async (req: any, res: any) => {
      const callerUid = req.user.uid as string;
      const callerTenant = req.user.tenantId as string;
      const body = req.validated as z.infer<typeof createSchema>;
      try {
        const portal = createPortal({
          id: body.id,
          createdByUid: callerUid,
          auditorName: body.auditorName,
          auditorAffiliation: body.auditorAffiliation,
          auditorEmail: body.auditorEmail,
          scopeProjectIds: body.scopeProjectIds,
          scopeModules: body.scopeModules,
          ttlDays: body.ttlDays,
          internalNotes: body.internalNotes,
        });
        const adapter = new AuditPortalAdapter(deps.firestore as any, callerTenant);
        await adapter.save(portal);
        return res.status(201).json({
          portal: {
            ...projectToAdminView(
              {
                ...portal,
                accessTokenHash: hashAccessToken(portal.accessToken),
              } as unknown as StoredAuditPortal,
              new Date(),
            ),
            oneTimeAccessToken: portal.accessToken,
          },
        });
      } catch (err) {
        if (err instanceof PortalValidationError) {
          return res.status(400).json({
            error: 'validation_error',
            code: err.code,
            message: err.message,
          });
        }
        return res.status(500).json({ error: 'internal_error' });
      }
    },
  );

  // ── GET /api/audit-portal/admin/list ─────────────────────────────────
  app.get(
    '/api/audit-portal/admin/list',
    verifyAuth,
    async (req: any, res: any) => {
      const tenantId = req.user.tenantId as string;
      const affiliation = req.query.affiliation as AuditorAffiliation | undefined;
      const adapter = new AuditPortalAdapter(deps.firestore as any, tenantId);
      const now = new Date();
      let portals: StoredAuditPortal[];
      if (affiliation) {
        portals = await adapter.listByAffiliation(affiliation, 50);
      } else {
        const snap = await deps.firestore
          .collection(`tenants/${tenantId}/audit_portals`)
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();
        portals = snap.docs.map((d) => d.data() as StoredAuditPortal);
      }
      return res.json({ portals: portals.map((p) => projectToAdminView(p, now)) });
    },
  );

  // ── POST /api/audit-portal/:portalId/revoke ─────────────────────────
  app.post(
    '/api/audit-portal/:portalId/revoke',
    verifyAuth,
    validate(revokeSchema),
    async (req: any, res: any) => {
      const callerUid = req.user.uid as string;
      const tenantId = req.user.tenantId as string;
      const { portalId } = req.params;
      const body = req.validated as z.infer<typeof revokeSchema>;
      const adapter = new AuditPortalAdapter(deps.firestore as any, tenantId);
      const stored = await adapter.getById(portalId);
      if (!stored) {
        return res.status(404).json({ error: 'portal_not_found' });
      }
      const now = new Date();
      try {
        const revoked = revokePortal(
          {
            ...(stored as unknown as Parameters<typeof revokePortal>[0]),
            accessToken: '<redacted>',
          },
          callerUid,
          body.reason,
          now,
        );
        await adapter.markRevoked(
          portalId,
          revoked.revokedAt!,
          revoked.revokedByUid!,
          revoked.revokedReason!,
        );
        const updated = await adapter.getById(portalId);
        return res.json({ portal: projectToAdminView(updated!, now) });
      } catch (err) {
        if (err instanceof PortalValidationError) {
          return res.status(400).json({
            error: 'validation_error',
            code: err.code,
            message: err.message,
          });
        }
        return res.status(500).json({ error: 'internal_error' });
      }
    },
  );

  // ── GET /api/audit-portal/:portalId/access-log ──────────────────────
  app.get(
    '/api/audit-portal/:portalId/access-log',
    verifyAuth,
    async (req: any, res: any) => {
      const tenantId = req.user.tenantId as string;
      const { portalId } = req.params;
      const adapter = new AuditPortalAdapter(deps.firestore as any, tenantId);
      const stored = await adapter.getById(portalId);
      if (!stored) {
        return res.status(404).json({ error: 'portal_not_found' });
      }
      const logs = await adapter.listAccessLogs(portalId, 200);
      return res.json({ portalId, logs });
    },
  );

  // ── GET /api/audit-portal/public/:token (NO verifyAuth) ─────────────
  app.get(
    '/api/audit-portal/public/:token',
    validate(publicQuerySchema, 'query'),
    async (req: any, res: any) => {
      const { token } = req.params;
      const q = req.validated as z.infer<typeof publicQuerySchema>;
      if (!token || token.length < 16 || token.length > 256) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const now = new Date();
      const tokenHash = hashAccessToken(token);
      const found = await emulateCollectionGroupFindByTokenHash(
        deps.firestore,
        tokenHash,
      );
      if (!found) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { stored, tenantId } = found;
      const portalForCheck = {
        ...(stored as unknown as Parameters<typeof checkAccess>[0]),
        accessToken: token,
      };
      const decision = checkAccess(
        portalForCheck as Parameters<typeof checkAccess>[0],
        { token, module: q.module, projectId: q.projectId },
        now,
      );
      const adapter = new AuditPortalAdapter(deps.firestore as any, tenantId);
      if (!decision.allowed) {
        try {
          await adapter.appendAccessLog({
            portalId: stored.id,
            accessedAt: now.toISOString(),
            module: q.module,
            downloaded: false,
            payloadBytes: 0,
            ip: '127.0.0.1',
            userAgent: 'vitest',
          });
        } catch {
          /* swallow */
        }
        return res.status(403).json({ error: 'forbidden' });
      }
      const downloaded = q.download === true || q.download === 'true';
      try {
        await adapter.appendAccessLog({
          portalId: stored.id,
          accessedAt: now.toISOString(),
          module: q.module,
          downloaded,
          ip: '127.0.0.1',
          userAgent: 'vitest',
        });
      } catch {
        /* swallow */
      }
      return res.json({
        portal: {
          portalId: stored.id,
          auditorName: stored.auditorName,
          auditorAffiliation: stored.auditorAffiliation,
          expiresAt: stored.expiresAt,
          scopeModules: stored.scopeModules,
          scopeProjectIds: stored.scopeProjectIds,
          module: q.module,
          projectId: q.projectId,
          tenantId,
        },
      });
    },
  );

  return app;
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('/api/audit-portal (externalAuditPortal contract)', () => {
  let deps: TestDeps;

  beforeEach(() => {
    deps = {
      users: new Map([
        ['admin-alpha-token', { uid: 'admin_alpha', tenantId: 'tenant_alpha' }],
        ['admin-beta-token', { uid: 'admin_beta', tenantId: 'tenant_beta' }],
      ]),
      firestore: createFakeFirestore(),
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // 1. admin auth
  // ──────────────────────────────────────────────────────────────────────
  it('POST /create requires Bearer auth (401 without token)', async () => {
    const app = buildApp(deps);
    const r = await request(app)
      .post('/api/audit-portal/create')
      .send({
        id: 'ap-1',
        auditorName: 'Ana Fiscalizadora',
        auditorAffiliation: 'suseso',
        scopeProjectIds: ['p1'],
        scopeModules: ['documents'],
        ttlDays: 14,
      });
    expect(r.status).toBe(401);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. admin POST /create persists + returns one-time token
  // ──────────────────────────────────────────────────────────────────────
  it('POST /create persists portal under tenant + returns plaintext token once', async () => {
    const app = buildApp(deps);
    const r = await request(app)
      .post('/api/audit-portal/create')
      .set('Authorization', 'Bearer admin-alpha-token')
      .send({
        id: 'ap-1',
        auditorName: 'Ana Fiscalizadora',
        auditorAffiliation: 'suseso',
        scopeProjectIds: ['p1', 'p2'],
        scopeModules: ['documents', 'incidents'],
        ttlDays: 7,
        internalNotes: 'Visita programada con SUSESO',
      });
    expect(r.status).toBe(201);
    expect(r.body.portal.id).toBe('ap-1');
    expect(r.body.portal.createdByUid).toBe('admin_alpha');
    expect(r.body.portal.status).toBe('active');
    expect(r.body.portal.oneTimeAccessToken).toMatch(/^[a-f0-9]{64}$/);
    // List view never echoes the plaintext token back.
    const list = await request(app)
      .get('/api/audit-portal/admin/list')
      .set('Authorization', 'Bearer admin-alpha-token');
    expect(list.status).toBe(200);
    expect(list.body.portals).toHaveLength(1);
    expect((list.body.portals[0] as any).accessToken).toBeUndefined();
    expect((list.body.portals[0] as any).accessTokenHash).toBeUndefined();
    expect((list.body.portals[0] as any).oneTimeAccessToken).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. public GET grants access in-scope + appends access log
  // ──────────────────────────────────────────────────────────────────────
  it('GET /public/:token allows access in scope + appends access_log', async () => {
    const app = buildApp(deps);
    const created = await request(app)
      .post('/api/audit-portal/create')
      .set('Authorization', 'Bearer admin-alpha-token')
      .send({
        id: 'ap-1',
        auditorName: 'Ana Fiscalizadora',
        auditorAffiliation: 'suseso',
        scopeProjectIds: ['p1'],
        scopeModules: ['documents'],
        ttlDays: 7,
      });
    const token = created.body.portal.oneTimeAccessToken as string;
    const r = await request(app).get(
      `/api/audit-portal/public/${token}?module=documents&projectId=p1`,
    );
    expect(r.status).toBe(200);
    expect(r.body.portal.portalId).toBe('ap-1');
    expect(r.body.portal.auditorName).toBe('Ana Fiscalizadora');
    // Access log present
    const log = await request(app)
      .get('/api/audit-portal/ap-1/access-log')
      .set('Authorization', 'Bearer admin-alpha-token');
    expect(log.status).toBe(200);
    expect(log.body.logs).toHaveLength(1);
    expect(log.body.logs[0].module).toBe('documents');
    expect(log.body.logs[0].downloaded).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. token expiry (TTL) — public GET 403 after expiresAt
  // ──────────────────────────────────────────────────────────────────────
  it('GET /public/:token denies (403) when portal has expired (TTL)', async () => {
    const app = buildApp(deps);
    // Manually craft an EXPIRED portal directly via the adapter — bypasses
    // the create endpoint's now=Date.now() so we can backdate.
    const adapter = new AuditPortalAdapter(deps.firestore as any, 'tenant_alpha');
    const longAgo = new Date('2020-01-01T00:00:00Z');
    const portal = createPortal({
      id: 'ap-expired',
      createdByUid: 'admin_alpha',
      auditorName: 'Carlos Expirado',
      auditorAffiliation: 'mandante',
      scopeProjectIds: ['p1'],
      scopeModules: ['documents'],
      ttlDays: 1,
      now: longAgo,
    });
    await adapter.save(portal);

    const r = await request(app).get(
      `/api/audit-portal/public/${portal.accessToken}?module=documents&projectId=p1`,
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('forbidden');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. scope check — module / project NOT in scope
  // ──────────────────────────────────────────────────────────────────────
  it('GET /public/:token denies (403) when module is NOT in scope', async () => {
    const app = buildApp(deps);
    const created = await request(app)
      .post('/api/audit-portal/create')
      .set('Authorization', 'Bearer admin-alpha-token')
      .send({
        id: 'ap-2',
        auditorName: 'Berta Asegurada',
        auditorAffiliation: 'mutualidad',
        scopeProjectIds: ['p1'],
        scopeModules: ['documents'], // ← only documents
        ttlDays: 7,
      });
    const token = created.body.portal.oneTimeAccessToken as string;
    // Module out-of-scope
    const r1 = await request(app).get(
      `/api/audit-portal/public/${token}?module=epp&projectId=p1`,
    );
    expect(r1.status).toBe(403);
    // Project out-of-scope
    const r2 = await request(app).get(
      `/api/audit-portal/public/${token}?module=documents&projectId=p_other`,
    );
    expect(r2.status).toBe(403);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6. tenant isolation — admin from tenant_beta cannot see tenant_alpha's portals
  // ──────────────────────────────────────────────────────────────────────
  it('GET /admin/list is tenant-scoped — other tenant portals NOT visible', async () => {
    const app = buildApp(deps);
    // Alpha creates portal
    await request(app)
      .post('/api/audit-portal/create')
      .set('Authorization', 'Bearer admin-alpha-token')
      .send({
        id: 'ap-alpha',
        auditorName: 'Auditor Alpha',
        auditorAffiliation: 'suseso',
        scopeProjectIds: ['p1'],
        scopeModules: ['documents'],
        ttlDays: 7,
      });
    // Beta lists — should be empty
    const list = await request(app)
      .get('/api/audit-portal/admin/list')
      .set('Authorization', 'Bearer admin-beta-token');
    expect(list.status).toBe(200);
    expect(list.body.portals).toHaveLength(0);
    // Beta cannot read alpha's access log either
    const log = await request(app)
      .get('/api/audit-portal/ap-alpha/access-log')
      .set('Authorization', 'Bearer admin-beta-token');
    expect(log.status).toBe(404);
    expect(log.body.error).toBe('portal_not_found');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 7. revoke effect — public GET denied after revoke
  // ──────────────────────────────────────────────────────────────────────
  it('POST /:portalId/revoke flips status + blocks subsequent public access', async () => {
    const app = buildApp(deps);
    const created = await request(app)
      .post('/api/audit-portal/create')
      .set('Authorization', 'Bearer admin-alpha-token')
      .send({
        id: 'ap-3',
        auditorName: 'Dora Revocable',
        auditorAffiliation: 'iso',
        scopeProjectIds: ['p1'],
        scopeModules: ['documents'],
        ttlDays: 7,
      });
    const token = created.body.portal.oneTimeAccessToken as string;
    // Confirm public access works first
    const before = await request(app).get(
      `/api/audit-portal/public/${token}?module=documents&projectId=p1`,
    );
    expect(before.status).toBe(200);
    // Revoke
    const revoke = await request(app)
      .post('/api/audit-portal/ap-3/revoke')
      .set('Authorization', 'Bearer admin-alpha-token')
      .send({ reason: 'Fiscalización finalizada por SUSESO' });
    expect(revoke.status).toBe(200);
    expect(revoke.body.portal.status).toBe('revoked');
    expect(revoke.body.portal.revokedByUid).toBe('admin_alpha');
    // Public access denied
    const after = await request(app).get(
      `/api/audit-portal/public/${token}?module=documents&projectId=p1`,
    );
    expect(after.status).toBe(403);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 8. access log endpoint returns logged entries (allowed + denied both logged)
  // ──────────────────────────────────────────────────────────────────────
  it('GET /:portalId/access-log returns full audit trail (allowed + denied)', async () => {
    const app = buildApp(deps);
    const created = await request(app)
      .post('/api/audit-portal/create')
      .set('Authorization', 'Bearer admin-alpha-token')
      .send({
        id: 'ap-4',
        auditorName: 'Elena Trazable',
        auditorAffiliation: 'seremi',
        scopeProjectIds: ['p1'],
        scopeModules: ['documents', 'incidents'],
        ttlDays: 14,
      });
    const token = created.body.portal.oneTimeAccessToken as string;
    // 2 allowed
    await request(app).get(
      `/api/audit-portal/public/${token}?module=documents&projectId=p1`,
    );
    await request(app).get(
      `/api/audit-portal/public/${token}?module=incidents&projectId=p1&download=true`,
    );
    // 1 denied (out-of-scope module)
    await request(app).get(
      `/api/audit-portal/public/${token}?module=epp&projectId=p1`,
    );
    const log = await request(app)
      .get('/api/audit-portal/ap-4/access-log')
      .set('Authorization', 'Bearer admin-alpha-token');
    expect(log.status).toBe(200);
    expect(log.body.logs).toHaveLength(3);
    // logs sorted desc by accessedAt — the most recent (epp deny) is first
    // (but in this test all 3 may share the same wall-clock ms, so we
    // verify the SET of (module,downloaded) tuples rather than ordering).
    const tuples = (log.body.logs as Array<{ module: string; downloaded: boolean }>)
      .map((l) => `${l.module}:${l.downloaded}`)
      .sort();
    expect(tuples).toEqual(
      ['documents:false', 'epp:false', 'incidents:true'].sort(),
    );
  });
});

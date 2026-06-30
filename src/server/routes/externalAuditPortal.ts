// Praeventio Guard — Wire-orphan Bloque 3 §3.7: externalAuditPortal HTTP surface.
//
// Cierra: plan integral Bloque 3 (wire huérfanos).
//
// El engine bajo `src/services/auditPortal/externalAuditPortal.ts` y su
// adapter Firestore (`auditPortalFirestoreAdapter.ts`) implementan el ciclo
// completo: createPortal → save → findByToken → checkAccess → appendAccessLog
// → markRevoked. Faltaba el envoltorio HTTP que conecte el ciclo a:
//
//   (a) un panel admin (`<PortalManager />`) — CRUD de portales para
//       auditores SUSESO/ISP/mutualidad/mandante (verifyAuth + idempotencyKey,
//       createdByUid forzado al caller).
//
//   (b) un portal público (`<PortalPublicView />`) — el auditor externo
//       entra por URL `/audit-portal/{token}` SIN cuenta Praeventio. La
//       autenticación es el token mismo (entropía ≥256 bits, sha-256 hash en
//       Firestore, lookup vía collectionGroup query). Cada acceso queda
//       registrado en `audit_portals/{id}/access_logs` con módulo, timestamp
//       y si fue descarga.
//
// Endpoints:
//
//   ── ADMIN (requieren verifyAuth + project membership) ──────────────────
//   POST   /api/audit-portal/create                        idempotencyKey
//   GET    /api/audit-portal/admin/list?affiliation=…
//   POST   /api/audit-portal/:portalId/revoke              idempotencyKey
//   GET    /api/audit-portal/:portalId/access-log
//
//   ── PUBLIC (token-based, NO verifyAuth) ────────────────────────────────
//   GET    /api/audit-portal/public/:token?module=…&projectId=…
//
// Diseño TTL del token público:
//   • createPortal genera `accessToken` (hex 64 chars, sha256(randomBytes(32))).
//   • El plaintext SE DEVUELVE UNA SOLA VEZ en POST /create — el operador lo
//     copia al canal que va a usar para el auditor (email, papel, WhatsApp).
//   • En Firestore se guarda SHA-256(token) — un leak de Firestore NO compromete
//     el secreto del auditor.
//   • Public GET hashea el token entrante, hace collectionGroup query por
//     `accessTokenHash`, valida `derivePortalStatus(portal, now) === 'active'`,
//     y aplica `checkAccess` sobre {module, projectId}.
//   • La ventana TTL viene de `portal.expiresAt` (input ttlDays clamp [1, 90]).
//   • Revoke instantáneo: `markRevoked` → `derivePortalStatus = 'revoked'`,
//     todos los GETs públicos siguientes responden 403 sin distinguir motivo
//     (no_token vs expired vs revoked vs scope) — superficie pareja para
//     prevenir token-state oracles.
//
// NO TOCA server.ts ni Sidebar.tsx (lo monta el integrador al final).

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { isAdminRole } from '../../types/roles.js';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';
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

const router = Router();

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

// ────────────────────────────────────────────────────────────────────────
// Tenant resolution (admin path only)
// ────────────────────────────────────────────────────────────────────────

/**
 * Admin endpoints need a tenantId to scope reads/writes. We try, in order:
 *   1. The user's tenantId claim from the verified Firebase token (set by
 *      verifyAuth — see PraeventioAuthUser).
 *   2. Lookup users/{uid}.tenantId as fallback for users created before
 *      tenant claims were systematized.
 *
 * Returning null sends 404 — admin actions REQUIRE a known tenant.
 */
async function resolveTenantIdForAdmin(
  callerUid: string,
  callerTenantId: string | undefined,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  if (typeof callerTenantId === 'string' && callerTenantId.length > 0) {
    return callerTenantId;
  }
  const userSnap = await db.collection('users').doc(callerUid).get();
  const data = userSnap.exists ? userSnap.data() : null;
  if (data && typeof data.tenantId === 'string' && data.tenantId.length > 0) {
    return data.tenantId;
  }
  return null;
}

/**
 * B17 (Fase 5): the four admin endpoints below manage external-auditor portals
 * (sensitive — a portal grants an outside party scoped read access to a
 * tenant's compliance data). They had `verifyAuth` but NO role gate, so any
 * authenticated tenant user could create/list/revoke/inspect portals
 * (privilege escalation). This asserts the caller holds an admin role (custom
 * claim), mirroring `admin.ts`. Sends 403 and returns false otherwise.
 */
async function assertAdminCaller(
  req: import('express').Request,
  res: import('express').Response,
): Promise<boolean> {
  const callerUid = req.user?.uid;
  if (!callerUid) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  const callerRecord = await admin.auth().getUser(callerUid);
  if (!isAdminRole(callerRecord.customClaims?.role)) {
    res.status(403).json({ error: 'forbidden_requires_admin' });
    return false;
  }
  return true;
}

/**
 * Public path: the auditor has only a token. We don't know the tenant from
 * the request. Use a collectionGroup query over `audit_portals` keyed by
 * `accessTokenHash` to land on the correct tenant subcollection. The
 * Firestore index on `audit_portals.accessTokenHash` (collectionGroup) makes
 * this O(1) lookup. The parent ref of the doc gives us the tenantId.
 */
async function findPortalByPublicToken(
  token: string,
  db: admin.firestore.Firestore,
): Promise<{ stored: StoredAuditPortal; tenantId: string; portalRef: admin.firestore.DocumentReference } | null> {
  const tokenHash = hashAccessToken(token);
  const snap = await db
    .collectionGroup('audit_portals')
    .where('accessTokenHash', '==', tokenHash)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const stored = doc.data() as StoredAuditPortal;
  // Path: tenants/{tid}/audit_portals/{id}
  const parts = doc.ref.path.split('/');
  // Expected: ['tenants', tenantId, 'audit_portals', portalId]
  if (parts.length < 4 || parts[0] !== 'tenants' || parts[2] !== 'audit_portals') {
    return null;
  }
  const tenantId = parts[1];
  return { stored, tenantId, portalRef: doc.ref };
}

// ────────────────────────────────────────────────────────────────────────
// Conversion: StoredAuditPortal (hash) → admin-facing payload (NO token,
// NO hash). The plaintext token is returned ONLY in POST /create.
// ────────────────────────────────────────────────────────────────────────

interface AdminPortalView {
  id: string;
  createdByUid: string;
  createdAt: string;
  expiresAt: string;
  auditorName: string;
  auditorAffiliation: AuditorAffiliation;
  auditorEmail?: string;
  scopeProjectIds: string[];
  scopeModules: AuditModule[];
  internalNotes?: string;
  revokedAt?: string;
  revokedByUid?: string;
  revokedReason?: string;
  /** Derived at read time — not stored. */
  status: 'active' | 'expired' | 'revoked';
}

function projectToAdminView(stored: StoredAuditPortal, now: Date): AdminPortalView {
  const { accessTokenHash, ...rest } = stored;
  void accessTokenHash; // drop on purpose
  // derivePortalStatus consumes AuditPortalConfig; stored has same shape minus
  // accessToken. Cast safely since derivePortalStatus only reads revokedAt +
  // expiresAt.
  const status = derivePortalStatus(rest as unknown as Parameters<typeof derivePortalStatus>[0], now);
  return { ...rest, status };
}

// ────────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────────

const createPortalSchema = z.object({
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

const adminListQuerySchema = z.object({
  affiliation: z
    .enum(AFFILIATIONS as readonly [AuditorAffiliation, ...AuditorAffiliation[]])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const publicQuerySchema = z.object({
  module: z.enum(MODULES as readonly [AuditModule, ...AuditModule[]]),
  projectId: z.string().min(1).max(200),
  /** Optional client hint that this access will trigger a download. */
  download: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional(),
});

const accessLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// 1. POST /api/audit-portal/create — admin creates a shared portal
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/audit-portal/create',
  verifyAuth,
  idempotencyKey(),
  validate(createPortalSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerTenantId = (req.user as { tenantId?: string } | undefined)?.tenantId;
    const body = req.validated as z.infer<typeof createPortalSchema>;

    if (!(await assertAdminCaller(req, res))) return undefined;
    try {
      const tenantId = await resolveTenantIdForAdmin(
        callerUid,
        callerTenantId,
        admin.firestore(),
      );
      if (!tenantId) {
        return res.status(404).json({ error: 'tenant_not_found' });
      }

      for (const pid of body.scopeProjectIds) {
        try {
          await assertProjectMember(callerUid, pid, admin.firestore());
        } catch (err) {
          if (err instanceof ProjectMembershipError) {
            await auditServerEvent(req, 'externalAuditPortal.scope_denied', 'externalAuditPortal', { projectId: pid });
            return res.status(err.httpStatus).json({ error: 'forbidden_project_scope', projectId: pid });
          }
          throw err;
        }
      }

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
      const adapter = new AuditPortalAdapter(admin.firestore(), tenantId);
      await adapter.save(portal);
      await auditServerEvent(req, 'externalAuditPortal.create', 'externalAuditPortal', {
        portalId: portal.id,
        tenantId,
        auditorAffiliation: portal.auditorAffiliation,
      });
      // Plaintext token returned exactly once. Client must surface it to the
      // operator and let them copy/paste it onto the channel they'll use to
      // hand it to the external auditor — we will never echo it again.
      return res.status(201).json({
        portal: {
          ...projectToAdminView(
            {
              ...portal,
              accessTokenHash: hashAccessToken(portal.accessToken),
            } as unknown as StoredAuditPortal,
            new Date(),
          ),
          // Allow the caller to render the public URL once.
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
      logger.error?.('externalAuditPortal.create.error', err);
      captureRouteError(err, 'externalAuditPortal.create', { callerUid });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. GET /api/audit-portal/admin/list — list portals for tenant
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/audit-portal/admin/list',
  verifyAuth,
  validate(adminListQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerTenantId = (req.user as { tenantId?: string } | undefined)?.tenantId;
    const q = req.validated as z.infer<typeof adminListQuerySchema>;

    if (!(await assertAdminCaller(req, res))) return undefined;
    try {
      const tenantId = await resolveTenantIdForAdmin(
        callerUid,
        callerTenantId,
        admin.firestore(),
      );
      if (!tenantId) {
        return res.status(404).json({ error: 'tenant_not_found' });
      }
      const adapter = new AuditPortalAdapter(admin.firestore(), tenantId);
      const now = new Date();
      let portals: StoredAuditPortal[];
      if (q.affiliation) {
        portals = await adapter.listByAffiliation(q.affiliation, q.limit ?? 50);
      } else {
        // No affiliation filter — query the raw collection ordered by createdAt
        // desc. We use the adapter's listByAffiliation pattern but consume the
        // raw collection ref directly to skip the filter.
        const snap = await admin
          .firestore()
          .collection(`tenants/${tenantId}/audit_portals`)
          .orderBy('createdAt', 'desc')
          .limit(q.limit ?? 50)
          .get();
        portals = snap.docs.map((d) => d.data() as StoredAuditPortal);
      }
      const views = portals.map((p) => projectToAdminView(p, now));
      return res.json({ portals: views });
    } catch (err) {
      logger.error?.('externalAuditPortal.list.error', err);
      captureRouteError(err, 'externalAuditPortal.list', { callerUid });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. POST /api/audit-portal/:portalId/revoke — manually invalidate a portal
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/audit-portal/:portalId/revoke',
  verifyAuth,
  idempotencyKey(),
  validate(revokeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerTenantId = (req.user as { tenantId?: string } | undefined)?.tenantId;
    const { portalId } = req.params;
    const body = req.validated as z.infer<typeof revokeSchema>;

    if (!(await assertAdminCaller(req, res))) return undefined;
    try {
      const tenantId = await resolveTenantIdForAdmin(
        callerUid,
        callerTenantId,
        admin.firestore(),
      );
      if (!tenantId) {
        return res.status(404).json({ error: 'tenant_not_found' });
      }
      const adapter = new AuditPortalAdapter(admin.firestore(), tenantId);
      const stored = await adapter.getById(portalId);
      if (!stored) {
        return res.status(404).json({ error: 'portal_not_found' });
      }
      const now = new Date();
      // revokePortal takes an AuditPortalConfig; we synthesize the missing
      // `accessToken` field with a placeholder (it's not used by revokePortal
      // beyond pass-through). Cast keeps the engine API pure.
      const revoked = revokePortal(
        {
          ...(stored as unknown as Parameters<typeof revokePortal>[0]),
          accessToken: '<redacted>', // not used by revokePortal
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
      if (!updated) {
        return res.status(500).json({ error: 'internal_error' });
      }
      await auditServerEvent(req, 'externalAuditPortal.revoke', 'externalAuditPortal', {
        portalId,
        tenantId,
        reason: body.reason,
      });
      return res.json({ portal: projectToAdminView(updated, now) });
    } catch (err) {
      if (err instanceof PortalValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('externalAuditPortal.revoke.error', err);
      captureRouteError(err, 'externalAuditPortal.revoke', { callerUid });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. GET /api/audit-portal/:portalId/access-log — audit trail per portal
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/audit-portal/:portalId/access-log',
  verifyAuth,
  validate(accessLogQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerTenantId = (req.user as { tenantId?: string } | undefined)?.tenantId;
    const { portalId } = req.params;
    const q = req.validated as z.infer<typeof accessLogQuerySchema>;

    if (!(await assertAdminCaller(req, res))) return undefined;
    try {
      const tenantId = await resolveTenantIdForAdmin(
        callerUid,
        callerTenantId,
        admin.firestore(),
      );
      if (!tenantId) {
        return res.status(404).json({ error: 'tenant_not_found' });
      }
      const adapter = new AuditPortalAdapter(admin.firestore(), tenantId);
      // Confirm the portal exists in THIS tenant — defends against tenant id
      // forgery via the URL param (verifyAuth gives us uid, but the path's
      // :portalId is attacker-controlled).
      const stored = await adapter.getById(portalId);
      if (!stored) {
        return res.status(404).json({ error: 'portal_not_found' });
      }
      const logs = await adapter.listAccessLogs(portalId, q.limit ?? 200);
      return res.json({ portalId, logs });
    } catch (err) {
      logger.error?.('externalAuditPortal.accessLog.error', err);
      captureRouteError(err, 'externalAuditPortal.accessLog', { callerUid });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. GET /api/audit-portal/public/:token — public auditor read endpoint
//    NO verifyAuth. Token IS the credential. Each call appends an
//    access_log row to the portal's subcollection.
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/audit-portal/public/:token',
  validate(publicQuerySchema, 'query'),
  async (req, res) => {
    const { token } = req.params;
    const q = req.validated as z.infer<typeof publicQuerySchema>;

    if (!token || token.length < 16 || token.length > 256) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const now = new Date();
    const ip =
      typeof req.ip === 'string'
        ? req.ip
        : Array.isArray(req.ips) && req.ips.length > 0
          ? req.ips[0]
          : undefined;
    const userAgent =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : undefined;
    const downloaded =
      q.download === true || q.download === 'true' ? true : false;

    try {
      const found = await findPortalByPublicToken(token, admin.firestore());
      if (!found) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const { stored, tenantId } = found;

      // Synthesize the engine-shape AuditPortalConfig for checkAccess.
      const portalForCheck = {
        ...(stored as unknown as Parameters<typeof checkAccess>[0]),
        accessToken: token, // checkAccess compares request.token === portal.accessToken
      };
      const decision = checkAccess(
        portalForCheck as Parameters<typeof checkAccess>[0],
        { token, module: q.module, projectId: q.projectId },
        now,
      );

      if (!decision.allowed) {
        // Always 403 with no detail — prevents oracle on token state.
        // We still log the denial so admins can see access attempts on
        // expired / revoked / out-of-scope portals.
        try {
          const adapter = new AuditPortalAdapter(
            admin.firestore(),
            tenantId,
          );
          // Best-effort log; never block the response.
          // Mark with module=q.module and downloaded=false; payloadBytes=0.
          // We also include a sentinel `ip`/`userAgent` for the audit trail.
          // NOTE: even on deny we log — denied attempts are evidence too.
          await adapter.appendAccessLog({
            portalId: stored.id,
            accessedAt: now.toISOString(),
            module: q.module,
            downloaded: false,
            payloadBytes: 0,
            ip,
            userAgent,
          });
        } catch (logErr) {
          logger.warn?.('externalAuditPortal.public.deny_log_failed', {
            err: String(logErr),
          });
        }
        return res.status(403).json({ error: 'forbidden' });
      }

      // Allowed — append access log (this is the audit-trail row that proves
      // the auditor saw module X at time Y).
      try {
        const adapter = new AuditPortalAdapter(
          admin.firestore(),
          tenantId,
        );
        await adapter.appendAccessLog({
          portalId: stored.id,
          accessedAt: now.toISOString(),
          module: q.module,
          downloaded,
          ip,
          userAgent,
        });
      } catch (logErr) {
        // Don't block the auditor's read because of a logging hiccup — log
        // the failure and continue. Sentry will surface the pattern if it
        // becomes systemic.
        logger.warn?.('externalAuditPortal.public.allow_log_failed', {
          err: String(logErr),
        });
      }

      // Return a portal view stripped of any sensitive admin fields. The
      // auditor only needs: scope, expiresAt, auditorName (so the watermark
      // can show "Audit assigned to: Ana Fiscalizadora — SUSESO").
      const publicView = {
        portalId: stored.id,
        auditorName: stored.auditorName,
        auditorAffiliation: stored.auditorAffiliation,
        expiresAt: stored.expiresAt,
        scopeModules: stored.scopeModules,
        scopeProjectIds: stored.scopeProjectIds,
        // The caller will follow up with module-specific data fetches; we
        // return the access decision so the auditor's client knows to render
        // the module pane.
        module: q.module,
        projectId: q.projectId,
        tenantId,
      };
      return res.json({ portal: publicView });
    } catch (err) {
      logger.error?.('externalAuditPortal.public.error', err);
      captureRouteError(err, 'externalAuditPortal.public', {
        tokenPrefix: token.slice(0, 8),
      });
      // Stay opaque on unexpected errors too — never leak token state.
      return res.status(403).json({ error: 'forbidden' });
    }
  },
);

export default router;

// Praeventio Guard — Bucket CC: B2D admin endpoints (Sprint 23).
//
// Admin-gated CRUD over Bucket BB's `b2d_api_keys` collection plus
// the revenue-metrics + audit-event reads that back the admin panel
// (`src/pages/B2dAdminPanel.tsx`).
//
// Mounted at `/api/admin/b2d` from `server.ts` after `/api/admin`
// (admin.ts) so the same admin-role gate semantics apply. The
// `assertAdmin` helper duplicates the pattern used in `admin.ts`
// (`assertAdminCaller`) — kept local to avoid coupling the two
// files; if the predicate diverges we want it to diverge per route.
//
// PATHS:
//   GET  /api/admin/b2d/keys[?customerId=X]   list (masked)
//   POST /api/admin/b2d/keys                  create — returns rawKey ONCE
//   POST /api/admin/b2d/keys/:id/revoke       revoke
//   GET  /api/admin/b2d/metrics               { mrr, arr, ... }
//   GET  /api/admin/b2d/events?from=&to=      audit-style event log
//
// Bucket BB owns the actual key-issuance / hashing service
// (services/b2d/apiKeyService.ts). This file calls into BB directly for
// create/revoke and reads the persisted docs for the list endpoint.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { isAdminRole } from '../../types/roles.js';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { computeB2dMetrics } from '../../services/analytics/b2dMetrics.js';
import { API_TIERS, type ApiTierId } from '../../services/pricing/aiTier.js';
// Bucket BB shipped — we depend on the canonical key service directly.
import {
  createApiKey,
  revokeApiKey,
  type B2dScope,
} from '../../services/b2d/apiKeyService.js';

const router = Router();

/**
 * Sentry coverage helper — Fase D.13.a (batch 2).
 */
function captureRouteError(
  err: unknown,
  endpoint: string,
  extra: Record<string, string | number | boolean | null | undefined> = {},
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      { endpoint, ...extra } as Record<string, string | number | boolean | null | undefined>,
    );
  } catch (e) {
    logger.warn?.('observability.capture_failed', { err: String(e) });
  }
}

const VALID_TIER_IDS: ReadonlySet<string> = new Set(API_TIERS.map((t) => t.id));
const CUSTOMER_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;
const KEY_DOC_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

async function assertAdmin(req: any, res: any): Promise<boolean> {
  const callerUid = req.user?.uid;
  if (!callerUid) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      res.status(403).json({ error: 'Forbidden: Requires admin role' });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('b2d_admin_assert_failed', error, { callerUid });
    captureRouteError(error, 'b2dAdmin.assert_admin', { callerUid });
    res.status(500).json({ error: 'Internal server error' });
    return false;
  }
}

// Closed scope vocabulary lives in services/b2d/apiKeyService.ts. We mirror
// it here so input validation can reject unknown scopes before reaching
// the service layer (which would also reject, but later).
const VALID_SCOPES: ReadonlySet<B2dScope> = new Set<B2dScope>([
  'climate.read',
  'climate.forecast',
  'hazmat.calculate',
  'normativa.search',
  'normativa.validate',
  'suite.all',
]);


// ---------------------------------------------------------------------------
// GET /api/admin/b2d/keys[?customerId=X]
// ---------------------------------------------------------------------------
router.get('/keys', verifyAuth, async (req, res) => {
  if (!(await assertAdmin(req, res))) return;
  const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : null;
  if (customerId !== null && !CUSTOMER_ID_REGEX.test(customerId)) {
    return res.status(400).json({ error: 'Invalid customerId' });
  }
  try {
    let q: FirebaseFirestore.Query = admin.firestore().collection('b2d_api_keys');
    if (customerId) q = q.where('customerId', '==', customerId);
    const snap = await q.get();
    const keys: any[] = [];
    snap.forEach((doc) => {
      const d = doc.data();
      // Bucket BB writes `keyPrefix` (first 12 chars), not a maskedKey.
      // Synthesize a display string here so the panel doesn't have to
      // care which writer landed the doc.
      const keyPrefix = typeof d.keyPrefix === 'string' ? d.keyPrefix : null;
      const maskedKey = keyPrefix ? `${keyPrefix}…` : (typeof d.maskedKey === 'string' ? d.maskedKey : null);
      keys.push({
        id: doc.id,
        customerId: d.customerId,
        tier: d.tier,
        scopes: Array.isArray(d.scopes) ? d.scopes : [],
        status: d.status === 'revoked' || d.status === 'expired' ? d.status : 'active',
        maskedKey,
        createdAt: typeof d.createdAt === 'number' ? d.createdAt : null,
        revokedAt: typeof d.revokedAt === 'number' ? d.revokedAt : null,
        expiresAt: typeof d.expiresAt === 'number' ? d.expiresAt : null,
        lastUsedAt: typeof d.lastUsedAt === 'number' ? d.lastUsedAt : null,
      });
    });
    res.json({ ok: true, keys });
  } catch (error) {
    logger.error('b2d_admin_keys_list_failed', error);
    captureRouteError(error, 'b2dAdmin.keys_list');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/b2d/keys     { customerId, tier, scopes, expiresInDays? }
// Returns rawKey EXACTLY ONCE — caller must store/show it then.
// ---------------------------------------------------------------------------
router.post('/keys', verifyAuth, async (req, res) => {
  if (!(await assertAdmin(req, res))) return;
  const callerUid = (req as any).user.uid;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const customerId = typeof body.customerId === 'string' ? body.customerId : '';
  const tier = typeof body.tier === 'string' ? body.tier : '';
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is string => typeof s === 'string').slice(0, 32)
    : [];
  const expiresInDays = typeof body.expiresInDays === 'number' && body.expiresInDays > 0
    ? Math.min(body.expiresInDays, 3650)
    : undefined;

  if (!CUSTOMER_ID_REGEX.test(customerId)) {
    return res.status(400).json({ error: 'Invalid customerId' });
  }
  if (!VALID_TIER_IDS.has(tier)) {
    return res.status(400).json({ error: 'Invalid tier' });
  }
  if (scopes.length === 0) {
    return res.status(400).json({ error: 'At least one scope is required' });
  }
  for (const s of scopes) {
    if (!VALID_SCOPES.has(s as B2dScope)) {
      return res.status(400).json({ error: `Invalid scope: ${s}` });
    }
  }

  try {
    const { key: rawKey, record } = await createApiKey({
      customerId,
      tier: tier as ApiTierId,
      scopes: scopes as B2dScope[],
      expiresInDays,
    });
    const id = record.id;
    const maskedKey = `${record.keyPrefix}…`;

    // Audit log + event log (the admin panel reads `b2d_events`).
    await admin.firestore().collection('audit_logs').add({
      actor: callerUid,
      action: 'b2d_key_created',
      target: id,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
      tier,
      customerId,
    });
    await admin.firestore().collection('b2d_events').add({
      kind: 'key_created',
      keyId: id,
      customerId,
      tier,
      actor: callerUid,
      ts: Date.now(),
    });

    res.json({ ok: true, id, rawKey, maskedKey });
  } catch (error) {
    logger.error('b2d_admin_keys_create_failed', error, { callerUid });
    captureRouteError(error, 'b2dAdmin.keys_create', { callerUid });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/b2d/keys/:id/revoke
// ---------------------------------------------------------------------------
router.post('/keys/:id/revoke', verifyAuth, async (req, res) => {
  if (!(await assertAdmin(req, res))) return;
  const callerUid = (req as any).user.uid;
  const id = req.params.id;
  if (!KEY_DOC_ID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid key id' });
  }

  try {
    await revokeApiKey(id, callerUid);

    await admin.firestore().collection('audit_logs').add({
      actor: callerUid,
      action: 'b2d_key_revoked',
      target: id,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
    });
    await admin.firestore().collection('b2d_events').add({
      kind: 'key_revoked',
      keyId: id,
      actor: callerUid,
      ts: Date.now(),
    });

    res.json({ ok: true, id });
  } catch (error) {
    logger.error('b2d_admin_keys_revoke_failed', error, { callerUid, id });
    captureRouteError(error, 'b2dAdmin.keys_revoke', { callerUid, id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/b2d/metrics
// ---------------------------------------------------------------------------
router.get('/metrics', verifyAuth, async (req, res) => {
  if (!(await assertAdmin(req, res))) return;
  try {
    const metrics = await computeB2dMetrics();
    res.json({ ok: true, metrics });
  } catch (error) {
    logger.error('b2d_admin_metrics_failed', error);
    captureRouteError(error, 'b2dAdmin.metrics');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/b2d/events?from=&to=
// `from` / `to` are epoch ms; both optional. Defaults: last 30 days.
// ---------------------------------------------------------------------------
router.get('/events', verifyAuth, async (req, res) => {
  if (!(await assertAdmin(req, res))) return;
  const now = Date.now();
  const fromRaw = typeof req.query.from === 'string' ? parseInt(req.query.from, 10) : NaN;
  const toRaw = typeof req.query.to === 'string' ? parseInt(req.query.to, 10) : NaN;
  const from = Number.isFinite(fromRaw) ? fromRaw : now - 30 * 24 * 60 * 60 * 1000;
  const to = Number.isFinite(toRaw) ? toRaw : now;
  if (from > to) {
    return res.status(400).json({ error: 'from must be <= to' });
  }
  try {
    const snap = await admin.firestore()
      .collection('b2d_events')
      .where('ts', '>=', from)
      .where('ts', '<=', to)
      .orderBy('ts', 'desc')
      .limit(500)
      .get();
    const events: any[] = [];
    snap.forEach((doc) => {
      const d = doc.data();
      events.push({
        id: doc.id,
        kind: typeof d.kind === 'string' ? d.kind : 'unknown',
        keyId: typeof d.keyId === 'string' ? d.keyId : null,
        customerId: typeof d.customerId === 'string' ? d.customerId : null,
        tier: typeof d.tier === 'string' ? d.tier : null,
        actor: typeof d.actor === 'string' ? d.actor : null,
        ts: typeof d.ts === 'number' ? d.ts : null,
      });
    });
    res.json({ ok: true, from, to, events });
  } catch (error) {
    // The composite range+order query needs an index; surface a clean
    // empty result if the index isn't built yet rather than a 500.
    logger.error('b2d_admin_events_failed', error);
    captureRouteError(error, 'b2dAdmin.events');
    res.json({ ok: true, from, to, events: [] });
  }
});

export default router;

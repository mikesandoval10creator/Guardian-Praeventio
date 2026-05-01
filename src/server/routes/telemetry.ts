// Praeventio Guard — Round 19 R2 Phase 4 split.
//
// IoT telemetry ingestion + per-tenant secret rotation. Both endpoints
// extracted from server.ts:
//   • POST /api/telemetry/ingest          — gateway / device webhook.
//     Authenticates via per-tenant HMAC-SHA256 over the RFC 8785 canonical
//     body (header `x-iot-signature: sha256=<hex>`) when a tenant scope is
//     supplied (header `x-tenant-id` or body `tenantId`), falling back to
//     the legacy shared `IOT_WEBHOOK_SECRET` env var when no per-tenant
//     secret is registered. Auto-validates with the AI safety engine and
//     stamps the row into `telemetry_events`.
//   • POST /api/admin/iot/rotate-secret   — admin-only operator path that
//     mints a fresh 32-byte hex secret, persists it on `tenants/{id}.iotSecret`
//     with a `iotSecretRotatedAt` server timestamp, audits the rotation,
//     and echoes the raw secret back EXACTLY ONCE in the response body.
//     This is the only surface that ever exposes the secret in clear.
//
// Round 18 R6 reminder: signing input is the RFC 8785 canonical-JSON form
// of the parsed body, NOT `JSON.stringify(req.body)`. Producers in any
// language MUST canonicalise before HMACing or signatures will diverge.
// `LEGACY_HMAC_FALLBACK=1` honors the old contract for emergency rollback;
// each match logs `telemetry_hmac_legacy_fallback` so operators can chase
// the migration to completion.
//
// Mounted via `app.use('/api', telemetryRouter)`. The router declares the
// full `/telemetry/ingest` and `/admin/iot/rotate-secret` suffixes so the
// final on-the-wire paths stay byte-identical with what server.ts shipped
// through R18.

import { Router } from 'express';
import admin from 'firebase-admin';
import crypto from 'crypto';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { safeSecretEqual } from '../middleware/safeSecretEqual.js';
import { canonicalize } from '../middleware/canonicalBody.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { isAdminRole } from '../../types/roles.js';
import { logger } from '../../utils/logger.js';
import { autoValidateTelemetry } from '../../services/safetyEngineBackend.js';

// Aligned with the frontend type union in src/pages/Telemetry.tsx +
// Evacuation.tsx ('wearable' | 'machinery'). 'iot', 'environmental',
// 'machine' are reserved for gateway-originated telemetry. Keep this in
// sync if the frontend union changes.
const IOT_TYPE_ALLOWLIST = new Set([
  'iot',
  'wearable',
  'machinery',
  'environmental',
  'machine',
]);

/**
 * Round 17 R1 — Look up a tenant's per-tenant IoT secret. Returns null when
 * the tenant doc is missing, the field is absent, or anything throws —
 * never crashes the request path. Caller falls back to env secret.
 */
async function lookupTenantIotSecret(tenantId: string): Promise<string | null> {
  try {
    const snap = await admin.firestore().collection('tenants').doc(tenantId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const secret = data.iotSecret;
    if (typeof secret !== 'string' || secret.length === 0) return null;
    return secret;
  } catch (err: any) {
    logger.warn('telemetry_tenant_lookup_failed', { tenantId, message: err?.message });
    return null;
  }
}

const router = Router();

router.post('/telemetry/ingest', async (req, res) => {
  const { type, source, metric, value, unit, status, projectId } = req.body ?? {};

  // Per-tenant scope: header takes precedence over body (header is set by
  // gateways; body is set by mobile-edge devices that can't override hdrs).
  const headerTenantId = req.header('x-tenant-id');
  const bodyTenantId = (req.body ?? {}).tenantId;
  const tenantId =
    typeof headerTenantId === 'string' && headerTenantId.length > 0
      ? headerTenantId
      : typeof bodyTenantId === 'string' && bodyTenantId.length > 0
        ? bodyTenantId
        : null;

  const envSecret = process.env.IOT_WEBHOOK_SECRET;
  let perTenantSecret: string | null = null;
  if (tenantId) {
    perTenantSecret = await lookupTenantIotSecret(tenantId);
    if (!perTenantSecret) {
      logger.warn('telemetry_no_per_tenant_secret', { tenantId });
    }
  }

  // Decide which auth path we're on. Per-tenant: HMAC-SHA256 over the
  // RFC 8785 canonical-JSON form of the request body, header
  // `x-iot-signature: sha256=<hex>`. Env fallback: legacy x-iot-secret
  // header (or deprecated body.secretKey).
  //
  // Round 18 R6 (R6→R17 MEDIUM #2): the signing input is now the RFC 8785
  // canonical-JSON form of the parsed body (sorted keys, no whitespace,
  // shortest numeric form). Producers in any language MUST canonicalise
  // before HMACing or signatures will diverge. This is the documented,
  // intentional break of the prior `JSON.stringify(req.body)` contract —
  // see src/server/middleware/canonicalBody.ts for the rationale and the
  // LEGACY_HMAC_FALLBACK flag is honored below for emergency rollback.
  let authenticated = false;
  if (perTenantSecret) {
    const sigHeader = req.header('x-iot-signature') ?? '';
    const canonicalBody = canonicalize(req.body ?? {});
    const expectedHex = crypto
      .createHmac('sha256', perTenantSecret)
      .update(canonicalBody)
      .digest('hex');
    const expectedHeader = `sha256=${expectedHex}`;
    if (safeSecretEqual(sigHeader, expectedHeader)) {
      authenticated = true;
    } else if (process.env.LEGACY_HMAC_FALLBACK === '1') {
      // DEPRECATED — emergency rollback path. Producer is still sending
      // legacy `JSON.stringify(req.body)` HMACs. Verify under the old
      // contract; log every match so operators can see who is still on
      // the legacy path. Remove once telemetry shows zero hits.
      const legacyHex = crypto
        .createHmac('sha256', perTenantSecret)
        .update(JSON.stringify(req.body ?? {}))
        .digest('hex');
      if (safeSecretEqual(sigHeader, `sha256=${legacyHex}`)) {
        logger.warn('telemetry_hmac_legacy_fallback', { tenantId });
        authenticated = true;
      }
    }
  }

  if (!authenticated) {
    if (!envSecret) {
      logger.error('iot_webhook_misconfigured', undefined, {
        reason: 'IOT_WEBHOOK_SECRET not set and no per-tenant secret matched',
      });
      return res.status(500).json({ error: 'Server configuration error' });
    }
    let secretKey: unknown = req.header('x-iot-secret');
    if (typeof secretKey !== 'string' || secretKey.length === 0) {
      // Backwards-compat: accept body field for one release. DEPRECATED.
      if (typeof req.body?.secretKey === 'string' && req.body.secretKey.length > 0) {
        secretKey = req.body.secretKey;
        logger.warn('iot_webhook_secret_in_body_deprecated', {
          source: typeof source === 'string' ? source : 'unknown',
          hint: 'Move shared secret to X-IoT-Secret header; body field removed next release.',
        });
      } else {
        return res.status(401).json({ error: 'Unauthorized: Invalid secret key' });
      }
    }
    if (!safeSecretEqual(secretKey as string, envSecret)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid secret key' });
    }
    authenticated = true;
  }

  if (!type || !source || !metric || value === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Conservative input validation before any DB write.
  if (typeof type !== 'string' || !IOT_TYPE_ALLOWLIST.has(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }
  if (typeof source !== 'string' || source.length === 0 || source.length > 64) {
    return res.status(400).json({ error: 'Invalid source' });
  }
  if (typeof metric !== 'string' || metric.length === 0 || metric.length > 64) {
    return res.status(400).json({ error: 'Invalid metric' });
  }

  try {
    const db = admin.firestore();

    // Auto-validate with AI backend
    const validation = await autoValidateTelemetry({ type, source, metric, value, unit, status });
    const finalStatus = validation?.isAnomalous ? 'alert' : status || 'normal';
    const threatLevel = validation?.threatLevel || 'None';

    await db.collection('telemetry_events').add({
      type,
      source,
      metric,
      value: Number(value),
      unit: unit || '',
      status: finalStatus,
      threatLevel,
      aiValidation: validation,
      projectId: projectId || 'global',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      message: 'Telemetry event ingested successfully',
      aiValidation: validation,
    });
  } catch (error) {
    logger.error('iot_ingest_failed', error, { type, source, metric });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Round 17 R1 — IoT secret rotation. Admin-only. Generates a new 32-byte
// hex secret, stores it on `tenants/{tenantId}.iotSecret` along with a
// `iotSecretRotatedAt` server timestamp, audits the rotation, and returns
// the raw secret in the response body. THIS IS THE ONLY OPPORTUNITY for the
// operator to see the raw secret — subsequent reads of the tenant doc never
// echo it back through any user-facing surface.
//
// Note: this endpoint is intentionally not under /api/admin (which is the
// pre-existing `adminRouter` mount with its own surface). It lives at
// /api/admin/iot/rotate-secret directly so that mounting order is
// preserved and the body parser/limits already on /api/ apply.
router.post('/admin/iot/rotate-secret', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { tenantId } = req.body ?? {};
  if (typeof tenantId !== 'string' || tenantId.length === 0 || tenantId.length > 128) {
    return res.status(400).json({ error: 'Invalid tenantId' });
  }
  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res.status(403).json({ error: 'Forbidden: Requires admin role' });
    }
    const newSecret = crypto.randomBytes(32).toString('hex');
    await admin.firestore().collection('tenants').doc(tenantId).set(
      {
        iotSecret: newSecret,
        iotSecretRotatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    try {
      await auditServerEvent(req, 'admin.iot.secret_rotated', 'admin', {
        tenantId,
      });
    } catch {
      /* observability never breaks request path */
    }
    // ONLY response surface that ever exposes the raw secret. Caller MUST
    // copy it now — it cannot be read back from Firestore via any non-admin
    // path, and even admin reads should be discouraged.
    return res.json({ secret: newSecret });
  } catch (error: any) {
    logger.error('admin_iot_rotate_failed', { callerUid, tenantId, message: error?.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

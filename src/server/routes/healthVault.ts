// SPDX-License-Identifier: MIT
// Legacy HealthVault share management. Clinical reads use authenticated
// professional sessions; retired bearer URLs only return rejection responses.

import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { verifyAuth } from '../middleware/verifyAuth.js';
import {
  createShareToken,
  revokeShareToken,
  buildAuditEntry,
  VaultShareError,
  type VaultShareToken,
  type VaultShareScope,
} from '../../services/health/vaultShare.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';

import { getFirestore } from 'firebase-admin/firestore';

function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}

const router = Router();

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Rate limiter para el endpoint público /view/:id/:secret.
//
// Defiende contra brute-force de secrets (aunque cada secret tiene ~24
// bytes URL-safe, ~144 bits de entropía — el limiter sólo es defensa
// secundaria). 30 req/min/IP siguiendo el patrón de refereeLimiter.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const healthVaultViewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});
const MAX_TTL_HOURS = 168; // 1 semana
const MIN_TTL_HOURS = 1;

async function loadShareDoc(
  workerUid: string,
  tokenId: string,
): Promise<VaultShareToken | null> {
  const snap = await getFirestore()
    .collection('users')
    .doc(workerUid)
    .collection('health_vault_shares')
    .doc(tokenId)
    .get();
  if (!snap.exists) return null;
  return snap.data() as VaultShareToken;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/health-vault/share — el worker genera un share token.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/share', verifyAuth, async (req, res) => {
  const callerUid: string | undefined = req.user?.uid;
  if (!callerUid) return res.status(401).json({ error: 'unauthorized' });

  const { scope, topic, recordIds, ttlHours } = req.body ?? {};
  const validScopes: VaultShareScope[] = ['full', 'recent', 'topic'];
  if (!scope || !validScopes.includes(scope)) {
    return res.status(400).json({ error: 'invalid_scope' });
  }
  if (scope === 'topic' && (!topic || typeof topic !== 'string')) {
    return res.status(400).json({ error: 'topic_required' });
  }
  if (
    ttlHours !== undefined &&
    (typeof ttlHours !== 'number' || ttlHours < MIN_TTL_HOURS || ttlHours > MAX_TTL_HOURS)
  ) {
    return res
      .status(400)
      .json({ error: 'invalid_ttl', minHours: MIN_TTL_HOURS, maxHours: MAX_TTL_HOURS });
  }
  if (
    recordIds !== undefined &&
    (!Array.isArray(recordIds) || recordIds.some((id) => typeof id !== 'string'))
  ) {
    return res.status(400).json({ error: 'invalid_recordIds' });
  }

  try {
    const { record, secret, qrPayload } = createShareToken({
      workerUid: callerUid,
      scope,
      topic,
      recordIds,
      ttlHours,
    });

    await getFirestore()
      .collection('users')
      .doc(callerUid)
      .collection('health_vault_shares')
      .doc(record.id)
      .set(record);

    await getFirestore().collection('audit_logs').add({
      ...buildAuditEntry('health_vault.share.created', record),
      userId: callerUid,
    });

    return res.status(201).json({
      tokenId: record.id,
      secret,
      qrPayload,
      expiresAt: record.expiresAt,
    });
  } catch (err) {
    if (err instanceof VaultShareError) {
      return res.status(400).json({ error: err.code });
    }
    logger.error('health_vault_share_create_failed', err);
    sentryCapture(err, { endpoint: '/api/health-vault/share', tags: { method: 'POST' } });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Retired view URL: reject it without resolving a token or clinical data.
// SECURITY MIGRATION: bearer-only v1 links are retained for owner listing and
// revocation, but can no longer reveal clinical data. The v2 router mounted
// before this legacy router handles authenticated professional sessions.
router.get('/view/:tokenId/:secret', healthVaultViewLimiter, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(410).json({
    error: 'legacy_share_reissue_required',
    message:
      'Este enlace antiguo ya no puede mostrar datos médicos. Pide al paciente que genere un acceso seguro nuevo para tu identidad profesional.',
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Retired file URL: reject it without reading a record or storage blob.
router.get(
  '/view/:tokenId/:secret/file/:recordId',
  healthVaultViewLimiter,
  (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.status(410).json({
      error: 'legacy_share_reissue_required',
      message:
        'Este archivo pertenecía a un enlace antiguo. Pide al paciente que genere un acceso seguro nuevo.',
    });
  },
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/health-vault/share/:tokenId/revoke — el worker revoca.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/share/:tokenId/revoke', verifyAuth, async (req, res) => {
  const callerUid: string | undefined = req.user?.uid;
  if (!callerUid) return res.status(401).json({ error: 'unauthorized' });

  const { tokenId } = req.params;
  if (!tokenId) return res.status(400).json({ error: 'invalid_request' });

  try {
    const record = await loadShareDoc(callerUid, tokenId);
    if (!record) return res.status(404).json({ error: 'not_found' });
    if (record.workerUid !== callerUid) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { patch } = revokeShareToken(record, callerUid);

    await getFirestore()
      .collection('users')
      .doc(callerUid)
      .collection('health_vault_shares')
      .doc(tokenId)
      .update(patch);

    const updated: VaultShareToken = { ...record, ...patch };
    await getFirestore().collection('audit_logs').add({
      ...buildAuditEntry('health_vault.share.revoked', updated),
      userId: callerUid,
    });

    return res.status(200).json({ ok: true, revokedAt: patch.revokedAt });
  } catch (err) {
    logger.error('health_vault_revoke_failed', err);
    sentryCapture(err, { endpoint: '/api/health-vault/share/:tokenId/revoke', tags: { method: 'POST', uid: callerUid } });
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;

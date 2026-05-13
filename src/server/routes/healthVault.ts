// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV â€” HealthVault QR sharing endpoints.
//
// El trabajador es DUEÃ‘O ABSOLUTO de su cartera mÃ©dica. Estos endpoints
// generan / consumen / revocan share tokens que un mÃ©dico tratante usa
// (al escanear el QR) para ver lectura por un tiempo acotado. Praeventio
// NUNCA diagnostica â€” sÃ³lo organiza la informaciÃ³n para que el mÃ©dico
// tome la mejor decisiÃ³n clÃ­nica.
//
// Cumple Ley 20.584 (paciente controla quiÃ©n accede), Ley 21.719 (datos
// personales), Ley 16.744 (registro de exÃ¡menes ocupacionales).
//
// Endpoints:
//   POST   /api/health-vault/share              (auth required â€” worker)
//   GET    /api/health-vault/view/:id/:secret   (PUBLIC â€” mÃ©dico que escanea)
//   POST   /api/health-vault/share/:id/revoke   (auth required â€” worker dueÃ±o)
//
// Mounted en server.ts AFTER helmet, BEFORE /api/* global rate-limit
// para que el view pÃºblico use su propio limiter.

import { Router } from 'express';
import { createHash } from 'node:crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import {
  createShareToken,
  consumeShareToken,
  revokeShareToken,
  buildAuditEntry,
  VaultShareError,
  type VaultShareToken,
  type VaultShareScope,
} from '../../services/health/vaultShare.js';
import {
  getHealthRecords,
  getHealthRecordsByIds,
  getRecentHealthRecords,
  type HealthRecord,
} from '../../services/health/vaultRecord.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';

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
// Rate limiter para el endpoint pÃºblico /view/:id/:secret.
//
// Defiende contra brute-force de secrets (aunque cada secret tiene ~24
// bytes URL-safe, ~144 bits de entropÃ­a â€” el limiter sÃ³lo es defensa
// secundaria). 30 req/min/IP siguiendo el patrÃ³n de refereeLimiter.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const healthVaultViewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

const RECENT_DAYS_BACK = 90;
const MAX_TTL_HOURS = 168; // 1 semana
const MIN_TTL_HOURS = 1;

function hashIp(ip: string | undefined): string {
  if (!ip) return '';
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

async function loadShareDoc(
  workerUid: string,
  tokenId: string,
): Promise<VaultShareToken | null> {
  const snap = await admin
    .firestore()
    .collection('users')
    .doc(workerUid)
    .collection('health_vault_shares')
    .doc(tokenId)
    .get();
  if (!snap.exists) return null;
  return snap.data() as VaultShareToken;
}

/**
 * El record en /view/:id/:secret no conoce de antemano el workerUid;
 * para no exponer un Ã­ndice global escaneamos via collectionGroup.
 * Firestore indexa collectionGroup automÃ¡ticamente para queries de
 * igualdad sobre IDs simples cuando lo registramos en firestore.indexes.json.
 */
async function findShareById(tokenId: string): Promise<VaultShareToken | null> {
  const snap = await admin
    .firestore()
    .collectionGroup('health_vault_shares')
    .where('id', '==', tokenId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data() as VaultShareToken;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/health-vault/share â€” el worker genera un share token.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/share', verifyAuth, async (req, res) => {
  const callerUid: string = req.user?.uid;
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

    await admin
      .firestore()
      .collection('users')
      .doc(callerUid)
      .collection('health_vault_shares')
      .doc(record.id)
      .set(record);

    await admin.firestore().collection('audit_logs').add({
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
// GET /api/health-vault/view/:tokenId/:secret â€” mÃ©dico escanea QR.
//
// PÃšBLICO (sin verifyAuth). SÃ³lo el secret + tokenId dan acceso. El
// limiter por IP cubre brute-force.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get(
  '/view/:tokenId/:secret',
  healthVaultViewLimiter,
  async (req, res) => {
    const { tokenId, secret } = req.params;
    if (!tokenId || !secret) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    try {
      const record = await findShareById(tokenId);
      if (!record) {
        return res.status(404).json({ error: 'invalid' });
      }

      let result;
      try {
        result = consumeShareToken(record, secret, {
          name: 'AnÃ³nimo (vÃ­a QR)',
          ipHash: hashIp(req.ip),
        });
      } catch (err) {
        if (err instanceof VaultShareError) {
          // 410 Gone para expired/revoked/max â€” el link existiÃ³ pero
          // ya no sirve.
          const httpStatus =
            err.code === 'invalid_token' ? 401 : err.code === 'malformed' ? 400 : 410;
          return res.status(httpStatus).json({ error: err.code });
        }
        throw err;
      }

      // Persistir incremento de consumeCount + audit
      await admin
        .firestore()
        .collection('users')
        .doc(record.workerUid)
        .collection('health_vault_shares')
        .doc(record.id)
        .update(result.patch);

      const updated: VaultShareToken = { ...record, ...result.patch };
      await admin.firestore().collection('audit_logs').add({
        ...buildAuditEntry('health_vault.share.consumed', updated, {
          ipHash: hashIp(req.ip),
        }),
        userId: record.workerUid,
      });

      // Cargar records visibles segÃºn scope
      let records: HealthRecord[] = [];
      if (result.recordIdsToReveal === 'all') {
        if (record.scope === 'recent') {
          records = await getRecentHealthRecords(record.workerUid, RECENT_DAYS_BACK);
        } else {
          records = await getHealthRecords(record.workerUid);
        }
      } else if (Array.isArray(result.recordIdsToReveal)) {
        records = await getHealthRecordsByIds(
          record.workerUid,
          result.recordIdsToReveal,
        );
      }

      // Cargar nombre del trabajador (sin exponer email / claims)
      let workerName = 'Trabajador';
      try {
        const userDoc = await admin
          .firestore()
          .collection('users')
          .doc(record.workerUid)
          .get();
        const data = userDoc.data();
        if (data?.displayName && typeof data.displayName === 'string') {
          workerName = data.displayName;
        }
      } catch {
        // soft-fail: si no hay perfil, mantenemos genÃ©rico
      }

      // Orden uploadedAt desc para el viewer
      records.sort((a, b) => b.uploadedAt - a.uploadedAt);

      return res.status(200).json({
        workerName,
        records,
        topicHint: result.topicHint,
        expiresAt: record.expiresAt,
      });
    } catch (err) {
      logger.error('health_vault_view_failed', err);
      sentryCapture(err, { endpoint: '/api/health-vault/view/:tokenId/:secret', tags: { method: 'GET' } });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/health-vault/share/:tokenId/revoke â€” el worker revoca.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/share/:tokenId/revoke', verifyAuth, async (req, res) => {
  const callerUid: string = req.user?.uid;
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

    await admin
      .firestore()
      .collection('users')
      .doc(callerUid)
      .collection('health_vault_shares')
      .doc(tokenId)
      .update(patch);

    const updated: VaultShareToken = { ...record, ...patch };
    await admin.firestore().collection('audit_logs').add({
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

// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV — HealthVault QR sharing endpoints.
//
// El trabajador es DUEÑO ABSOLUTO de su cartera médica. Estos endpoints
// generan / consumen / revocan share tokens que un médico tratante usa
// (al escanear el QR) para ver lectura por un tiempo acotado. Praeventio
// NUNCA diagnostica — sólo organiza la información para que el médico
// tome la mejor decisión clínica.
//
// Cumple Ley 20.584 (paciente controla quién accede), Ley 21.719 (datos
// personales), Ley 16.744 (registro de exámenes ocupacionales).
//
// Endpoints:
//   POST   /api/health-vault/share              (auth required — worker)
//   GET    /api/health-vault/view/:id/:secret   (PUBLIC — médico que escanea)
//   POST   /api/health-vault/share/:id/revoke   (auth required — worker dueño)
//
// Mounted en server.ts AFTER helmet, BEFORE /api/* global rate-limit
// para que el view público use su propio limiter.

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

const router = Router();

// ─────────────────────────────────────────────────────────────────────
// Rate limiter para el endpoint público /view/:id/:secret.
//
// Defiende contra brute-force de secrets (aunque cada secret tiene ~24
// bytes URL-safe, ~144 bits de entropía — el limiter sólo es defensa
// secundaria). 30 req/min/IP siguiendo el patrón de refereeLimiter.
// ─────────────────────────────────────────────────────────────────────
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
 * para no exponer un índice global escaneamos via collectionGroup.
 * Firestore indexa collectionGroup automáticamente para queries de
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

// ─────────────────────────────────────────────────────────────────────
// POST /api/health-vault/share — el worker genera un share token.
// ─────────────────────────────────────────────────────────────────────
router.post('/share', verifyAuth, async (req, res) => {
  const callerUid: string = (req as any).user?.uid;
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
    console.error('[healthVault] share create failed', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/health-vault/view/:tokenId/:secret — médico escanea QR.
//
// PÚBLICO (sin verifyAuth). Sólo el secret + tokenId dan acceso. El
// limiter por IP cubre brute-force.
// ─────────────────────────────────────────────────────────────────────
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
          name: 'Anónimo (vía QR)',
          ipHash: hashIp(req.ip),
        });
      } catch (err) {
        if (err instanceof VaultShareError) {
          // 410 Gone para expired/revoked/max — el link existió pero
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

      // Cargar records visibles según scope
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
        // soft-fail: si no hay perfil, mantenemos genérico
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
      console.error('[healthVault] view failed', err);
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// POST /api/health-vault/share/:tokenId/revoke — el worker revoca.
// ─────────────────────────────────────────────────────────────────────
router.post('/share/:tokenId/revoke', verifyAuth, async (req, res) => {
  const callerUid: string = (req as any).user?.uid;
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
    console.error('[healthVault] revoke failed', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;

// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV — HealthVault QR sharing endpoints.
//
// El trabajador es DUEÃ‘O ABSOLUTO de su cartera médica. Estos endpoints
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
  validateShareAccess,
  recordIdInShareScope,
  buildAuditEntry,
  VaultShareError,
  type VaultShareToken,
  type VaultShareScope,
} from '../../services/health/vaultShare.js';
import {
  getHealthRecords,
  getHealthRecordsByIds,
  getRecentHealthRecords,
  getHealthRecordById,
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
// GET /api/health-vault/view/:tokenId/:secret — médico escanea QR.
//
// PÃšBLICO (sin verifyAuth). Sólo el secret + tokenId dan acceso. El
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

      const shareRef = admin
        .firestore()
        .collection('users')
        .doc(record.workerUid)
        .collection('health_vault_shares')
        .doc(record.id);

      // CLAUDE.md #19: the maxViews/expiry check (consumeShareToken) and the
      // consumeCount increment must be atomic. findShareById uses a
      // collectionGroup query (not transactional) only to locate workerUid+id;
      // the enforcement re-reads + re-validates the share doc INSIDE the
      // transaction on FRESH data, so two concurrent scans can't both pass the
      // view limit on the last allowed view (TOCTOU).
      let result;
      try {
        result = await admin.firestore().runTransaction(async (txn) => {
          const snap = await txn.get(shareRef);
          if (!snap.exists) {
            throw new VaultShareError('Token not found', 'invalid_token');
          }
          const fresh = snap.data() as VaultShareToken;
          const consumed = consumeShareToken(fresh, secret, {
            name: 'Anónimo (vía QR)',
            ipHash: hashIp(req.ip),
          });
          txn.update(shareRef, consumed.patch);
          return consumed;
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

      // SECURITY: nunca enviamos el fileUri crudo al navegador del médico —
      // una URL directamente fetcheable sobreviviría a la revocación. Lo
      // reemplazamos por un path mediado por el server que re-valida el share
      // (revokedAt/expiry/secret/scope) en CADA acceso al archivo.
      const safeRecords = records.map((r) => {
        const { fileUri, ...rest } = r;
        const hasFile = typeof fileUri === 'string' && fileUri.length > 0;
        return {
          ...rest,
          fileProxyPath: hasFile
            ? `/api/health-vault/view/${encodeURIComponent(tokenId)}/${encodeURIComponent(secret)}/file/${encodeURIComponent(r.id)}`
            : undefined,
        };
      });

      return res.status(200).json({
        workerName,
        records: safeRecords,
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
// GET /api/health-vault/view/:tokenId/:secret/file/:recordId
//
// PÚBLICO (sin verifyAuth, igual que /view — el médico no tiene cuenta).
// Sirve el archivo (blob) de UN record dentro del scope del share. Re-valida
// el share (revoked/expired/secret) sobre datos FRESCOS y transaccionales en
// CADA fetch, por lo que un share revocado/expirado NUNCA entrega el archivo
// y la URL no sobrevive a la revocación. NO consume una unidad de maxConsumes
// (un viewer con N archivos no debe gastar N vistas). Reusa healthVaultViewLimiter.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get(
  '/view/:tokenId/:secret/file/:recordId',
  healthVaultViewLimiter,
  async (req, res) => {
    const { tokenId, secret, recordId } = req.params;
    if (!tokenId || !secret || !recordId) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    try {
      const located = await findShareById(tokenId);
      if (!located) {
        return res.status(404).json({ error: 'invalid' });
      }

      const shareRef = admin
        .firestore()
        .collection('users')
        .doc(located.workerUid)
        .collection('health_vault_shares')
        .doc(located.id);

      // CLAUDE.md #19: re-read + re-validate el share DENTRO de una
      // transacción sobre datos FRESCOS, para que la revocación se aplique
      // por cada acceso a archivo (TOCTOU-safe). No hay write aquí -> no
      // consume vista; sólo necesitamos una lectura consistente.
      let fresh: VaultShareToken;
      try {
        fresh = await admin.firestore().runTransaction(async (txn) => {
          const snap = await txn.get(shareRef);
          if (!snap.exists) {
            throw new VaultShareError('Token not found', 'invalid_token');
          }
          const data = snap.data() as VaultShareToken;
          validateShareAccess(data, secret);
          return data;
        });
      } catch (err) {
        if (err instanceof VaultShareError) {
          const httpStatus =
            err.code === 'invalid_token' ? 401 : err.code === 'malformed' ? 400 : 410;
          return res.status(httpStatus).json({ error: err.code });
        }
        throw err;
      }

      const record = await getHealthRecordById(fresh.workerUid, recordId);
      if (!record) {
        return res.status(404).json({ error: 'file_unavailable' });
      }
      if (
        !recordIdInShareScope(fresh, recordId, {
          recordUploadedAt: record.uploadedAt,
          recentDaysBack: RECENT_DAYS_BACK,
        })
      ) {
        return res.status(403).json({ error: 'out_of_scope' });
      }
      if (typeof record.fileUri !== 'string' || record.fileUri.length === 0) {
        return res.status(404).json({ error: 'file_unavailable' });
      }

      // Audit ANTES de servir, para que un acceso que pasó la validación
      // deje siempre rastro (CLAUDE.md #14: awaited, no bloqueante si falla).
      try {
        await admin.firestore().collection('audit_logs').add({
          ...buildAuditEntry('health_vault.share.file_accessed', fresh, {
            recordId,
            ipHash: hashIp(req.ip),
          }),
          userId: fresh.workerUid,
        });
      } catch (auditErr) {
        logger.error('health_vault_file_audit_failed', auditErr);
        sentryCapture(auditErr, {
          endpoint: '/api/health-vault/view/:tokenId/:secret/file/:recordId',
          trigger: 'audit',
        });
        // no bloqueante: continuamos sirviendo el archivo (CLAUDE.md #14)
      }

      // Stream del blob server-side. record.fileUri es el path del objeto en
      // Storage (admin SDK bypassa storage.rules por diseño — la validación
      // del share de arriba ES el control de acceso).
      const bucket = admin.storage().bucket();
      const objectPath = record.fileUri.replace(/^gs:\/\/[^/]+\//, '');
      const fileHandle = bucket.file(objectPath);
      const [exists] = await fileHandle.exists();
      if (!exists) {
        return res.status(404).json({ error: 'file_unavailable' });
      }
      const [metadata] = await fileHandle.getMetadata();
      if (metadata.contentType) res.setHeader('Content-Type', metadata.contentType);
      // Defensa en profundidad: un share revocado no debe quedar cacheado.
      res.setHeader('Cache-Control', 'no-store, private, max-age=0');
      res.setHeader('Content-Disposition', 'inline');

      await new Promise<void>((resolve, reject) => {
        fileHandle
          .createReadStream()
          .on('error', reject)
          .on('end', resolve)
          .pipe(res);
      });
      return;
    } catch (err) {
      logger.error('health_vault_file_failed', err);
      sentryCapture(err, {
        endpoint: '/api/health-vault/view/:tokenId/:secret/file/:recordId',
        tags: { method: 'GET' },
      });
      if (!res.headersSent) {
        return res.status(500).json({ error: 'internal_error' });
      }
      return res.end();
    }
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

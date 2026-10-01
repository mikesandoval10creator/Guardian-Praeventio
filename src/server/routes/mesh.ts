// SPDX-License-Identifier: MIT
//
// GET /api/mesh/key?projectId=  — per-project mesh signing key distribution.
//
// SECURITY / TRUST ROOT:
//   The mesh relay (BLE/WiFi-Direct) signs life-safety SOS packets with a
//   PER-PROJECT HMAC-SHA-256 key so offline peers can verify authenticity
//   without a live network. This endpoint is the ONLY way a device obtains
//   that key, and it is gated by:
//     • verifyAuth (Firebase ID token)
//     • assertProjectMember(uid, projectId, db) — only members of the project
//       get the project key. An outsider cannot obtain it, so they cannot forge
//       a packet that same-project peers accept.
//   Life-safety (CLAUDE.md #11): NOT tier-gated — every member, every tier.
//
//   The key is minted lazily on first request (runTransaction, CLAUDE.md #19 —
//   one get + one set on the same doc) with crypto.randomBytes(32) (NOT
//   Math.random, CLAUDE.md #15) and stored in Firestore mesh_keys/{projectId}.
//   Clients NEVER read this collection directly (firestore.rules deny) — that
//   would leak the project secret to a member's browser. Rotation = bump keyId.

import { Router } from 'express';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { assertProjectMember } from '../../services/auth/projectMembership.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { logger } from '../../utils/logger.js';

import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const QuerySchema = z.object({
  projectId: z.string().min(1).max(128),
});

function isCanonicalMeshSigningKey(value: string): boolean {
  const rawKey = Buffer.from(value, 'base64');
  return rawKey.length === 32 && rawKey.toString('base64') === value;
}

const MeshKeyDocumentSchema = z.object({
  keyId: z.string().min(1),
  key: z.string().refine(isCanonicalMeshSigningKey, {
    message: 'key must be canonical Base64 for a 256-bit HMAC key',
  }),
});

const router = Router();

router.get('/key', verifyAuth, validate(QuerySchema, 'query'), async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.validated as z.infer<typeof QuerySchema>;
  const db = getFirestore();

  // Only project members may obtain the project mesh key. (We pass no decoded
  // token: assertProjectMember resolves membership from Firestore projects/{id},
  // the authoritative source — the claim fast-path is a pure optimization.)
  try {
    await assertProjectMember(callerUid, projectId, db);
  } catch {
    return res.status(403).json({ error: 'Forbidden: not a project member' });
  }

  try {
    const ref = db.collection('mesh_keys').doc(projectId);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const parsed = MeshKeyDocumentSchema.safeParse(snap.data());
        if (!parsed.success) {
          throw new Error('mesh_key_document_invalid');
        }
        return parsed.data;
      }
      // Mint a fresh 256-bit key on first access.
      const keyId = `${projectId}:v1`;
      const key = randomBytes(32).toString('base64');
      tx.set(ref, {
        projectId,
        keyId,
        key,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
      });
      return { keyId, key };
    });

    try {
      await auditServerEvent(req, 'mesh.key.fetch', 'mesh', { keyId: result.keyId }, { projectId });
    } catch (err) {
      logger.error('audit_event_failed', {
        action: 'mesh.key.fetch',
        message: (err as Error)?.message,
      });
    }

    return res.json({ keyId: result.keyId, key: result.key });
  } catch (err) {
    captureRouteError(err, 'mesh.key.fetch', { callerUid, projectId });
    return res.status(500).json({ error: 'mesh_key_fetch_failed' });
  }
});

export default router;

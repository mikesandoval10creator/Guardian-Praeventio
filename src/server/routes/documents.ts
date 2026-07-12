// Praeventio Guard — Bloque E4: audited project document writes.
//
// Client SDK writes to projects/{projectId}/documents persisted compliance
// metadata without audit_logs. This router moves the write behind verifyAuth +
// project membership and stamps identity from the verified token. It does not
// call any external API: document metadata, including possible PII already in
// the user's payload, is stored only in Firestore.

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { logger } from '../../utils/logger.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

const router = Router();

const documentStatusSchema = z.enum([
  'Vigente',
  'Vencido',
  'Pendiente',
  'Borrador',
  'Archivado',
]);

const documentSchema = z.object({
  name: z.string().trim().min(1).max(300),
  type: z.string().trim().min(1).max(64).optional(),
  url: z.string().trim().url().max(4096).optional(),
  category: z.string().trim().min(1).max(160).optional(),
  status: documentStatusSchema.default('Vigente'),
  version: z.string().trim().min(1).max(64).optional(),
  size: z.number().int().nonnegative().max(500_000_000).optional(),
  uploadDate: z.string().trim().min(10).max(80).optional(),
  uploadedBy: z.string().trim().min(1).max(200).optional(),
  content: z.unknown().optional(),
  isGenerated: z.boolean().optional(),
});

router.post(
  '/:projectId/documents',
  verifyAuth,
  validate(documentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof documentSchema>;

    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());

      const docRef = await admin
        .firestore()
        .collection('projects')
        .doc(projectId)
        .collection('documents')
        .add({
          ...body,
          projectId,
          createdBy: callerUid,
          updatedBy: callerUid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // CLAUDE.md #3/#14: project-document creation is state-changing and must
      // be audited. Audit failure is severe and captured, but does not roll back
      // the successful document metadata write.
      try {
        await auditServerEvent(
          req,
          'documents.create',
          'documents',
          {
            projectId,
            documentId: docRef.id,
            category: body.category ?? null,
            status: body.status,
          },
          { projectId },
        );
      } catch (auditErr) {
        logger.error('audit_event_failed', {
          action: 'documents.create',
          projectId,
          documentId: docRef.id,
          err: auditErr instanceof Error ? auditErr.message : String(auditErr),
        });
        captureRouteError(auditErr, 'documents.create.audit', {
          projectId,
          documentId: docRef.id,
          callerUid,
        });
      }

      return res.status(201).json({ success: true, documentId: docRef.id });
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      logger.error('documents.create.error', {
        projectId,
        uid: callerUid,
        err: err instanceof Error ? err.message : String(err),
      });
      captureRouteError(err, 'documents.create', { projectId, callerUid });
      return res.status(500).json({
        error:
          process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err instanceof Error
              ? err.message
              : 'Internal server error',
      });
    }
  },
);

export default router;

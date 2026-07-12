// Praeventio Guard — Safety Posts HTTP surface.
//
// Migrates the mural/safety_posts write path from direct client Firestore
// writes to a server-side audited endpoint. The client previously called
// `addDoc(collection(db, 'projects/{id}/safety_posts'), ...)` directly;
// now it calls this endpoint which:
//   1. Verifies auth (verifyAuth middleware)
//   2. Validates the payload (Zod)
//   3. Asserts project membership (assertProjectMember)
//   4. Runs server-side content moderation (defense-in-depth)
//   5. Writes via Admin SDK (bypasses firestore.rules — server is authoritative)
//   6. Stamps audit_log with the caller's verified identity
//
// Endpoint:
//   POST /:projectId/safety-posts                       — STATEFUL
//     body: { content, type, imageUrl? }
//     201:  { postId, createdAt }
//     400:  { error: 'invalid_payload', issues }
//     400:  { error: 'moderation_blocked', code, reason }
//     403:  { error: 'forbidden' }
//     404:  { error: 'project_not_found' }
//
// Reads (listing posts) remain client-side via Firestore SDK — they are
// read-only and governed by firestore.rules. Only mutations are server-gated.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { moderatePostContent } from '../../utils/contentModeration.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

const POST_TYPES = ['SafetyMoment', 'Tip', 'SuccessStory', 'Warning'] as const;

const createPostSchema = z.object({
  content: z.string().min(1).max(5000),
  type: z.enum(POST_TYPES),
  imageUrl: z.string().url().optional(),
});

// ────────────────────────────────────────────────────────────────────────
// POST /:projectId/safety-posts — create a safety post
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/safety-posts',
  verifyAuth,
  validate(createPostSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email ?? null;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof createPostSchema>;

    // 1. Assert project membership
    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      logger.error?.('safetyPosts.create.membership.error', err);
      captureRouteError(err, 'safetyPosts.create.membership', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }

    // 2. Server-side content moderation (defense-in-depth; client also moderates)
    const moderation = moderatePostContent(body.content);
    if (!moderation.ok) {
      return res.status(400).json({
        error: 'moderation_blocked',
        code: moderation.code,
        reason: moderation.reason,
      });
    }

    // 3. Resolve caller display name from Firestore user doc
    let userName = 'Usuario';
    let userPhoto = '';
    try {
      const userDoc = await admin.firestore().collection('users').doc(callerUid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        userName = userData?.displayName || userData?.email || 'Usuario';
        userPhoto = userData?.photoURL || '';
      }
    } catch (err) {
      // Non-fatal — we proceed with defaults
      logger.warn?.('safetyPosts.create.userLookup.failed', { callerUid, err: String(err) });
    }

    // 4. Write to Firestore via Admin SDK
    const postsPath = `projects/${projectId}/safety_posts`;
    try {
      const docRef = await admin.firestore().collection(postsPath).add({
        userId: callerUid,
        userName,
        userPhoto,
        content: body.content.trim(),
        type: body.type,
        imageUrl: body.imageUrl || null,
        likes: [],
        comments: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        projectId,
      });

      // 5. Audit log (awaited per CLAUDE.md §14)
      try {
        await auditServerEvent(
          req,
          'safetyPosts.create',
          'safetyPosts',
          {
            postId: docRef.id,
            projectId,
            type: body.type,
            contentLength: body.content.trim().length,
            hasImage: Boolean(body.imageUrl),
          },
          { projectId },
        );
      } catch (auditErr) {
        logger.error?.('safetyPosts.create.audit_failed', auditErr);
        captureRouteError(auditErr, 'safetyPosts.create.audit', { callerUid, projectId });
      }

      return res.status(201).json({
        postId: docRef.id,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error?.('safetyPosts.create.error', err);
      captureRouteError(err, 'safetyPosts.create', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;

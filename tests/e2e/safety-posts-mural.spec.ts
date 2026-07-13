import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken, buildE2EAuthHeader } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Safety Posts Mural E2E — audited write path.
 *
 * Validates the migration from direct client Firestore writes to the
 * server-side audited endpoint (`POST /api/sprint-k/:projectId/safety-posts`).
 *
 * Two-pronged test:
 *   A. API-level: POST to the endpoint directly, verify 201 + audit_log in Firestore.
 *   B. UI-level: navigate to /mural, submit a post, verify it appears in the feed.
 *
 * Requires the full stack. Run via `npm run test:e2e:full:chromium`.
 */

const USER = {
  uid: 'e2e-safety-posts-user',
  email: 'safety-posts@praeventio.test',
  displayName: 'Safety Posts E2E',
};

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        'safety-posts-mural.spec: FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:e2e:full`.',
      );
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('Safety Posts — mural audited write', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('API: POST /api/sprint-k/:projectId/safety-posts escribe post + audit_log', async ({ request }) => {
    // This test exercises the endpoint directly via HTTP (server-side auth via E2E header).
    const seed = await seedProject({ supervisorUid: USER.uid });
    const db = emulatorDb();

    try {
      const e2eSecret = process.env.E2E_TEST_SECRET ?? 'e2e-test-secret-do-not-use-in-prod';
      const authHeader = buildE2EAuthHeader(e2eSecret, USER.uid);

      const res = await request.post(
        `http://localhost:3000/api/sprint-k/${seed.projectId}/safety-posts`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          data: {
            content: 'Usar casco en zona de altura es obligatorio',
            type: 'SafetyMoment',
          },
        },
      );

      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.postId).toBeDefined();
      expect(body.createdAt).toBeDefined();

      // Verify the Firestore doc was written by the server via Admin SDK.
      const postsSnap = await db
        .collection(`projects/${seed.projectId}/safety_posts`)
        .get();
      expect(postsSnap.size).toBe(1);

      const postDoc = postsSnap.docs[0];
      expect(postDoc.data().content).toBe('Usar casco en zona de altura es obligatorio');
      expect(postDoc.data().type).toBe('SafetyMoment');
      expect(postDoc.data().userId).toBe(USER.uid);
      // userName comes from users/{uid} doc; may be 'Usuario' if the doc
      // wasn't pre-seeded (API-only test path). The important invariant is
      // that the field is server-stamped, NOT client-supplied.
      expect(postDoc.data().userName).toBeDefined();
      expect(postDoc.data().projectId).toBe(seed.projectId);
      expect(postDoc.data().likes).toEqual([]);
      expect(postDoc.data().comments).toEqual([]);

      // Verify the audit_log was written.
      const auditSnap = await db
        .collection('audit_logs')
        .where('action', '==', 'safetyPosts.create')
        .get();
      expect(auditSnap.size).toBeGreaterThanOrEqual(1);
      const auditDoc = auditSnap.docs.find(
        (d) => d.data().details?.postId === postDoc.id,
      );
      expect(auditDoc).toBeDefined();
      expect(auditDoc!.data().userId).toBe(USER.uid);
      expect(auditDoc!.data().details?.projectId).toBe(seed.projectId);
      expect(auditDoc!.data().details?.type).toBe('SafetyMoment');
    } finally {
      await seed.cleanup();
    }
  });

  test('UI: mural page loads and post via API appears in feed via onSnapshot', async ({ page, request }) => {
    // Exercise the mural page load + verify a server-written post appears in the client feed.
    await loginAsTestUser(page, USER);
    const seed = await seedProject({ supervisorUid: USER.uid });

    try {
      // First, create a post via the API directly.
      const e2eSecret = process.env.E2E_TEST_SECRET ?? 'e2e-test-secret-do-not-use-in-prod';
      const authHeader = buildE2EAuthHeader(e2eSecret, USER.uid);
      const postContent = 'Usar arnes en trabajos de altura mayor a dos metros';

      const apiRes = await request.post(
        `http://localhost:3000/api/sprint-k/${seed.projectId}/safety-posts`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          data: { content: postContent, type: 'Warning' },
        },
      );
      expect(apiRes.status()).toBe(201);

      // Navigate to the mural page — the onSnapshot listener should pick up the post.
      await page.goto('/mural');
      await signInBrowserViaCustomToken(page);

      // The post should appear in the feed via the real-time listener.
      await expect(page.getByText(postContent)).toBeVisible({ timeout: 20_000 });
    } finally {
      await seed.cleanup();
    }
  });
});

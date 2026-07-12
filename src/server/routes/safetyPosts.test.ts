// Praeventio Guard — safetyPosts router behavioral tests (real router + supertest).
//
// Covers the safety-posts surface end-to-end against an in-memory Firestore fake:
//   - POST create: 401 / 400 (validation) / 400 (moderation) / 403 / 201 (+ audit_log)
//
// Audit-log invariant: the POST writes to audit_logs via auditServerEvent.
// Content moderation: server-side defense-in-depth rejects harassment/spam.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore
  > | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@example.com`,
      role: req.header('x-test-role') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

const auditCalls: unknown[][] = [];
vi.mock('../middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn((...args: unknown[]) => {
    auditCalls.push(args);
    return Promise.resolve(true);
  }),
}));

import safetyPostsRouter from './safetyPosts.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', safetyPostsRouter);
  return app;
}

const PROJECT_ID = 'p-safety-posts-test';
const MEMBER_UID = 'uid-sp-member';
const NON_MEMBER_UID = 'uid-sp-stranger';
const TENANT_ID = 't-sp-1';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Safety Posts Test Project',
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
  // Seed user doc for display name resolution
  db._seed(`users/${MEMBER_UID}`, {
    uid: MEMBER_UID,
    displayName: 'Test Worker',
    email: 'worker@test.com',
    photoURL: 'https://example.com/photo.jpg',
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
  auditCalls.length = 0;
});

// ── POST /:projectId/safety-posts ──────────────────────────────────────

describe('POST /:projectId/safety-posts', () => {
  const URL = `/api/sprint-k/${PROJECT_ID}/safety-posts`;

  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp())
      .post(URL)
      .send({ content: 'Test post', type: 'Tip' });

    expect(res.status).toBe(401);
  });

  it('400 when content is missing', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ type: 'Tip' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when type is invalid', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ content: 'Test post', type: 'InvalidType' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when content is empty string', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ content: '', type: 'Tip' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when content contains harassment terms (server-side moderation)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ content: 'Eres un weon terrible', type: 'Warning' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('moderation_blocked');
    expect(res.body.code).toBe('harassment');
  });

  it('400 when content contains spam patterns', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ content: 'Visita https://spam.example.com para mas info', type: 'Tip' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('moderation_blocked');
    expect(res.body.code).toBe('spam');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ content: 'Legitimate safety post content', type: 'Tip' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('201 on valid post creation + persists to Firestore + writes audit_log', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ content: 'Usar casco en zona de altura', type: 'SafetyMoment' });

    expect(res.status).toBe(201);
    expect(res.body.postId).toBeDefined();
    expect(typeof res.body.postId).toBe('string');
    expect(res.body.createdAt).toBeDefined();

    // Verify the post was persisted in Firestore
    const db = H.db!;
    const postsSnap = await db.collection(`projects/${PROJECT_ID}/safety_posts`).get();
    expect(postsSnap.size).toBe(1);
    const postData = postsSnap.docs[0]!.data()!;
    expect(postData.content).toBe('Usar casco en zona de altura');
    expect(postData.type).toBe('SafetyMoment');
    expect(postData.userId).toBe(MEMBER_UID);
    expect(postData.userName).toBe('Test Worker');
    expect(postData.projectId).toBe(PROJECT_ID);
    expect(postData.likes).toEqual([]);
    expect(postData.comments).toEqual([]);

    // Verify audit log was written
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0][1]).toBe('safetyPosts.create');
    expect(auditCalls[0][2]).toBe('safetyPosts');
    expect((auditCalls[0][3] as Record<string, unknown>).projectId).toBe(PROJECT_ID);
    expect((auditCalls[0][3] as Record<string, unknown>).type).toBe('SafetyMoment');
  });

  it('201 with optional imageUrl', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({
        content: 'Foto del area de trabajo',
        type: 'SuccessStory',
        imageUrl: 'https://storage.example.com/photo.jpg',
      });

    expect(res.status).toBe(201);

    const db = H.db!;
    const postsSnap = await db.collection(`projects/${PROJECT_ID}/safety_posts`).get();
    expect(postsSnap.docs[0]!.data()!.imageUrl).toBe('https://storage.example.com/photo.jpg');
    expect((auditCalls[0][3] as Record<string, unknown>).hasImage).toBe(true);
  });

  it('201 trims content whitespace', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ content: '  Contenido con espacios  ', type: 'Tip' });

    expect(res.status).toBe(201);

    const db = H.db!;
    const postsSnap = await db.collection(`projects/${PROJECT_ID}/safety_posts`).get();
    expect(postsSnap.docs[0]!.data()!.content).toBe('Contenido con espacios');
  });
});

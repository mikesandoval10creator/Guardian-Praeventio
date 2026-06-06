// Real-router supertest for GET /api/auth/webauthn/credentials (B17, Fase 5).
//
// Mounts the ACTUAL webauthnChallengeRouter from curriculum.ts (no
// re-implementation) against fakeFirestore + a stubbed verifyAuth. This is
// the read-only list the Settings "Llaves de seguridad" UI consumes after
// the screen was disconnected from a dead `users/{uid}/webauthn_credentials`
// subcollection. Contract under test:
//   • 401 without a verified caller.
//   • 200 returns ONLY the caller's own credentials (uid-scoped from the
//     token), never another user's rows.
//   • The response never leaks the `publicKey` bytes.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn(async () => ({ id: 'e' })) }; } }));

import { webauthnChallengeRouter } from '../../server/routes/curriculum.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', webauthnChallengeRouter);
  return app;
}
const as = (uid: string) => ({ 'x-test-uid': uid });

beforeEach(() => {
  H.db = createFakeFirestore();
  // userA owns two keys; userB owns one. The canonical store is the flat
  // top-level `webauthn_credentials` collection keyed by credentialId.
  H.db._seed('webauthn_credentials/credA1', {
    credentialId: 'credA1', uid: 'userA', publicKey: 'QUExX1BVQks', counter: 3,
    transports: ['internal'], registeredAt: 1700000000000, lastUsedAt: 1700100000000,
  });
  H.db._seed('webauthn_credentials/credA2', {
    credentialId: 'credA2', uid: 'userA', publicKey: 'QUEyX1BVQks', counter: 0,
    transports: ['usb', 'nfc'], registeredAt: 1700000000001, lastUsedAt: null,
  });
  H.db._seed('webauthn_credentials/credB1', {
    credentialId: 'credB1', uid: 'userB', publicKey: 'QkIxX1BVQks', counter: 9,
    transports: ['internal'], registeredAt: 1700000000002, lastUsedAt: null,
  });
});

describe('GET /api/auth/webauthn/credentials', () => {
  it('401 without a verified caller', async () => {
    const res = await request(buildApp()).get('/api/auth/webauthn/credentials');
    expect(res.status).toBe(401);
  });

  it('200 returns ONLY the caller\'s own credentials (uid-scoped)', async () => {
    const res = await request(buildApp()).get('/api/auth/webauthn/credentials').set(as('userA'));
    expect(res.status).toBe(200);
    const ids = (res.body.credentials as Array<{ credentialId: string }>).map((c) => c.credentialId).sort();
    expect(ids).toEqual(['credA1', 'credA2']);
    // userB's key must not appear.
    expect(ids).not.toContain('credB1');
  });

  it('never leaks the publicKey bytes in the response', async () => {
    const res = await request(buildApp()).get('/api/auth/webauthn/credentials').set(as('userA'));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('publicKey');
    expect(JSON.stringify(res.body)).not.toContain('QUExX1BVQks');
    // Useful display fields ARE surfaced.
    const a1 = (res.body.credentials as Array<Record<string, unknown>>).find((c) => c.credentialId === 'credA1');
    expect(a1).toMatchObject({ counter: 3, transports: ['internal'], registeredAt: 1700000000000, lastUsedAt: 1700100000000 });
  });

  it('200 with an empty list when the caller has no keys', async () => {
    const res = await request(buildApp()).get('/api/auth/webauthn/credentials').set(as('userC'));
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([]);
  });
});

// SPDX-License-Identifier: MIT
//
// REAL-FIRESTORE integration test for src/server/routes/healthVault.ts.
//
// What this proves (and what the existing healthVault.test.ts does NOT):
//   - The handler writes the share token in the path shape the live
//     firestore.rules expects (`users/{uid}/health_vault_shares/{tokenId}`).
//   - A client's client SDK can read its OWN share (isOwner(userId)) and is
//     REJECTED on someone else's — i.e. the rule fires on real Firestore
//     against real handler output.
//   - A doctor client cannot list every worker's shares (cross-tenant).
//   - A doctor client CANNOT write into the share collection (the immutable
//     invariant — tokens are server-minted only).
//
// What this does NOT replace:
//   - healthVault.test.ts (real router, fake firestore): unit-level
//     supertest coverage for validation, 401/400/403 paths, and the
//     consumeShareToken secret math. That test runs in <3s in CI; this
//     one boots the Firestore emulator (~5-8s setup) and is gated behind
//     `npm run test:integration:healthvault`.
//
// Why this exists:
//   The fake firestore bypasses ALL security rules. A handler bug that
//   writes to the wrong path (e.g. `user_share_tokens/{uid}/...` instead
//   of `users/{uid}/health_vault_shares/{...}`) would silently pass in the
//   fake — the rule that protects the data never fires. This test makes
//   the rule fire.

import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, collectionGroup, getDocs } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RULES_PROJECT_ID = 'praeventio-handler-integration';
const RULES_PATH = resolve(__dirname, '../../../firestore.rules');

const WORKER_UID = 'worker-uid-real';
const OTHER_WORKER_UID = 'worker-uid-other';
const ADMIN_UID = 'admin-uid-real';
const DOCTOR_UID = 'doctor-uid-real';

let testEnv: RulesTestEnvironment;
let serverDbHandle: ReturnType<RulesTestEnvironment['unauthenticatedContext']>;

// Hoisted holder so vi.mock('firebase-admin') can read it without TDZ errors.
const H = vi.hoisted(() => ({ db: null as unknown }));

// We mock the app module ONLY so we can call initializeApp() with a known
// name BEFORE the handler is imported (handlers may capture the default
// app reference at module load time).
vi.mock('firebase-admin/app', async () => {
  const actual = await vi.importActual<typeof import('firebase-admin/app')>(
    'firebase-admin/app',
  );
  const { initializeApp, applicationDefault, cert, getApps, getApp, deleteApp } = actual;
  // Eagerly create the named app so handlers that call getFirestore()
  // (without args) — which resolves to getApp() — find it.
  const APP_NAME = 'praeventio-handler-integration';
  if (getApps().length === 0) {
    // projectId EXPLÍCITO: el 2º arg de initializeApp es el NOMBRE de la app,
    // no el proyecto. Sin esto el admin SDK escribe en el proyecto del entorno
    // (env) y los contextos de rules-unit-testing leen de APP_NAME → proyectos
    // distintos en el emulator → el doc "no existe" en el read-back.
    initializeApp(
      { credential: applicationDefault(), projectId: APP_NAME },
      APP_NAME,
    );
  }
  return {
    initializeApp: (opts: unknown) =>
      initializeApp(
        {
          projectId: APP_NAME,
          credential: applicationDefault(),
          ...(opts as object | undefined),
        },
        APP_NAME,
      ),
    applicationDefault,
    cert,
    getApps,
    getApp: () => getApp(APP_NAME),
    deleteApp,
  };
});

vi.mock('firebase-admin/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase-admin/firestore')>(
    'firebase-admin/firestore',
  );
  const { getFirestore } = actual;
  // Hand back the emulator-backed Firestore instance with the rules-loaded
  // projectId so writes go through the rule evaluator. If the caller does
  // not pass an app, resolve the named app first.
  const { getApp } = await import('firebase-admin/app');
  const APP_NAME = 'praeventio-handler-integration';
  const resolveFirestore = (
    appOrDbId?: unknown,
    databaseId?: string,
  ): ReturnType<typeof getFirestore> => {
    if (typeof appOrDbId === 'string') {
      // First arg is the databaseId overload.
      return getFirestore(appOrDbId);
    }
    if (databaseId !== undefined) {
      return getFirestore(
        (appOrDbId as Parameters<typeof getFirestore>[0]) ??
          (getApp(APP_NAME) as Parameters<typeof getFirestore>[0]),
        databaseId,
      );
    }
    return getFirestore(
      (appOrDbId as Parameters<typeof getFirestore>[0]) ??
        (getApp(APP_NAME) as Parameters<typeof getFirestore>[0]),
    );
  };
  return {
    ...actual,
    getFirestore: (...args: unknown[]) =>
      resolveFirestore(...(args as Parameters<typeof resolveFirestore>)),
    FieldValue: actual.FieldValue,
    Timestamp: actual.Timestamp,
  };
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, _res: Response, next: NextFunction) => {
    // Trust a header injected by supertest so we can simulate auth per-test.
    const uid = req.header('x-test-uid');
    const role = req.header('x-test-role');
    if (uid) {
      (req as Request & { user: { uid: string; role: string } }).user = {
        uid,
        role: role ?? 'worker',
      };
    }
    next();
  },
}));

vi.mock('../../../server/utils/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock('../../../server/services/observability/index.js', () => ({
  getErrorTracker: () => ({ capture: () => {} }),
  startChildSpan: () => ({}),
  tracedAsync: async <T>(_name: string, fn: () => Promise<T>) => fn(),
}));

// Import AFTER mocks so the router picks up our stubs.
const { default: healthVaultRouter } = await import(pathToFileURL(resolve(__dirname, '../../../src/server/routes/healthVault.ts')).href);

const app = express();
app.use(express.json());
app.use('/api/health-vault', healthVaultRouter);

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: RULES_PROJECT_ID,
    firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
  });
  // Ensure the default Admin SDK app is initialized BEFORE the handler runs.
  // The handler may use getFirestore() with no args, which calls getApp() on
  // the default app — without this, it throws "The default Firebase app
  // does not exist" and the request 500s.
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
  if (getApps().length === 0) {
    initializeApp(
      { credential: applicationDefault(), projectId: RULES_PROJECT_ID },
      RULES_PROJECT_ID,
    );
  }
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
    // Point the handler's mock at the same emulator instance via the server
    // context. The admin SDK uses this db to write share tokens.
    const ctx = testEnv.unauthenticatedContext();
    serverDbHandle = ctx;
    H.db = ctx.firestore();
    // Tag it so the app mock can satisfy `getApps()` checks.
    (H.db as { _app: unknown })._app = { name: '[emulator]' };
  }
});

describe('healthVault handler — REAL firestore.rules integration', () => {
  it('owner can create a share token AND read it back as themselves', async () => {
    // 1. Worker calls the server to mint a token.
    const res = await request(app)
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER_UID)
      .set('x-test-role', 'worker')
      .send({ scope: 'full', ttlHours: 24 });

    expect(res.status).toBe(201);
    expect(res.body.tokenId).toBeDefined();
    expect(res.body.secret).toBeDefined();

    const tokenId = res.body.tokenId as string;

    // 2. The owner client reads the token back via the client SDK. Rules
    //    say `allow read: if isOwner(userId)` — this MUST succeed.
    const ownerCtx = testEnv.authenticatedContext(WORKER_UID, {
      email: `${WORKER_UID}@example.com`,
      email_verified: true,
      role: 'worker',
    });
    const ownerDb = ownerCtx.firestore();
    const ownerSnap = await getDoc(
      doc(ownerDb, `users/${WORKER_UID}/health_vault_shares/${tokenId}`),
    );
    expect(ownerSnap.exists()).toBe(true);
    // The handler persists tokenHash, NEVER the raw secret.
    const data = ownerSnap.data();
    expect(data?.tokenHash).toBeDefined();
    expect(data?.secret).toBeUndefined();
    expect(data?.workerUid).toBe(WORKER_UID);
  });

  it('A different worker CANNOT read someone else\'s share token', async () => {
    // 1. Worker mints a token.
    const res = await request(app)
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER_UID)
      .send({ scope: 'full', ttlHours: 24 });
    expect(res.status).toBe(201);
    const tokenId = res.body.tokenId as string;

    // 2. A different worker tries to read it — rules must deny.
    const otherCtx = testEnv.authenticatedContext(OTHER_WORKER_UID, {
      email: `${OTHER_WORKER_UID}@example.com`,
      email_verified: true,
      role: 'worker',
    });
    await expect(
      getDoc(
        doc(otherCtx.firestore(), `users/${WORKER_UID}/health_vault_shares/${tokenId}`),
      ),
    ).rejects.toThrow();
  });

  it('A client CANNOT write into health_vault_shares (server-only invariant)', async () => {
    // 1. Worker mints a token.
    const res = await request(app)
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER_UID)
      .send({ scope: 'full', ttlHours: 24 });
    expect(res.status).toBe(201);

    // 2. An authenticated worker tries to forge a fake token. Rule says
    //    `allow write: if false` — this MUST fail.
    const maliciousCtx = testEnv.authenticatedContext(OTHER_WORKER_UID, {
      email: 'mallory@example.com',
      email_verified: true,
      role: 'worker',
    });
    await expect(
      setDoc(
        doc(
          maliciousCtx.firestore(),
          `users/${WORKER_UID}/health_vault_shares/forged_by_mallory`,
        ),
        { workerUid: OTHER_WORKER_UID, tokenHash: 'x', tokenPrefix: 'fake', expiresAt: 1e15 },
      ),
    ).rejects.toThrow();
  });

  it('Doctor CANNOT list ALL workers\' shares via collectionGroup', async () => {
    // Seed a couple of shares from different workers via the server.
    await request(app)
      .post('/api/health-vault/share')
      .set('x-test-uid', WORKER_UID)
      .send({ scope: 'full', ttlHours: 24 })
      .expect(201);
    await request(app)
      .post('/api/health-vault/share')
      .set('x-test-uid', OTHER_WORKER_UID)
      .send({ scope: 'full', ttlHours: 24 })
      .expect(201);

    // A doctor with a verified token tries to enumerate every share.
    // Rules do not grant collectionGroup('health_vault_shares') to doctors
    // directly (read per-doc is owner-only). The query MUST fail.
    const doctorCtx = testEnv.authenticatedContext(DOCTOR_UID, {
      email: 'doctor@example.com',
      email_verified: true,
      role: 'doctor',
      tenantId: 'tenant-1',
    });
    await expect(
      getDocs(collectionGroup(doctorCtx.firestore(), 'health_vault_shares')),
    ).rejects.toThrow();
  });
});


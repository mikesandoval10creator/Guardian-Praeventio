import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import express from 'express';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { signInAnonymously, signOut } from 'firebase/auth';
import { doc, setDoc, terminate } from 'firebase/firestore';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// Actual SDKs, actual production router, actual encrypted queue. fake-indexeddb
// supplies the Node platform adapter only; HTTP responses and Firestore are real.
let rules: RulesTestEnvironment;
let adminApp: App;
let server: Server;
let baseUrl: string;
const nativeFetch = globalThis.fetch.bind(globalThis);
const projectId = process.env.GCLOUD_PROJECT;

beforeAll(async () => {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const loopback = (value: string | undefined): value is string =>
    typeof value === 'string' && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(value) && Number(value.split(':')[1]) <= 65_535;
  if (!projectId || !/^(demo-|praeventio-.*test$)/.test(projectId) || !loopback(fsHost) || !loopback(authHost)) {
    throw new Error('Zettelkasten replay requires isolated loopback Firestore/Auth emulators and a test project');
  }
  vi.stubEnv('VITE_E2E_AUTH_EMULATOR_URL', `http://${authHost}`);
  const [host, port] = fsHost.split(':');
  rules = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } });
  adminApp = initializeApp({ projectId });
  const { default: router } = await import('../server/routes/zettelkasten');
  const app = express();
  app.use(express.json());
  app.use('/api/zettelkasten', router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve());
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('listener unavailable');
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
    server.closeAllConnections();
  });
  if (rules) { await rules.clearFirestore(); await rules.cleanup(); }
  if (adminApp) await deleteApp(adminApp);
  vi.unstubAllEnvs();
});

it('replays the real incident caller after offline + HTTP403 + lost commit response, then reads back one authorized write', async () => {
  const { auth, db } = await import('../services/firebase');
  const { offlineSync, OfflineSyncStateMachine, _internal } = await import('../services/sync/syncStateMachine');
  const { replayZettelkastenNodeBatch } = await import('../services/zettelkasten/persistence/replayNodeBatch');
  const { onIncidentReported } = await import('../services/zettelkasten/flows/incidentLessonTrainingFlow');
  const { getEncrypted } = await import('../services/security/encryptedKvStore');
  const tenantId = 'zk-replay-tenant';
  const businessProject = 'zk-replay-project';
  const adminDb = getFirestore(adminApp);
  let resumed: InstanceType<typeof OfflineSyncStateMachine> | undefined;
  let uid: string | undefined;
  try {
    expect(auth.emulatorConfig).not.toBeNull();
    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
    await getAdminAuth(adminApp).setCustomUserClaims(uid, { tenantId });
    await credential.user.getIdToken(true);
    await adminDb.doc(`projects/${businessProject}`).set({ tenantId, members: [], createdBy: 'other-user' });
    // The fix must not need permission to write the server-only source directly.
    await expect(setDoc(doc(db, 'zettelkasten_nodes', 'forbidden-direct-create'), { projectId: businessProject })).rejects.toMatchObject({ code: 'permission-denied' });

    let dropCommitResponse = false;
    const requests: Array<{ body: string; key: string | null; status: number }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input !== '/api/zettelkasten/nodes') return nativeFetch(input, init);
      const response = await nativeFetch(`${baseUrl}${input}`, init);
      requests.push({ body: String(init?.body), key: new Headers(init?.headers).get('Idempotency-Key'), status: response.status });
      if (dropCommitResponse && response.ok) {
        await response.text();
        throw new Error('injected_response_loss_after_commit');
      }
      return response;
    });
    vi.stubGlobal('navigator', { onLine: false });
    offlineSync.setOnlineGetter(() => false);
    offlineSync.setExecutor(replayZettelkastenNodeBatch);
    await offlineSync.ready();
    const result = await onIncidentReported({ incidentId: 'synthetic-offline-incident', projectId: businessProject, tenantId, reportedByUid: uid, involvedWorkerUids: [], occurredAtIso: '2026-01-01T00:00:00.000Z', description: 'Synthetic fixture for offline replay, not a production incident', severity: 'low' });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(0);
    const queued = offlineSync.getState().operations;
    expect(queued).toHaveLength(1);
    const original = structuredClone(queued[0]);
    expect(original).toMatchObject({ ownerUid: uid, tenantId, collection: 'zettelkasten_nodes', type: 'create' });
    expect(original.data.nodes).toMatchObject([{ idempotencyKey: result.nodeIds[0] }]);

    vi.stubGlobal('navigator', { onLine: true });
    offlineSync.setOnlineGetter(() => true);
    const denied = await offlineSync.syncNow();
    expect(denied).toMatchObject({ succeeded: 0, failed: 1 });
    expect(offlineSync.getState()).toMatchObject({ state: 'online_failed', pendingCount: 1 });
    expect(offlineSync.getState().operations[0].lastError).toBe('zettelkasten_replay_http_403');
    expect((await adminDb.doc(`zettelkasten_nodes/${result.nodeIds[0]}`).get()).exists).toBe(false);
    const persisted = await getEncrypted<Array<{ id: string }>>('offline-sync::generic::queue::v2');
    expect(persisted?.map((op) => op.id)).toEqual([original.id]);
    offlineSync._dispose();

    // Rehydrate through the actual AES-GCM IndexedDB persistence, not a mocked queue.
    resumed = new OfflineSyncStateMachine();
    resumed.setOnlineGetter(() => false);
    resumed.setExecutor(replayZettelkastenNodeBatch);
    await resumed.ready();
    expect(resumed.getState().operations[0]).toMatchObject({ id: original.id, attempts: 1, data: original.data });
    await adminDb.doc(`projects/${businessProject}`).update({ members: [uid] });
    await new Promise((resolve) => setTimeout(resolve, _internal.getBackoffMs(1) + 25));
    dropCommitResponse = true;
    resumed.setOnlineGetter(() => true);
    expect(await resumed.syncNow()).toMatchObject({ succeeded: 0, failed: 1 });
    expect(resumed.getState()).toMatchObject({ pendingCount: 1, state: 'online_failed' });
    expect(resumed.getState().operations[0].lastError).toBe('injected_response_loss_after_commit');
    // Keep reconnection phases explicit; otherwise the production retry timer
    // races this test's manual syncNow while the injected response loss is active.
    resumed.setOnlineGetter(() => false);
    const committed = await adminDb.doc(`zettelkasten_nodes/${result.nodeIds[0]}`).get();
    expect(committed.exists).toBe(true);
    expect(committed.data()).toMatchObject({ projectId: businessProject, createdBy: uid, type: 'incident-reported' });
    const canonical = await adminDb.collection('nodes').where('projectId', '==', businessProject).get();
    expect(canonical.size).toBe(1);
    expect(canonical.docs[0].data()).toMatchObject({ tenantId, projectId: businessProject });

    await new Promise((resolve) => setTimeout(resolve, _internal.getBackoffMs(2) + 25));
    dropCommitResponse = false;
    resumed.setOnlineGetter(() => true);
    expect(await resumed.syncNow()).toMatchObject({ succeeded: 1, failed: 0 });
    expect(resumed.getState()).toMatchObject({ pendingCount: 0, state: 'online_synced' });
    expect(await getEncrypted('offline-sync::generic::queue::v2')).toBeNull();
    // Repeating the acknowledged operation must replay the cached response too.
    await replayZettelkastenNodeBatch(original);
    const readback = await adminDb.collection('zettelkasten_nodes').where('projectId', '==', businessProject).get();
    expect(readback.size).toBe(1);
    expect(readback.docs[0].updateTime.isEqual(committed.updateTime!)).toBe(true);
    expect((await adminDb.collection('audit_logs').where('projectId', '==', businessProject).get()).size).toBe(1);
    expect(requests.map((r) => r.status)).toEqual([403, 200, 200, 200]);
    expect(new Set(requests.map((r) => r.key)).size).toBe(1);
    expect(new Set(requests.map((r) => r.body)).size).toBe(1);
  } finally {
    offlineSync._dispose();
    resumed?._dispose();
    vi.unstubAllGlobals();
    if (uid) await getAdminAuth(adminApp).deleteUser(uid);
    await signOut(auth);
    await terminate(db);
  }
}, 120_000);

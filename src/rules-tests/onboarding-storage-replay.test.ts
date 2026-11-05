// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment, type RulesTestContext } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, listAll, type FirebaseStorage } from 'firebase/storage';
import { openDB } from 'idb';
import { verifiedToken } from './_harness';
const state = vi.hoisted(() => ({ getDb: undefined as (() => unknown) | undefined, getStorage: undefined as (() => unknown) | undefined, online: false, identity: { ownerUid: 'onboarding-supervisor', tenantId: 'onboarding-tenant', installationId: 'onboarding-installation', schemaVersion: 2 as const }, metadataFailure: false, uploads: 0, failures: 0, notifications: [] as unknown[] }));
vi.mock('../services/firebase', async () => {
  const api = await import('firebase/firestore');
  return { get db() { return state.getDb?.(); }, get storage() { return state.getStorage?.(); }, doc: api.doc, collection: api.collection, auth: { currentUser: null }, OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' }, handleFirestoreError: (error: unknown) => { throw error; } };
});
vi.mock('../services/sync/queueIdentity', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/sync/queueIdentity')>()), resolveCurrentQueueIdentity: async () => ({ ...state.identity }) }));
vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => state.online }));
vi.mock('../contexts/ProjectContext', () => ({ useProjectOptional: () => null }));
vi.mock('../contexts/NotificationContext', () => ({ useNotifications: () => ({ addNotification: (value: unknown) => state.notifications.push(value) }) }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const api = await importOriginal<typeof import('firebase/firestore')>();
  return { ...api, runTransaction: ((...args: Parameters<typeof api.runTransaction>) => {
    if (state.metadataFailure) { state.metadataFailure = false; state.failures++; throw new Error('injected_metadata_transport_failure'); }
    return api.runTransaction(...args);
  }) };
});
vi.mock('firebase/storage', async (importOriginal) => {
  const api = await importOriginal<typeof import('firebase/storage')>();
  return { ...api, uploadBytes: (async (...args: Parameters<typeof api.uploadBytes>) => {
    state.uploads++;
    // Node/JSDOM platform adapter only: preserve actual bytes and MIME while
    // passing a Uint8Array to the real SDK; never synthesize an HTTP response.
    const [target, data, metadata] = args;
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    return api.uploadBytes(target, bytes, metadata);
  }) };
});
let env: RulesTestEnvironment;
const PID = 'onboarding-live-project';
const WID = 'onboarding-live-worker';
const UID = 'onboarding-supervisor';
const tenantId = 'onboarding-tenant';
function dbOf(ctx: RulesTestContext) { return ctx.firestore() as unknown as Firestore; }
function storageOf(ctx: RulesTestContext) { return ctx.storage() as unknown as FirebaseStorage; }
function select(ctx: RulesTestContext, uid: string) {
  state.getDb = () => dbOf(ctx); state.getStorage = () => storageOf(ctx);
  state.identity = { ownerUid: uid, tenantId, installationId: 'onboarding-installation', schemaVersion: 2 };
}
function pngFixture() {
  function chunk(type: string, data: Buffer) {
    const label = Buffer.from(type); const body = Buffer.concat([label, data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
beforeAll(async () => {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
  const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  const safeHost = (host: string | undefined): host is string => typeof host === 'string' && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(host) && Number(host.split(':')[1]) <= 65535;
  if (!safeHost(fsHost) || !safeHost(storageHost)) throw new Error('Both loopback Firestore and Storage emulators are required; no skip or remote fallback');
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile);
  const [fh, fp] = fsHost.split(':'); const [sh, sp] = storageHost.split(':');
  env = await initializeTestEnvironment({ projectId: 'praeventio-rules-test', firestore: { host: fh, port: Number(fp), rules: await readFile('firestore.rules', 'utf8') }, storage: { host: sh, port: Number(sp), rules: await readFile('storage.rules', 'utf8') } });
  await env.clearFirestore(); await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(dbOf(ctx), 'projects', PID), { name: 'Fixture', createdBy: UID, members: [UID, 'onboarding-worker'], tenantId });
    await setDoc(doc(dbOf(ctx), 'users', UID), { role: 'supervisor', assignedSiteIds: [PID], tenantId });
    await setDoc(doc(dbOf(ctx), 'users', 'onboarding-worker'), { role: 'worker', assignedSiteIds: [PID], tenantId });
    await setDoc(doc(dbOf(ctx), 'projects', PID, 'workers', WID), { name: 'Same Name', role: 'Soldador', projectId: PID });
    await setDoc(doc(dbOf(ctx), 'projects', PID, 'workers', 'second-worker'), { name: 'Same Name', role: 'Soldador', projectId: PID });
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(pngFixture());
}, 120_000);
afterAll(async () => {
  cleanup();
  const { offlineSync } = await import('../services/sync/syncStateMachine'); offlineSync._dispose();
  if (env) { await env.clearFirestore(); await env.clearStorage(); await env.cleanup(); }
  vi.unstubAllGlobals();
});
it('runs the real modal/real PDF/IndexedDB queue/reconnect consumer and reads both services after a partial failure; ACLs stay closed', async () => {
  const actor = env.authenticatedContext(UID, verifiedToken('supervisor', 'fixture@example.invalid', { tenantId, assignedSiteIds: [PID] }));
  select(actor, UID);
  const { TacticalOnboardingModal } = await import('../components/workers/TacticalOnboardingModal');
  const { OfflineSyncManager } = await import('../components/OfflineSyncManager');
  const { getPendingActions } = await import('../utils/pwa-offline');
  const { replayOnboardingUpload } = await import('../services/workers/onboardingUpload');
  const savedWorker = await getDoc(doc(dbOf(actor), 'projects', PID, 'workers', WID));
  expect(savedWorker.exists()).toBe(true);
  await assertFails(setDoc(doc(dbOf(actor), 'documents', 'forbidden-root'), { projectId: PID, workerId: WID }));
  async function generate(workerId: string) {
    const worker = await getDoc(doc(dbOf(actor), 'projects', PID, 'workers', workerId));
    const data = worker.data(); if (!data) throw new Error('actual worker missing');
    const rendered = render(React.createElement(TacticalOnboardingModal, { isOpen: true, onClose: () => {}, workerData: { id: worker.id, projectId: PID, name: String(data.name), role: String(data.role) } }));
    fireEvent.click(screen.getByRole('button', { name: /proceder a firma/i }));
    fireEvent.click(screen.getByRole('button', { name: /firmar y generar/i }));
    await waitFor(() => expect(screen.getByText(/Onboarding Completado/)).toBeInTheDocument(), { timeout: 30_000 });
    rendered.unmount();
  }
  await generate(WID);
  expect(state.uploads).toBe(0);
  const originals = await getPendingActions(); expect(originals).toHaveLength(5);
  const binary = originals[0].file; if (!binary) throw new Error('real queued PDF absent');
  expect(new TextDecoder().decode(await binary.arrayBuffer()).startsWith('%PDF-')).toBe(true);
  for (const op of originals) {
    expect(op.collection).toBe(`projects/${PID}/workers/${WID}/documents`);
    expect(op.docId).toBeTruthy();
  }
  state.metadataFailure = true;
  state.online = true;
  const manager = render(React.createElement(OfflineSyncManager));
  await waitFor(async () => expect(await getPendingActions()).toHaveLength(1), { timeout: 30_000 });
  expect(state.failures).toBe(1);
  const visible = await getDocs(query(collection(dbOf(actor), 'projects', PID, 'workers', WID, 'documents'), where('archived', '==', false)));
  expect(visible.size).toBe(4);
  const [remaining] = await getPendingActions();
  const beforeRetry = await getBytes(ref(storageOf(actor), remaining.data.storagePath));
  expect(new Uint8Array(beforeRetry)).toEqual(new Uint8Array(await binary.arrayBuffer()));
  window.dispatchEvent(new CustomEvent('force-sync'));
  await waitFor(async () => expect(await getPendingActions()).toHaveLength(0), { timeout: 30_000 });
  const committed = await getDocs(query(collection(dbOf(actor), 'projects', PID, 'workers', WID, 'documents'), where('archived', '==', false)));
  expect(committed.size).toBe(5);
  const roots = await listAll(ref(storageOf(actor), `projects/${PID}/workers/${WID}/documents`));
  const objectGroups = await Promise.all(roots.prefixes.map((prefix) => listAll(prefix)));
  expect(objectGroups.flatMap((group) => group.items)).toHaveLength(5);
  const uploadsBeforeAck = state.uploads;
  await replayOnboardingUpload(remaining);
  expect(state.uploads).toBe(uploadsBeforeAck);
  const metadata = await getDoc(doc(dbOf(actor), remaining.collection, String(remaining.docId)));
  expect(metadata.data()).toMatchObject({ workerId: WID, projectId: PID, storagePath: remaining.data.storagePath });
  expect(metadata.data()).not.toHaveProperty('url');
  await setDoc(metadata.ref, { archived: true }, { merge: true });
  await replayOnboardingUpload(remaining);
  expect((await getDoc(metadata.ref)).data()?.archived).toBe(true);
  // Same display name must not replace the first worker's local PDF cache.
  // Keep the consumer mounted and already online: enqueue must wake it up.
  await generate('second-worker');
  await waitFor(async () => expect(await getPendingActions()).toHaveLength(0), { timeout: 30_000 });
  const secondDocuments = await getDocs(query(collection(dbOf(actor), 'projects', PID, 'workers', 'second-worker', 'documents'), where('archived', '==', false)));
  expect(secondDocuments.size).toBe(5);
  manager.unmount();
  const database = await openDB('praeventio-offline', 3);
  const bunker = await database.getAll('bunker-knowledge');
  expect(bunker).toHaveLength(10); expect(new Set(bunker.map((row) => row.id)).size).toBe(10);
  database.close();

  function deniedAction(uid: string) {
    const id = `denied-${uid}`; const path = `projects/${PID}/workers/${WID}/documents/${id}/${id}.pdf`;
    return { ...remaining, docId: id, queueIdentity: { ...state.identity, ownerUid: uid }, data: { ...remaining.data, storagePath: path, documentData: { ...remaining.data.documentData, createdBy: uid, name: `${id}.pdf`, storagePath: path } } };
  }
  const workerCtx = env.authenticatedContext('onboarding-worker', verifiedToken('worker', 'worker@example.invalid', { tenantId, assignedSiteIds: [PID] }));
  select(workerCtx, 'onboarding-worker');
  await expect(replayOnboardingUpload(deniedAction('onboarding-worker'))).rejects.toMatchObject({ code: 'storage/unauthorized' });
  // The existing Firestore policy deliberately grants tenant-wide supervisor
  // metadata access. Test a genuinely foreign tenant here; Storage separately
  // rejects a supervisor without the project's assignedSiteIds claim.
  const outsider = env.authenticatedContext('outsider', verifiedToken('supervisor', 'other@example.invalid', { tenantId: 'different-tenant', assignedSiteIds: ['different-project'] }));
  select(outsider, 'outsider');
  await assertFails(uploadBytes(ref(storageOf(outsider), `projects/${PID}/workers/${WID}/documents/outsider/outsider.pdf`), new Uint8Array([1]), { contentType: 'application/pdf' }));
  await assertFails(setDoc(doc(dbOf(outsider), 'projects', PID, 'workers', WID, 'documents', 'outsider'), { archived: false }));
  select(actor, UID);
}, 120_000);

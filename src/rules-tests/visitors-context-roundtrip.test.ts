// @vitest-environment jsdom
import React from 'react';
import express from 'express';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { signInAnonymously, signOut, type User } from 'firebase/auth';
import { terminate } from 'firebase/firestore';

// Only context projections and unrelated roster/induction UI are fixtures.
// Auth SDK, JWT middleware, router/membership, Firestore/audit and HTTP are real
// against isolated loopback emulators. No E2E_MODE authentication bypass.
const H = vi.hoisted(() => ({
  project: { id: 'visitor-context-a', name: 'Fixture A' },
  getUser: (): User | null => null,
  roster: [] as Array<{ uid: string; fullName: string }>,
}));
vi.mock('../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: H.getUser(), isAuthReady: true }) }));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: H.project }) }));
vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../hooks/useProjectRoster', () => ({ useProjectRoster: () => ({ roster: H.roster, loading: false }) }));
vi.mock('../hooks/useFirestoreCollection', () => ({ useFirestoreCollection: () => ({ data: [], loading: false, error: null }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : _key }) }));

const nativeFetch = globalThis.fetch.bind(globalThis);
const projectId = process.env.GCLOUD_PROJECT;
let rules: RulesTestEnvironment;
let adminApp: App;
let server: Server;
let baseUrl: string;
let services: typeof import('../services/firebase');
const responses: Array<{ path: string; status: number }> = [];

beforeAll(async () => {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const loopback = (value: string | undefined): value is string => typeof value === 'string' && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(value) && Number(value.split(':')[1]) <= 65_535;
  if (!projectId || !/^(demo-|praeventio-.*test$)/.test(projectId) || !loopback(fsHost) || !loopback(authHost)) throw new Error('Isolated loopback Auth/Firestore emulators required; no skip or remote fallback');
  vi.stubEnv('E2E_MODE', '0');
  vi.stubEnv('VITE_E2E_MODE', '0');
  vi.stubEnv('VITE_E2E_AUTH_EMULATOR_URL', `http://${authHost}`);
  const [host, port] = fsHost.split(':');
  rules = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } });
  await rules.clearFirestore();
  adminApp = initializeApp({ projectId });
  const { default: router } = await import('../server/routes/visitors');
  const app = express();
  app.use(express.json());
  app.use('/api/visitors', router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve());
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Listener unavailable');
  baseUrl = `http://127.0.0.1:${address.port}`;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== 'string' || !input.startsWith('/api/visitors')) return nativeFetch(input, init);
    const response = await nativeFetch(baseUrl + input, init);
    responses.push({ path: input, status: response.status });
    return response;
  });
  services = await import('../services/firebase');
  expect(services.auth.emulatorConfig).not.toBeNull();
  H.getUser = () => services.auth.currentUser;
}, 120_000);

afterAll(async () => {
  cleanup();
  if (services) { await signOut(services.auth); await terminate(services.db); }
  if (server) await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
  if (rules) { await rules.clearFirestore(); await rules.cleanup(); }
  if (adminApp) await deleteApp(adminApp);
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

it('registers through the real page/API, reads persisted A, rejects unauthenticated/foreign B and returns to valid A', async () => {
  const credential = await signInAnonymously(services.auth);
  const uid = credential.user.uid;
  await getAdminAuth(adminApp).setCustomUserClaims(uid, { tenantId: 'visitor-tenant-a', role: 'supervisor' });
  await credential.user.getIdToken(true);
  const db = getFirestore(adminApp);
  await db.doc(`users/${uid}`).set({ tenantId: 'visitor-tenant-a', role: 'supervisor', displayName: 'Fixture host' });
  await db.doc('projects/visitor-context-a').set({ tenantId: 'visitor-tenant-a', createdBy: uid, members: [uid] });
  await db.doc('projects/visitor-context-b').set({ tenantId: 'visitor-tenant-b', createdBy: 'other-fixture-owner', members: [] });
  H.roster = [{ uid, fullName: 'Fixture host' }];
  const { Visitors } = await import('../pages/Visitors');
  const view = render(React.createElement(Visitors));
  await screen.findByTestId('visitors-empty');

  function submit(name: string) {
    fireEvent.click(screen.getByTestId('visitors-new-button'));
    fireEvent.change(screen.getByTestId('visitor-fullname'), { target: { value: name } });
    fireEvent.change(screen.getByTestId('visitor-document'), { target: { value: '12.345.678-9' } });
    fireEvent.change(screen.getByTestId('visitor-organization'), { target: { value: 'Synthetic audit company' } });
    fireEvent.submit(screen.getByTestId('visitor-checkin-form'));
  }
  submit('Persisted synthetic visitor A');
  await screen.findByTestId('visitor-card');
  expect(screen.getByTestId('visitor-ack-modal')).toBeInTheDocument();
  const stored = await db.collection('tenants/visitor-tenant-a/projects/visitor-context-a/visitors').get();
  expect(stored.docs).toHaveLength(1);
  const saved = stored.docs[0].data();
  expect(saved).toMatchObject({ fullName: 'Persisted synthetic visitor A', projectId: 'visitor-context-a', tenantId: 'visitor-tenant-a', hostUid: uid });
  expect(saved.id).toBe(stored.docs[0].id);
  const token = await credential.user.getIdToken();
  const readback = await nativeFetch(`${baseUrl}/api/visitors?projectId=visitor-context-a`, { headers: { Authorization: `Bearer ${token}` } });
  expect(readback.status).toBe(200);
  expect(await readback.json()).toMatchObject({ ok: true, visitors: [{ id: saved.id, fullName: saved.fullName }] });
  expect((await nativeFetch(`${baseUrl}/api/visitors?projectId=visitor-context-a`)).status).toBe(401);
  expect((await nativeFetch(`${baseUrl}/api/visitors?projectId=visitor-context-a`, { headers: { Authorization: 'Bearer invalid-synthetic-token' } })).status).toBe(401);

  H.project = { id: 'visitor-context-b', name: 'Fixture B' };
  view.rerender(React.createElement(Visitors));
  await waitFor(() => expect(responses.some((row) => row.path.includes('projectId=visitor-context-b') && row.status === 403)).toBe(true));
  expect(screen.queryByText('Persisted synthetic visitor A')).not.toBeInTheDocument();
  expect(screen.queryByTestId('visitor-ack-modal')).not.toBeInTheDocument();
  submit('Denied synthetic visitor B');
  await screen.findByRole('alert');
  expect(responses.some((row) => row.path === '/api/visitors/check-in' && row.status === 403)).toBe(true);
  expect((await db.collection('tenants/visitor-tenant-b/projects/visitor-context-b/visitors').get()).empty).toBe(true);
  expect((await db.collection('tenants/visitor-tenant-a/projects/visitor-context-a/visitors').get()).docs).toHaveLength(1);

  H.project = { id: 'visitor-context-a', name: 'Fixture A' };
  view.rerender(React.createElement(Visitors));
  await screen.findByText('Persisted synthetic visitor A');
  expect(screen.queryByTestId('visitor-checkin-form')).not.toBeInTheDocument();
  expect(responses.filter((row) => row.path === '/api/visitors/check-in' && row.status === 200)).toHaveLength(1);
}, 60_000);

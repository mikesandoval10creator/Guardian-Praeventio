import { test, expect } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { buildE2EAuthHeader, DEFAULT_TEST_USER } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Official incident report — canonical writer → official reader.
 *
 * This is the external emulator gate for the Notion ticket
 * "Official incident report reads legacy path while canonical report writes
 * tenant path". It does not use a Firestore mock: the first POST writes through
 * /api/incidents/report and the second reconstructs the PDF through
 * /api/sprint-k/:projectId/incidents/:incidentId/report.
 */
const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3000';

function emulatorDb(): Firestore {
  if (!getApps().length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        'official-incident-report.spec: FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:e2e:full`.',
      );
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return getFirestore();
}

test.describe('Official incident report canonical path', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('the official reader consumes the canonical report written by the incident endpoint', async ({ request }) => {
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) throw new Error('E2E_TEST_SECRET must be provided by the full-stack test harness.');

    const seed = await seedProject({ supervisorUid: DEFAULT_TEST_USER.uid });
    const db = emulatorDb();
    const incidentId = `e2e-official-${Date.now()}`;
    const auth = { Authorization: buildE2EAuthHeader(secret, DEFAULT_TEST_USER.uid) };
    const incidentRef = db.doc(`tenants/e2e-tenant/projects/${seed.projectId}/incidents/${incidentId}`);
    const vectorRef = db.doc(`incident_vectors/e2e-tenant/items/${incidentId}`);

    try {
      const write = await request.post(`${API_BASE}/api/incidents/report`, {
        headers: auth,
        data: {
          projectId: seed.projectId,
          incidentType: 'incident',
          severity: 'high',
          description: 'Descripción canónica E2E del incidente',
          location: 'Faena Norte E2E',
          id: incidentId,
          ts: '2026-07-15T10:00:00.000Z',
        },
      });
      expect(write.status(), 'canonical incident writer must accept the report').toBe(200);
      const writeBody = (await write.json()) as { success?: boolean; incidentId?: string; path?: string };
      expect(writeBody.success).toBe(true);
      expect(writeBody.incidentId).toBe(incidentId);
      expect(writeBody.path).toBe(`tenants/e2e-tenant/projects/${seed.projectId}/incidents/${incidentId}`);

      const report = await request.post(
        `${API_BASE}/api/sprint-k/${seed.projectId}/incidents/${incidentId}/report`,
        {
          headers: auth,
          data: { title: 'caller-controlled title must not become official content' },
        },
      );
      expect(report.status(), 'official report reader must find the canonical record').toBe(200);
      expect(report.headers()['x-praeventio-doc-tier']).toBe('official');
      expect(report.headers()['x-report-incident-id']).toBe(incidentId);
      expect(report.headers()['x-report-sha256']).toMatch(/^[a-f0-9]{64}$/);
      expect(report.headers()['content-type']).toMatch(/^application\/pdf/);
      expect((await report.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      await Promise.all([incidentRef.delete().catch(() => {}), vectorRef.delete().catch(() => {})]);
      await seed.cleanup();
    }
  });
});

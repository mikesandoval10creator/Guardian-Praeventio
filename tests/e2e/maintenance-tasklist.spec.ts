import { test, expect } from '@playwright/test';
import { buildE2EAuthHeader, DEFAULT_TEST_USER } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Sprint A2 — MaintenanceTaskList mounted in the Mantenimiento Preventivo page
 * (`data-testid="mantenimiento-preventivo-page"`), fed by the REAL horómetro
 * maintenance endpoint.
 *
 * Exercises the real wire through Express + Firestore emulator:
 * HTTP auth (E2E header) → assertProjectMember → listMaintenanceTasks. The
 * list render + sort are covered by component tests; this spec covers the
 * endpoint + membership gate.
 *
 * URLs: Playwright baseURL is the static preview (:4173); the Express API lives
 * on :3000 (playwright.config webServer) → absolute URL.
 *
 * Gated by E2E_FULL_STACK=1.
 */
const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3000';
// Matches the secret the playwright.config Express command pins (cross-env).
const E2E_SECRET = 'e2e-test-secret-do-not-use-in-prod';

interface MaintenanceTask {
  id: string;
  severity: string;
}

test.describe('Maintenance task list endpoint', () => {
  // Verified green 2026-07-05 (Bloque A): the prior "different projects -> 403"
  // harness gap is fixed — server.ts:541-572 makes Express honor
  // GOOGLE_CLOUD_PROJECT (=demo-test) under the emulator, matching seed.ts, so
  // the member read returns 200 with the real (empty) task list.
  test('returns the real maintenance tasks for a member', async ({ request }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const seed = await seedProject();
    try {
      const res = await request.get(
        `${API_BASE}/api/sprint-k/${seed.projectId}/horometro/equipment/eq-e2e/maintenance-tasks`,
        { headers: { Authorization: buildE2EAuthHeader(E2E_SECRET, DEFAULT_TEST_USER.uid) } },
      );
      expect(res.ok()).toBeTruthy();
      const body = (await res.json()) as { tasks: MaintenanceTask[]; currentHours: number };
      expect(Array.isArray(body.tasks)).toBe(true);
    } finally {
      await seed.cleanup();
    }
  });

  test('rejects a non-member with 403 (membership gate)', async ({ request }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const seed = await seedProject(); // member = e2e-user-001
    try {
      const res = await request.get(
        `${API_BASE}/api/sprint-k/${seed.projectId}/horometro/equipment/eq-e2e/maintenance-tasks`,
        { headers: { Authorization: buildE2EAuthHeader(E2E_SECRET, 'e2e-intruder-999') } },
      );
      expect(res.status()).toBe(403);
    } finally {
      await seed.cleanup();
    }
  });
});

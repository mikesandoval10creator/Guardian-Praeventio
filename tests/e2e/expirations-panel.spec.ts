import { test, expect } from '@playwright/test';
import { buildE2EAuthHeader, DEFAULT_TEST_USER } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Sprint A1 — ExpirationsListPanel mounted in the prevencionista Dashboard
 * (`data-testid="expirations-panel"`), fed by the REAL expirable-items endpoint.
 *
 * Exercises the real wire through Express + Firestore emulator:
 * HTTP auth (E2E header) → assertProjectMember → server-assembled ExpirableItem[]
 * (today: EPP assignments with a real expiresAt). The panel's bucket render +
 * scanForExpirations math are covered by expirationScanner tests; this spec
 * covers the endpoint + gate.
 *
 * URLs: Playwright baseURL is the static preview (:4173, SPA HTML for /api/*);
 * the Express API lives on :3000 (playwright.config webServer) → absolute URL.
 *
 * Gated by E2E_FULL_STACK=1.
 */
const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3000';
// Matches the secret the playwright.config Express command pins (cross-env).
const E2E_SECRET = 'e2e-test-secret-do-not-use-in-prod';

interface ExpirableItem {
  id: string;
  kind: string;
  expiresAt?: string | null;
}

test.describe('Expirations list endpoint', () => {
  // Verified green 2026-07-05 (Bloque A): the prior "different projects -> 403"
  // harness gap is fixed — server.ts:541-572 makes Express honor
  // GOOGLE_CLOUD_PROJECT (=demo-test) under the emulator, matching seed.ts, so
  // the member read returns 200 with the real (empty) ExpirableItem[].
  test('returns real ExpirableItem[] for a member', async ({ request }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const seed = await seedProject();
    try {
      const res = await request.get(
        `${API_BASE}/api/sprint-k/${seed.projectId}/expirations/list`,
        { headers: { Authorization: buildE2EAuthHeader(E2E_SECRET, DEFAULT_TEST_USER.uid) } },
      );
      expect(res.ok()).toBeTruthy();
      const body = (await res.json()) as { items: ExpirableItem[] };
      expect(Array.isArray(body.items)).toBe(true);
      // Seeded project has no EPP assignments → honest empty list (no fabrication).
      for (const it of body.items) {
        expect(typeof it.id).toBe('string');
        expect(it.kind).toBe('epp');
      }
    } finally {
      await seed.cleanup();
    }
  });

  test('rejects a non-member with 403 (membership gate)', async ({ request }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const seed = await seedProject(); // member = e2e-user-001
    try {
      const res = await request.get(
        `${API_BASE}/api/sprint-k/${seed.projectId}/expirations/list`,
        { headers: { Authorization: buildE2EAuthHeader(E2E_SECRET, 'e2e-intruder-999') } },
      );
      expect(res.status()).toBe(403);
    } finally {
      await seed.cleanup();
    }
  });
});

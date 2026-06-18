import { test, expect } from '@playwright/test';
import { buildE2EAuthHeader, DEFAULT_TEST_USER } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Sprint A1 — compliance traffic light backend (mounted in the Dashboard header
 * via `data-testid="compliance-traffic-light"`).
 *
 * Exercises the REAL wire end-to-end through the Express server + Firestore
 * emulator: HTTP auth (E2E header) → assertProjectMember → real
 * `computeTrafficLight` engine → coverage-aware honesty wrapper. It targets the
 * API server DIRECTLY (not the React render) so it does not depend on the
 * ProjectContext selecting a project in the harness — a known limitation that
 * fixme'd the SOS/process specs. The `data-testid` mount stays in the component
 * for a future UI-level spec once that harness gap is closed.
 *
 * NOTE on URLs: Playwright's `baseURL` is the static preview (:4173), which
 * serves the SPA history-fallback (HTML) for `/api/*`. The Express API lives on
 * :3000 (see playwright.config webServer), so we hit it with an ABSOLUTE URL.
 * The E2E secret is the deterministic value the config's Express command pins.
 *
 * Gated by E2E_FULL_STACK=1 (needs Express + Firestore emulator).
 */
const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3000';
// Must match the secret the playwright.config Express command pins (cross-env),
// which overrides any job env for that subprocess.
const E2E_SECRET = 'e2e-test-secret-do-not-use-in-prod';

interface CategoryView {
  category: string;
  light: 'green' | 'yellow' | 'red' | 'unknown';
}
interface TrafficLightResult {
  overall: string;
  score: number | null;
  byCategory: CategoryView[];
  sourcedCount: number;
  totalCount: number;
}

test.describe('Compliance traffic light endpoint', () => {
  test('returns a real coverage-aware snapshot (legal sourced, rest sin datos)', async ({ request }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');

    const seed = await seedProject();
    try {
      const res = await request.get(
        `${API_BASE}/api/compliance/${seed.projectId}/traffic-light`,
        { headers: { Authorization: buildE2EAuthHeader(E2E_SECRET, DEFAULT_TEST_USER.uid) } },
      );
      expect(res.ok()).toBeTruthy();

      const body = (await res.json()) as { result: TrafficLightResult };
      const result = body.result;

      // Real engine output: all 8 categories present.
      expect(result.byCategory).toHaveLength(8);
      expect(result.totalCount).toBe(8);

      // Only `legal` has a real data source wired today.
      const legal = result.byCategory.find((c) => c.category === 'legal');
      expect(legal).toBeDefined();
      expect(['green', 'yellow', 'red']).toContain(legal!.light);
      expect(result.sourcedCount).toBe(1);

      // The other 7 are honestly "sin datos" — NEVER fabricated green.
      const unknown = result.byCategory.filter((c) => c.light === 'unknown');
      expect(unknown).toHaveLength(7);
    } finally {
      await seed.cleanup();
    }
  });

  test('rejects a non-member with 403 (membership gate)', async ({ request }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');

    const seed = await seedProject(); // member = e2e-user-001
    try {
      const res = await request.get(
        `${API_BASE}/api/compliance/${seed.projectId}/traffic-light`,
        { headers: { Authorization: buildE2EAuthHeader(E2E_SECRET, 'e2e-intruder-999') } },
      );
      expect(res.status()).toBe(403);
    } finally {
      await seed.cleanup();
    }
  });
});

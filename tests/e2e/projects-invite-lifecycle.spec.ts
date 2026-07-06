import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import {
  buildE2EAuthHeader,
  DEFAULT_TEST_USER,
  loginAsTestUser,
  signInBrowserViaCustomToken,
} from './fixtures/auth';

/**
 * Proyectos (Bloque C4) — full two-user lifecycle:
 *   create project (REAL UI) → invite a member (real route) → accept (REAL UI
 *   in a SECOND browser context) → the invitee lands in projects/{id}.members.
 *
 * Un-gameable server signals, all read straight from the Firestore emulator:
 *  - The create now flows through POST /api/projects (#1200): createdBy /
 *    tenantId / members are stamped from the VERIFIED token and a
 *    'projects.create' audit row is written — both asserted.
 *  - The invitation doc carries a server-generated 64-hex token and
 *    'projects.invite' is audited with the CREATOR's uid.
 *  - Acceptance runs the server transaction: invitee uid arrayUnion'd into
 *    members + memberRoles[uid] set from the INVITE (never the client), the
 *    invitation flips to 'accepted', and 'projects.inviteAccept' is audited
 *    with the INVITEE's uid. A replayed accept is rejected (404, single-use).
 *
 * ROLE-SWAP (harness constraint): verifyAuth's E2E branch stamps the FIXED
 * email 'e2e@praeventio.test' for every uid, while /accept requires strict
 * invitedEmail === req.user.email. So the INVITEE must be the default user
 * (e2e-user-001) and the CREATOR a second uid with a UNIQUE email (the Auth
 * emulator rejects duplicate emails across uids).
 *
 * Honest limits: the invite-creation hop is API-driven (no member-management
 * UI exists yet — product gap); the email link is simulated by navigating
 * /invite?token= directly (same URL the mail carries; Resend is unconfigured
 * in E2E by design). Requires the full stack (`npm run test:e2e:full`).
 */

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3000';
const E2E_SECRET = process.env.E2E_TEST_SECRET ?? 'e2e-test-secret-do-not-use-in-prod';
const CREATOR = { uid: 'e2e-c4-owner', email: 'c4-owner@praeventio.test', displayName: 'C4 Owner' };

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        'projects-invite-lifecycle.spec: FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:e2e:full`.',
      );
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('Project lifecycle: create → invite → accept (two users)', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('el ciclo completo deja al invitado como miembro real, con cada paso auditado', async ({ page, browser }) => {
    const db = emulatorDb();
    let projectId: string | undefined;

    try {
      // ── CONTEXT A: the creator (unique email — see ROLE-SWAP note). ──────
      await loginAsTestUser(page, CREATOR);
      await page.goto('/projects');
      await signInBrowserViaCustomToken(page);

      // Satisfy the MFA hard-gate: handleSubmit reads idb-keyval
      // 'mfa_setup_completed' and requires the STRING 'true' (Projects.tsx).
      // idb-keyval's default DB/store are 'keyval-store'/'keyval'.
      await page.evaluate(
        () =>
          new Promise<void>((resolve, reject) => {
            const open = indexedDB.open('keyval-store');
            open.onupgradeneeded = () => open.result.createObjectStore('keyval');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const tx = open.result.transaction('keyval', 'readwrite');
              tx.objectStore('keyval').put('true', 'mfa_setup_completed');
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            };
          }),
      );

      // REAL UI create → since #1200 this drives POST /api/projects.
      const createBtn = page.getByTestId('create-project-button');
      await expect(createBtn).toBeVisible({ timeout: 15_000 });
      await expect(createBtn).toBeEnabled({ timeout: 15_000 });
      await createBtn.click();

      await page.getByTestId('create-project-name-input').fill('Faena C4 E2E');
      await page.getByTestId('create-project-description-input').fill('Ciclo two-user del Bloque C4');
      await page.getByTestId('create-project-location-input').fill('Antofagasta, Región de Antofagasta');

      const createResponsePromise = page.waitForResponse(
        (res) => /\/api\/projects\/?$/.test(res.url()) && res.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await page.getByTestId('create-project-submit-button').click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status(), 'server-side create must be accepted').toBe(200);
      projectId = ((await createResponse.json()) as { projectId?: string }).projectId;
      expect(typeof projectId === 'string' && projectId!.length > 0).toBe(true);

      // Un-gameable: the doc the SERVER wrote, identity from the token.
      const projRef = db.collection('projects').doc(projectId!);
      await expect
        .poll(async () => (await projRef.get()).exists, { intervals: [200, 500, 1000], timeout: 8_000 })
        .toBe(true);
      const proj = (await projRef.get()).data() as Record<string, any>;
      expect(proj.createdBy).toBe(CREATOR.uid);
      expect(proj.tenantId).toBe(CREATOR.uid);
      expect(proj.members).toEqual([CREATOR.uid]);

      // ...and the audit row the old client addDoc never wrote (#1200).
      const auditFor = async (action: string) => {
        const rows = await db.collection('audit_logs').where('details.projectId', '==', projectId).get();
        return rows.docs.map((d) => d.data() as Record<string, any>).find((r) => r.action === action);
      };
      await expect
        .poll(async () => Boolean(await auditFor('projects.create')), { intervals: [200, 500, 1000], timeout: 8_000 })
        .toBe(true);
      expect((await auditFor('projects.create'))!.userId).toBe(CREATOR.uid);

      // The project surfaces from the real onSnapshot (members query). With a
      // single project, ProjectContext auto-selects it (ProjectContext.tsx:309)
      // and the page renders the DETAIL view instead of the grid — accept
      // either surface.
      await expect(
        page.getByTestId(`project-card-${projectId}`).or(page.getByTestId('project-detail-name')).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Faena C4 E2E').first()).toBeVisible({ timeout: 10_000 });

      // ── INVITE (real route; no member-management UI exists — product gap).
      const inviteResponse = await page.request.post(`${API_BASE}/api/projects/${projectId}/invite`, {
        headers: { Authorization: buildE2EAuthHeader(E2E_SECRET, CREATOR.uid) },
        data: { invitedEmail: DEFAULT_TEST_USER.email, invitedRole: 'supervisor' },
      });
      expect(inviteResponse.status(), 'invite must be accepted for the creator').toBe(200);
      const { token } = (await inviteResponse.json()) as { token: string };
      expect(token).toMatch(/^[a-f0-9]{64}$/); // server-generated, crypto.randomBytes

      const inviteAudit = await auditFor('projects.invite');
      expect(inviteAudit, 'projects.invite must be audited').toBeTruthy();
      expect(inviteAudit!.userId).toBe(CREATOR.uid);

      // ── CONTEXT B: the invitee (default E2E user — email matches the
      // verifyAuth stamp). Fresh browser context = a genuinely separate user.
      const ctxB = await browser.newContext();
      try {
        const pageB = await ctxB.newPage();
        await loginAsTestUser(pageB);

        const acceptResponsePromise = pageB.waitForResponse(
          (res) => res.url().includes(`/api/invitations/${token}/accept`) && res.request().method() === 'POST',
          { timeout: 25_000 },
        );
        // Same URL the invitation email carries.
        await pageB.goto(`/invite?token=${token}`);
        await signInBrowserViaCustomToken(pageB);
        const acceptResponse = await acceptResponsePromise;
        expect(acceptResponse.status(), 'accept must succeed for the invited email').toBe(200);
        await expect(pageB.getByTestId('invite-accept-success')).toBeVisible({ timeout: 10_000 });

        // Un-gameable: the server transaction's writes.
        await expect
          .poll(
            async () => {
              const d = (await projRef.get()).data() as Record<string, any>;
              return Array.isArray(d.members) && d.members.includes(DEFAULT_TEST_USER.uid);
            },
            { intervals: [200, 500, 1000], timeout: 8_000 },
          )
          .toBe(true);
        const after = (await projRef.get()).data() as Record<string, any>;
        expect(after.memberRoles?.[DEFAULT_TEST_USER.uid]).toBe('supervisor'); // from the INVITE, not the client

        const invites = await db.collection('invitations').where('projectId', '==', projectId).get();
        const invite = invites.docs[0]?.data() as Record<string, any>;
        expect(invite.status).toBe('accepted');
        expect(invite.acceptedAt).toBeTruthy();

        const acceptAudit = await auditFor('projects.inviteAccept');
        expect(acceptAudit, 'projects.inviteAccept must be audited').toBeTruthy();
        expect(acceptAudit!.userId).toBe(DEFAULT_TEST_USER.uid);

        // Membership is now visible to the invitee through the REAL query
        // (where('members','array-contains', uid)) — only true if the
        // transaction committed. Auto-select applies here too (single project)
        // → accept the card or the detail view.
        await pageB.goto('/projects');
        await expect(
          pageB.getByTestId(`project-card-${projectId}`).or(pageB.getByTestId('project-detail-name')).first(),
        ).toBeVisible({ timeout: 15_000 });
        await expect(pageB.getByText('Faena C4 E2E').first()).toBeVisible({ timeout: 10_000 });

        // Single-use: replaying the accept must be rejected.
        const replay = await pageB.request.post(`${API_BASE}/api/invitations/${token}/accept`, {
          headers: { Authorization: buildE2EAuthHeader(E2E_SECRET, DEFAULT_TEST_USER.uid) },
          data: {},
        });
        expect(replay.status(), 'a used invitation token must not be re-acceptable').toBe(404);
      } finally {
        await ctxB.close();
      }
    } finally {
      // Cleanup: the project + its invitations (audit_logs is append-only by
      // design; the emulator is ephemeral per suite).
      if (projectId) {
        await db.collection('projects').doc(projectId).delete().catch(() => {});
        const leftovers = await db.collection('invitations').where('projectId', '==', projectId).get();
        await Promise.all(leftovers.docs.map((d) => d.ref.delete()));
      }
    }
  });
});

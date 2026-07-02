#!/usr/bin/env node
/**
 * Praeventio Guard — M-1 Phase 2: multi-tenant backfill.
 *
 * Run with:
 *   node scripts/backfill-project-tenantid.cjs           # dry-run (default)
 *   node scripts/backfill-project-tenantid.cjs --live    # actually write
 *
 * WHAT IT DOES (three plans, printed in full before any write):
 *   1. PROJECT STAMPS  — every `projects/{pid}` doc missing `tenantId` gets
 *      `tenantId = createdBy` (founder decision 2026-07-02 + design doc §4:
 *      docs/security/M1-multitenant-tenant-scope-design.md). Docs with NO
 *      `createdBy` are NEVER guessed: they land on a needs-review list and
 *      the script exits 2 if any exist (so --live runs are conscious).
 *   2. CLAIM MINTS     — every Auth user gets custom claim `tenantId = uid`
 *      (single-tenant-per-user model), PRESERVING existing claims. Users
 *      already bearing a tenantId claim are skipped (idempotent).
 *   3. DATA MOVES      — legacy namespace healing. Server writers used the
 *      fallback `tenantId || projectId`, so pre-backfill data lives under
 *      `tenants/{projectId}/...`. When the resolved tenant differs from the
 *      projectId, every subcollection doc under `tenants/{projectId}` is
 *      COPIED to `tenants/{tenantId}` (source retained — nothing deleted;
 *      readers resolve the new namespace the moment the stamp lands).
 *
 * AUDIT: each executed phase writes one `audit_logs` entry
 * (action: security.m1_backfill.<phase>, userId: script:backfill-m1).
 *
 * IDEMPOTENT: re-running produces empty plans once everything is stamped.
 *
 * EXIT CODES
 *   0 — completed (dry-run or live)
 *   1 — fatal error (credentials, network, ...)
 *   2 — needs-review projects found (missing createdBy) — resolve manually
 */

'use strict';

/* eslint-disable no-console */

// ---- pure planners (unit-tested in src/__tests__/scripts) ------------------

/**
 * @param {Array<{id: string, tenantId?: unknown, createdBy?: unknown}>} projects
 * @returns {{ stamps: Array<{id: string, tenantId: string}>, needsReview: string[], skipped: number }}
 */
function planProjectStamps(projects) {
  const stamps = [];
  const needsReview = [];
  let skipped = 0;
  for (const p of projects) {
    const has = typeof p.tenantId === 'string' && p.tenantId.length > 0;
    if (has) {
      skipped += 1;
      continue;
    }
    const createdBy = typeof p.createdBy === 'string' && p.createdBy.length > 0 ? p.createdBy : null;
    if (!createdBy) {
      needsReview.push(p.id);
      continue;
    }
    stamps.push({ id: p.id, tenantId: createdBy });
  }
  return { stamps, needsReview, skipped };
}

/**
 * Merge-plan for one user's custom claims. Returns `null` when nothing to do
 * (already has a non-empty string tenantId), else the FULL claim object to
 * set (existing claims preserved — setCustomUserClaims overwrites wholesale).
 *
 * @param {string} uid
 * @param {Record<string, unknown> | undefined} existingClaims
 * @returns {Record<string, unknown> | null}
 */
function planClaimUpdate(uid, existingClaims) {
  const claims = existingClaims ?? {};
  if (typeof claims.tenantId === 'string' && claims.tenantId.length > 0) return null;
  return { ...claims, tenantId: uid };
}

/**
 * Legacy-namespace healing plan: projects whose resolved tenant differs from
 * the projectId used by the old `tenantId || projectId` fallback.
 *
 * @param {Array<{id: string, tenantId: string}>} resolved — id + FINAL tenant (post-stamp)
 * @returns {Array<{projectId: string, from: string, to: string}>}
 */
function planTenantDataMoves(resolved) {
  return resolved
    .filter((p) => p.tenantId !== p.id)
    .map((p) => ({ projectId: p.id, from: `tenants/${p.id}`, to: `tenants/${p.tenantId}` }));
}

/**
 * Select the Firestore database this backfill must target. Mirrors the
 * server.ts boot rule: production data lives in the NAMED database from
 * firebase-applet-config.json (`firestoreDatabaseId`), NOT "(default)".
 * Without this, `admin.firestore()` scans an empty default DB and the whole
 * run reports "nothing to do" — a silent wrong-target, the worst failure
 * mode for a security migration. Emulator runs keep the default handle
 * (the emulator serves it regardless of named-DB config — same exception
 * server.ts makes).
 *
 * @param {{ app: () => unknown, firestore: () => unknown }} adminNs — firebase-admin namespace
 * @param {{ firestoreDatabaseId?: unknown }} cfg — parsed firebase-applet-config.json
 * @param {string | undefined} emulatorHost — process.env.FIRESTORE_EMULATOR_HOST
 * @param {(app: unknown, dbId: string) => unknown} [getFirestoreImpl] — injectable for unit tests
 */
function resolveBackfillDb(adminNs, cfg, emulatorHost, getFirestoreImpl) {
  const named =
    typeof cfg.firestoreDatabaseId === 'string' &&
    cfg.firestoreDatabaseId.length > 0 &&
    cfg.firestoreDatabaseId !== '(default)';
  if (!emulatorHost && named) {
    // eslint-disable-next-line global-require
    const getFs = getFirestoreImpl ?? require('firebase-admin/firestore').getFirestore;
    return getFs(adminNs.app(), cfg.firestoreDatabaseId);
  }
  return adminNs.firestore();
}

module.exports = { planProjectStamps, planClaimUpdate, planTenantDataMoves, resolveBackfillDb };

// ---- CLI -------------------------------------------------------------------

const LIVE = process.argv.includes('--live');
const BATCH_LIMIT = 450; // Firestore hard cap is 500 — leave headroom.

async function main() {
  const admin = require('firebase-admin');
  // Explicit projectId: ADC user credentials (gcloud auth application-default
  // login) don't always expose a detectable project id — the PUBLIC client
  // config is the canonical source, same file server.ts reads at boot.
  // eslint-disable-next-line global-require
  const appletConfig = require('../firebase-applet-config.json');
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: appletConfig.projectId,
  });
  const db = resolveBackfillDb(admin, appletConfig, process.env.FIRESTORE_EMULATOR_HOST);
  console.log(
    `[m1-backfill] target: project=${appletConfig.projectId} db=${
      typeof appletConfig.firestoreDatabaseId === 'string' && appletConfig.firestoreDatabaseId
        ? appletConfig.firestoreDatabaseId
        : '(default)'
    }${process.env.FIRESTORE_EMULATOR_HOST ? ' [EMULATOR]' : ''}`,
  );

  // ---------- 1. project stamps ----------
  const snap = await db.collection('projects').get();
  const projects = snap.docs.map((d) => {
    const data = d.data() || {};
    return { id: d.id, tenantId: data.tenantId, createdBy: data.createdBy };
  });
  const { stamps, needsReview, skipped } = planProjectStamps(projects);

  console.log(`[m1-backfill] projects: ${projects.length} total — ${stamps.length} to stamp, ${skipped} already stamped, ${needsReview.length} needs-review`);
  for (const s of stamps) console.log(`  STAMP projects/${s.id} → tenantId=${s.tenantId}`);
  for (const id of needsReview) console.log(`  ⚠ NEEDS-REVIEW projects/${id} (no createdBy — resolve manually, NOT guessed)`);

  // ---------- 2. claim mints ----------
  const claimPlans = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const u of page.users) {
      const plan = planClaimUpdate(u.uid, u.customClaims);
      if (plan) claimPlans.push({ uid: u.uid, claims: plan });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(`[m1-backfill] claims: ${claimPlans.length} user(s) to mint tenantId (existing claims preserved)`);

  // ---------- 3. data moves (legacy tenants/{projectId} namespaces) ----------
  const finalTenants = projects
    .map((p) => {
      const stamped = stamps.find((s) => s.id === p.id);
      const tenantId = stamped ? stamped.tenantId : (typeof p.tenantId === 'string' ? p.tenantId : null);
      return tenantId ? { id: p.id, tenantId } : null;
    })
    .filter(Boolean);
  const movePlans = planTenantDataMoves(finalTenants);
  const movesWithData = [];
  for (const m of movePlans) {
    const subcols = await db.doc(m.from).listCollections();
    if (subcols.length > 0) movesWithData.push({ ...m, subcols: subcols.map((c) => c.id) });
  }
  console.log(`[m1-backfill] data-moves: ${movesWithData.length} legacy namespace(s) with data`);
  for (const m of movesWithData) console.log(`  MOVE ${m.from}/{${m.subcols.join(',')}} → ${m.to} (copy, source retained)`);

  if (!LIVE) {
    console.log('[m1-backfill] DRY-RUN — nothing written. Re-run with --live to execute.');
    return needsReview.length > 0 ? 2 : 0;
  }

  // ---------- execute ----------
  for (let i = 0; i < stamps.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const s of stamps.slice(i, i + BATCH_LIMIT)) {
      batch.update(db.collection('projects').doc(s.id), { tenantId: s.tenantId });
    }
    await batch.commit();
  }
  for (const c of claimPlans) {
    await admin.auth().setCustomUserClaims(c.uid, c.claims);
  }
  let docsCopied = 0;
  for (const m of movesWithData) {
    for (const colId of m.subcols) {
      const docs = await db.collection(`${m.from}/${colId}`).get();
      for (let i = 0; i < docs.docs.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const d of docs.docs.slice(i, i + BATCH_LIMIT)) {
          batch.set(db.doc(`${m.to}/${colId}/${d.id}`), d.data(), { merge: false });
          docsCopied += 1;
        }
        await batch.commit();
      }
    }
  }
  await db.collection('audit_logs').add({
    action: 'security.m1_backfill',
    module: 'security',
    details: {
      projectsStamped: stamps.length,
      claimsMinted: claimPlans.length,
      namespacesHealed: movesWithData.length,
      docsCopied,
      needsReview,
    },
    userId: 'script:backfill-m1',
    userEmail: null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`[m1-backfill] LIVE done: ${stamps.length} stamped, ${claimPlans.length} claims, ${docsCopied} docs copied. Audit logged.`);
  return needsReview.length > 0 ? 2 : 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[m1-backfill] FATAL:', err);
      process.exit(1);
    });
}

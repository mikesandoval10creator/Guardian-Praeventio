// Praeventio Guard — Sprint 35 DR dry-run.
//
// Deterministic seeder for the DR dryrun spec. Runs against the Firestore
// emulator only — NEVER against prod. The shape mirrors a small but
// representative production tenant:
//
//   - 1 tenant
//   - 100 projects
//   - 10,000 workers (sharded across projects)
//   - 1,000 incidents (critical path: emergency alerts + audit)
//   - 5,000 zk nodes (Zettelkasten — NEVER exposed to APIs, but must
//     survive DR per Sprint 10 D4 boundary; integrity is what we verify)
//   - 200 emergency_alerts (critical, RPO=0 desired)
//   - 500 audit_logs (compliance — Ley 21.719 art. 14ter)
//
// Reproducibility: uses a fixed seed so doc IDs are stable across runs;
// this lets the spec assert exact post-restore counts without flakiness.
//
// Hard rule: refuses to run if FIRESTORE_EMULATOR_HOST is unset.

'use strict';

const admin = require('firebase-admin');

const SEED_VERSION = 'dr-dryrun-v1';

// Volumes — tuned to keep emulator memory < 1 GB and the seed under 60 s.
// Production-scale validation belongs in a manual GCP staging drill (out
// of scope for CI). See DR_RUNBOOK §4.3 + "Automated dry-run" section.
const COUNTS = Object.freeze({
  projects: 100,
  workers: 10_000,
  incidents: 1_000,
  zkNodes: 5_000,
  emergencyAlerts: 200,
  auditLogs: 500,
});

const TENANT_ID = 'dr-dryrun-tenant-001';

function ensureAdmin() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'seed-dr-dataset: FIRESTORE_EMULATOR_HOST must be set. Refusing to ' +
        'touch real Firestore.',
    );
  }
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    process.env.GOOGLE_CLOUD_PROJECT = 'demo-dr';
  }
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.app();
}

// Tiny LCG — deterministic, no extra deps. Same seed → same outputs.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

async function batchedWrite(refsAndDocs, batchSize = 400) {
  const db = admin.firestore();
  for (let i = 0; i < refsAndDocs.length; i += batchSize) {
    const batch = db.batch();
    for (const { ref, data } of refsAndDocs.slice(i, i + batchSize)) {
      batch.set(ref, data);
    }
    await batch.commit();
  }
}

async function seed() {
  ensureAdmin();
  const db = admin.firestore();
  const rng = makeRng(0xdr20260505);
  const now = Date.now();

  // Tenant.
  await db.collection('tenants').doc(TENANT_ID).set({
    name: 'DR Dryrun Tenant',
    seedVersion: SEED_VERSION,
    createdAt: now,
  });

  // Projects.
  const projectIds = [];
  const projectDocs = [];
  for (let i = 0; i < COUNTS.projects; i++) {
    const id = `prj_${String(i).padStart(4, '0')}`;
    projectIds.push(id);
    projectDocs.push({
      ref: db.collection('projects').doc(id),
      data: {
        tenantId: TENANT_ID,
        name: `Proyecto ${i}`,
        seedVersion: SEED_VERSION,
        createdAt: now - Math.floor(rng() * 30 * 86_400_000),
      },
    });
  }
  await batchedWrite(projectDocs);

  // Workers — sharded round-robin across projects.
  const workerDocs = [];
  for (let i = 0; i < COUNTS.workers; i++) {
    const projectId = projectIds[i % projectIds.length];
    workerDocs.push({
      ref: db.collection('workers').doc(`wrk_${String(i).padStart(6, '0')}`),
      data: {
        tenantId: TENANT_ID,
        projectId,
        rut: `${10_000_000 + i}-K`,
        seedVersion: SEED_VERSION,
      },
    });
  }
  await batchedWrite(workerDocs);

  // Incidents (critical path).
  const incidentDocs = [];
  for (let i = 0; i < COUNTS.incidents; i++) {
    incidentDocs.push({
      ref: db.collection('incidents').doc(`inc_${String(i).padStart(5, '0')}`),
      data: {
        tenantId: TENANT_ID,
        projectId: projectIds[i % projectIds.length],
        severity: ['low', 'medium', 'high', 'critical'][i % 4],
        seedVersion: SEED_VERSION,
        createdAt: now - Math.floor(rng() * 7 * 86_400_000),
      },
    });
  }
  await batchedWrite(incidentDocs);

  // Emergency alerts (critical, must survive DR with zero loss).
  const alertDocs = [];
  for (let i = 0; i < COUNTS.emergencyAlerts; i++) {
    alertDocs.push({
      ref: db
        .collection('emergency_alerts')
        .doc(`alr_${String(i).padStart(4, '0')}`),
      data: {
        tenantId: TENANT_ID,
        projectId: projectIds[i % projectIds.length],
        active: i < 5,
        seedVersion: SEED_VERSION,
        createdAt: now - Math.floor(rng() * 3 * 86_400_000),
      },
    });
  }
  await batchedWrite(alertDocs);

  // Audit logs (Ley 21.719 art. 14ter compliance).
  const auditDocs = [];
  for (let i = 0; i < COUNTS.auditLogs; i++) {
    auditDocs.push({
      ref: db.collection('audit_logs').doc(`aud_${String(i).padStart(5, '0')}`),
      data: {
        tenantId: TENANT_ID,
        eventType: ['login', 'export', 'delete', 'role_change'][i % 4],
        seedVersion: SEED_VERSION,
        timestamp: now - Math.floor(rng() * 14 * 86_400_000),
      },
    });
  }
  await batchedWrite(auditDocs);

  // Zettelkasten nodes — Sprint 10 D4: NEVER exposed via API, but DR
  // must preserve them (knowledge base IS the moat).
  const zkDocs = [];
  for (let i = 0; i < COUNTS.zkNodes; i++) {
    zkDocs.push({
      ref: db.collection('zk_nodes').doc(`zk_${String(i).padStart(5, '0')}`),
      data: {
        tenantId: TENANT_ID,
        edges: [`zk_${String((i + 1) % COUNTS.zkNodes).padStart(5, '0')}`],
        seedVersion: SEED_VERSION,
      },
    });
  }
  await batchedWrite(zkDocs);

  return { counts: COUNTS, tenantId: TENANT_ID, seedVersion: SEED_VERSION };
}

async function clearAll() {
  ensureAdmin();
  const db = admin.firestore();
  const collections = [
    'tenants',
    'projects',
    'workers',
    'incidents',
    'emergency_alerts',
    'audit_logs',
    'zk_nodes',
  ];
  for (const col of collections) {
    const snap = await db.collection(col).limit(500).get();
    while (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      const next = await db.collection(col).limit(500).get();
      if (next.empty) break;
      snap.docs.length = 0;
      next.docs.forEach((d) => snap.docs.push(d));
    }
  }
}

module.exports = { seed, clearAll, COUNTS, TENANT_ID, SEED_VERSION };

// CLI entry — `node tests/dr/seed-dr-dataset.cjs`.
if (require.main === module) {
  seed()
    .then((res) => {
      // eslint-disable-next-line no-console
      console.log('[seed-dr] done', res);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[seed-dr] failed', err);
      process.exit(1);
    });
}

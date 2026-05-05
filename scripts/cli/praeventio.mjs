#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// praeventio CLI — Sprint 24 differentiators (Bucket LL).
//
// Dev + admin tooling that operators reach for during local repro,
// preview-deployment seeding, and emergency drills. Wraps the same
// firebase-admin SDK the server uses, so a flag set here behaves
// identically in production.
//
// Usage:
//   node scripts/cli/praeventio.mjs <command> [options]
//
// Commands:
//   dev seed-tenant <tenantId> [--workers=10]
//       Populate Firestore for a fresh tenant: org doc, demo project,
//       N workers with realistic Chilean RUT-style ids, baseline RiskNodes.
//
//   dev flush-cache <type>
//       Wipe a named cache. <type> ∈ {ai, normativa, sentry, all}.
//
//   dev simulate-emergency <type>
//       Inject a synthetic emergency event for QA. <type> ∈ {sismic, fall, sos}.
//
//   dev export-tenant <tenantId>
//       Stream a JSON dump of a tenant's projects + nodes to stdout.
//       Pipe to a file for backup / repro: `... export-tenant t1 > t1.json`.
//
//   admin grant-tier <customerId> <tier>
//       Bump a customer to a B2D API tier. <tier> from BILLING.md.
//
// Required env (loaded via dotenv):
//   GOOGLE_APPLICATION_CREDENTIALS — service account JSON path.
//   GOOGLE_CLOUD_PROJECT           — Firebase project id.
//
// Exit codes:
//   0 = success, 1 = user error (bad args / missing env), 2 = runtime error.

import process from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lazy-load heavy deps so `--help` and arg-parsing never pay their cost.
async function loadFirebaseAdmin() {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: resolve(__dirname, '../../.env') });

  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    error('GOOGLE_CLOUD_PROJECT is not set. Source your .env or export it.');
    process.exit(1);
  }

  const admin = await import('firebase-admin');
  if (admin.apps.length === 0) {
    admin.initializeApp({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? admin.credential.applicationDefault()
        : admin.credential.applicationDefault(),
    });
  }
  return admin;
}

function log(...args) {
  process.stdout.write(args.join(' ') + '\n');
}
function error(...args) {
  process.stderr.write('[praeventio] ' + args.join(' ') + '\n');
}

// --------------------------------------------------------------------------
// argv parser (no dependency on yargs/commander — stdlib only).
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v = 'true'] = a.slice(2).split('=');
      out.flags[k] = v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Commands
// --------------------------------------------------------------------------

async function cmdSeedTenant(args) {
  const tenantId = args._[2];
  if (!tenantId) {
    error('Usage: dev seed-tenant <tenantId> [--workers=10]');
    process.exit(1);
  }
  const workers = parseInt(args.flags.workers ?? '10', 10);
  if (!Number.isFinite(workers) || workers < 1 || workers > 1000) {
    error('--workers must be an integer 1..1000');
    process.exit(1);
  }

  const admin = await loadFirebaseAdmin();
  const db = admin.firestore();

  log(`[seed] tenantId=${tenantId} workers=${workers}`);

  // Org/tenant doc.
  await db.collection('orgs').doc(tenantId).set(
    {
      tenantId,
      name: `Demo Tenant ${tenantId}`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      industry: 'Construction',
      tier: 'silver',
    },
    { merge: true },
  );

  // Demo project.
  const projectRef = db.collection('projects').doc(`${tenantId}-demo`);
  await projectRef.set(
    {
      tenantId,
      name: 'Demo Project',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'active',
    },
    { merge: true },
  );

  // Workers — minimal but realistic shape.
  const batch = db.batch();
  for (let i = 0; i < workers; i++) {
    const ref = db.collection('workers').doc(`${tenantId}-worker-${i}`);
    batch.set(ref, {
      tenantId,
      projectId: `${tenantId}-demo`,
      name: `Worker ${i + 1}`,
      role: i % 5 === 0 ? 'supervisor' : 'operator',
      // Synthetic Chilean-style RUT, valid format only (NOT real ids).
      rut: `${10_000_000 + i}-${(i % 10).toString()}`,
      active: true,
    });
  }
  await batch.commit();

  // Baseline RiskNodes so the Universal Knowledge graph isn't empty.
  const nodes = [
    { type: 'Riesgo', title: 'Caída de altura', tags: ['Crítico'] },
    { type: 'Control', title: 'Arnés y línea de vida', tags: ['EPP'] },
    { type: 'Tarea', title: 'Inspección diaria de andamios', tags: [] },
  ];
  for (const n of nodes) {
    await db.collection('nodes').add({
      ...n,
      projectId: `${tenantId}-demo`,
      tenantId,
      description: `Seeded by praeventio CLI for ${tenantId}`,
      metadata: { geo: null },
      connections: [],
      schemaVersion: 4,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  log(`[seed] OK — created tenant, 1 project, ${workers} workers, ${nodes.length} nodes.`);
}

async function cmdFlushCache(args) {
  const type = args._[2];
  const VALID = ['ai', 'normativa', 'sentry', 'all'];
  if (!type || !VALID.includes(type)) {
    error(`Usage: dev flush-cache <${VALID.join('|')}>`);
    process.exit(1);
  }
  const admin = await loadFirebaseAdmin();
  const db = admin.firestore();

  const targets =
    type === 'all'
      ? ['ai_cache', 'normativa_cache', 'sentry_cache']
      : [`${type}_cache`];

  for (const col of targets) {
    const snap = await db.collection(col).limit(500).get();
    if (snap.empty) {
      log(`[flush] ${col}: empty.`);
      continue;
    }
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    log(`[flush] ${col}: deleted ${snap.size} docs.`);
  }
}

async function cmdSimulateEmergency(args) {
  const type = args._[2];
  const VALID = ['sismic', 'fall', 'sos'];
  if (!type || !VALID.includes(type)) {
    error(`Usage: dev simulate-emergency <${VALID.join('|')}>`);
    process.exit(1);
  }
  const admin = await loadFirebaseAdmin();
  const db = admin.firestore();

  const eventId = `sim-${type}-${Date.now()}`;
  await db.collection('emergency_events').doc(eventId).set({
    eventId,
    type,
    severity: type === 'sos' ? 'critical' : 'high',
    source: 'praeventio-cli',
    synthetic: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    payload:
      type === 'fall'
        ? { accel: 8.2, durationMs: 420 }
        : type === 'sismic'
          ? { magnitude: 6.1, depthKm: 35 }
          : { triggeredBy: 'cli' },
  });

  log(`[emergency] injected ${type} event id=${eventId}`);
}

async function cmdExportTenant(args) {
  const tenantId = args._[2];
  if (!tenantId) {
    error('Usage: dev export-tenant <tenantId>');
    process.exit(1);
  }
  const admin = await loadFirebaseAdmin();
  const db = admin.firestore();

  const [org, projects, nodes] = await Promise.all([
    db.collection('orgs').doc(tenantId).get(),
    db.collection('projects').where('tenantId', '==', tenantId).get(),
    db.collection('nodes').where('tenantId', '==', tenantId).get(),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    tenantId,
    org: org.exists ? org.data() : null,
    projects: projects.docs.map((d) => ({ id: d.id, ...d.data() })),
    nodes: nodes.docs.map((d) => ({ id: d.id, ...d.data() })),
  };

  // Plain JSON to stdout (NOT log — caller pipes to a file).
  process.stdout.write(JSON.stringify(dump, null, 2));
}

async function cmdGrantTier(args) {
  const customerId = args._[2];
  const tier = args._[3];
  const VALID_TIERS = ['bronze', 'silver', 'gold', 'diamond'];
  if (!customerId || !tier || !VALID_TIERS.includes(tier)) {
    error(`Usage: admin grant-tier <customerId> <${VALID_TIERS.join('|')}>`);
    process.exit(1);
  }
  const admin = await loadFirebaseAdmin();
  const db = admin.firestore();

  await db.collection('customers').doc(customerId).set(
    {
      tier,
      tierGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
      tierGrantedBy: 'praeventio-cli',
    },
    { merge: true },
  );

  log(`[admin] customerId=${customerId} → tier=${tier}`);
}

// --------------------------------------------------------------------------
// Entry
// --------------------------------------------------------------------------

function printHelp() {
  log(`praeventio — Guardian Praeventio dev CLI
Usage: praeventio <namespace> <command> [args] [--flag=value]

Namespaces & commands:
  dev seed-tenant <tenantId> [--workers=10]
  dev flush-cache <ai|normativa|sentry|all>
  dev simulate-emergency <sismic|fall|sos>
  dev export-tenant <tenantId>
  admin grant-tier <customerId> <bronze|silver|gold|diamond>

Options:
  -h, --help     Show this message and exit.
  -v, --version  Print package version.

Env:
  GOOGLE_CLOUD_PROJECT            Firebase project id (required).
  GOOGLE_APPLICATION_CREDENTIALS  Service account JSON path (recommended).
`);
}

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ns = args._[0];
  const cmd = args._[1];

  if (args.flags.help || args.flags.h || ns === 'help' || !ns) {
    printHelp();
    return;
  }
  if (args.flags.version || args.flags.v || ns === 'version') {
    log(`praeventio v${readVersion()}`);
    return;
  }

  try {
    if (ns === 'dev' && cmd === 'seed-tenant')        return await cmdSeedTenant(args);
    if (ns === 'dev' && cmd === 'flush-cache')        return await cmdFlushCache(args);
    if (ns === 'dev' && cmd === 'simulate-emergency') return await cmdSimulateEmergency(args);
    if (ns === 'dev' && cmd === 'export-tenant')      return await cmdExportTenant(args);
    if (ns === 'admin' && cmd === 'grant-tier')       return await cmdGrantTier(args);
  } catch (err) {
    error('Command failed:', err && err.stack ? err.stack : String(err));
    process.exit(2);
  }

  error(`Unknown command: ${ns} ${cmd ?? ''}`);
  printHelp();
  process.exit(1);
}

main();

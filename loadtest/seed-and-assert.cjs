// Seed + assert helper for the SOS 1k load test.
//
// Talks directly to the Firestore emulator REST surface — no firebase-admin
// import needed (keeps the loadtest dir dep-light). The emulator accepts
// unauthenticated REST calls when bound to FIRESTORE_EMULATOR_HOST.
//
// Modes:
//   node seed-and-assert.cjs seed     → write project doc with 1000 members
//   node seed-and-assert.cjs assert   → count emergency_alerts, exit 1 if !==1000

'use strict';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'demo-test';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const TARGET_PROJECT = 'load-test-project';
const EXPECTED_ALERTS = Number(process.env.EXPECTED_ALERTS || 1000);
// Tenancy fallback in routes/emergency.ts: if `projects/{id}.tenantId` is
// missing the route falls back to `projectId` itself as the tenant key.
const TENANT_ID = TARGET_PROJECT;

const BASE = `http://${HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function memberUids(n) {
  return Array.from({ length: n }, (_, i) =>
    `load-worker-${String(i + 1).padStart(4, '0')}`,
  );
}

async function seed() {
  const members = memberUids(EXPECTED_ALERTS);
  const url = `${BASE}/projects/${TARGET_PROJECT}`;
  const body = {
    fields: {
      tenantId: { stringValue: TENANT_ID },
      members: { arrayValue: { values: members.map((m) => ({ stringValue: m })) } },
      createdBy: { stringValue: members[0] },
      name: { stringValue: 'SOS Load Test Project' },
    },
  };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Seed failed (${res.status}): ${text}`);
  }
  console.log(`[seed] project ${TARGET_PROJECT} with ${members.length} members.`);
}

async function assertAlerts() {
  const url =
    `${BASE}/tenants/${TENANT_ID}/emergency_alerts?pageSize=2000`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Assert query failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  const docs = Array.isArray(data.documents) ? data.documents : [];
  console.log(`[assert] persisted ${docs.length} / ${EXPECTED_ALERTS} alerts`);
  if (docs.length !== EXPECTED_ALERTS) {
    console.error(
      `[assert] FAIL: expected ${EXPECTED_ALERTS} emergency_alerts, found ${docs.length}. ` +
        `Zero loss is non-negotiable for SOS — investigate Firestore backpressure / 429s.`,
    );
    process.exit(1);
  }
  console.log('[assert] PASS — zero SOS lost.');
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'seed') return seed();
  if (cmd === 'assert') return assertAlerts();
  console.error('Usage: seed-and-assert.cjs <seed|assert>');
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

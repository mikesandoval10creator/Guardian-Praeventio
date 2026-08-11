#!/usr/bin/env node
/**
 * Real Firestore disaster-recovery rehearsal.
 *
 * Unlike tests/dr/dr-runbook-dryrun.spec.ts, this command imports a managed
 * Firestore export through FirestoreAdminClient.importDocuments() and then
 * validates the restored staging database.
 *
 * Required:
 *   GCP_PROJECT_ID=<staging project>
 *   GCS_RESTORE_PATH=gs://bucket/firestore/YYYY-MM-DD
 *
 * The target must contain "staging" or start with "demo-". Production is
 * rejected unconditionally. Credentials must be supplied by the caller (for
 * example GitHub OIDC or GOOGLE_APPLICATION_CREDENTIALS); this script never
 * creates or prints credentials.
 */
"use strict";

const { v1 } = require("@google-cloud/firestore");
const admin = require("firebase-admin");
const { Storage } = require("@google-cloud/storage");

const IMPORT_TIMEOUT_MS = 50 * 60 * 1000;

function parseGsUri(uri) {
  if (typeof uri !== "string" || !uri.startsWith("gs://")) {
    throw new Error(`invalid GCS restore URI: ${uri || "(empty)"}`);
  }
  const rest = uri.slice(5).replace(/\/+$/, "");
  const slash = rest.indexOf("/");
  if (slash < 1 || slash === rest.length - 1) {
    throw new Error("GCS restore URI must include bucket and export prefix");
  }
  return { bucket: rest.slice(0, slash), prefix: rest.slice(slash + 1) };
}

function assertStagingProject(projectId) {
  if (typeof projectId !== "string" || projectId.trim() === "") {
    throw new Error("staging project is required");
  }
  if (
    projectId === "praeventio-prod" ||
    !(/staging/i.test(projectId) || /^demo-/i.test(projectId))
  ) {
    throw new Error(
      `refusing real restore into production-like project: ${projectId}`,
    );
  }
}

function normalizeId(doc) {
  return typeof doc?.id === "string" ? doc.id : "(missing-id)";
}

/**
 * Validate exact counts where the export manifest has exact values (negative
 * values mean the backup writer only established non-empty) and verify the
 * project references that make the restored dataset usable.
 */
function validateRestoredSnapshot(manifest, snapshot) {
  const counts = manifest?.collectionCounts || {};
  const countMismatches = [];
  for (const [collection, expected] of Object.entries(counts)) {
    if (!(collection in snapshot)) continue;
    if (!Number.isInteger(expected) || expected < 0) continue;
    const actual = Array.isArray(snapshot[collection])
      ? snapshot[collection].length
      : 0;
    if (actual !== expected)
      countMismatches.push({ collection, expected, actual });
  }

  const projects = new Set((snapshot.projects || []).map(normalizeId));
  const orphanCrews = (snapshot.crews || [])
    .filter(
      (doc) =>
        typeof doc.projectId !== "string" || !projects.has(doc.projectId),
    )
    .map(normalizeId);
  const orphanProcesses = (snapshot.processes || [])
    .filter(
      (doc) =>
        typeof doc.projectId !== "string" || !projects.has(doc.projectId),
    )
    .map(normalizeId);

  return {
    countMismatches,
    orphanCrews,
    orphanProcesses,
    healthy:
      countMismatches.length === 0 &&
      orphanCrews.length === 0 &&
      orphanProcesses.length === 0,
  };
}

async function readManifest(storage, restorePath) {
  const { bucket, prefix } = parseGsUri(restorePath);
  const file = storage.bucket(bucket).file(`${prefix}/manifest.json`);
  const [buffer] = await file.download();
  return JSON.parse(buffer.toString("utf8"));
}

async function readCollection(db, collection) {
  const snap = await db.collection(collection).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function importExport(projectId, restorePath) {
  const client = new v1.FirestoreAdminClient();
  const database = client.databasePath(projectId, "(default)");
  const [operation] = await client.importDocuments({
    name: database,
    inputUriPrefix: restorePath.replace(/\/+$/, ""),
    collectionIds: [],
  });
  const [, metadata] = await Promise.race([
    operation.promise(),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`import exceeded ${IMPORT_TIMEOUT_MS / 60000} minutes`),
          ),
        IMPORT_TIMEOUT_MS,
      ),
    ),
  ]);
  return { operationName: operation.name || null, metadata: metadata || null };
}

async function run({ projectId, restorePath, now = new Date() }) {
  assertStagingProject(projectId);
  const parsed = parseGsUri(restorePath);
  const storage = new Storage({ projectId });
  const manifest = await readManifest(storage, restorePath);
  if (manifest.project && manifest.project === projectId) {
    throw new Error(
      "restore source project equals staging target; use an isolated staging project",
    );
  }

  const imported = await importExport(projectId, restorePath);
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const snapshot = {};
  for (const collection of ["projects", "crews", "processes"]) {
    // eslint-disable-next-line no-await-in-loop
    snapshot[collection] = await readCollection(db, collection);
  }
  const validation = validateRestoredSnapshot(manifest, snapshot);
  const evidence = {
    kind: "dr-real-restore-report",
    timestamp: now.toISOString(),
    targetProject: projectId,
    source: `gs://${parsed.bucket}/${parsed.prefix}`,
    operationName: imported.operationName,
    validatedCollections: ["projects", "crews", "processes"],
    imported: true,
    validation,
  };
  if (!validation.healthy) {
    const error = new Error(
      "restored staging data failed integrity validation",
    );
    error.evidence = evidence;
    throw error;
  }
  return evidence;
}

async function main(env = process.env) {
  const projectId = env.DR_TEST_PROJECT_ID || env.GCP_PROJECT_ID;
  const restorePath = env.GCS_RESTORE_PATH;
  try {
    const evidence = await run({ projectId, restorePath });
    console.log(JSON.stringify(evidence, null, 2));
    return 0;
  } catch (error) {
    const evidence = error.evidence || {
      kind: "dr-real-restore-report",
      timestamp: new Date().toISOString(),
      targetProject: projectId || null,
      imported: false,
      error: error.message || String(error),
    };
    console.error(JSON.stringify(evidence, null, 2));
    return 2;
  }
}

if (require.main === module) main().then((code) => process.exit(code));

module.exports = {
  assertStagingProject,
  parseGsUri,
  validateRestoredSnapshot,
  readManifest,
  importExport,
  run,
  main,
};

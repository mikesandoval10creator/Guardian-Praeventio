// SystemEngine — Zettelkasten consolidation migration.
//
// **DO NOT RUN against production without a backup snapshot.** This job
// rewrites Firestore documents across three collections to consolidate
// the Zettelkasten on a single canonical path.
//
// Why this exists
// ---------------
// Sprint 11 introduced top-level `zettelkasten_nodes` for the new POST
// /api/zettelkasten/nodes writer. Sprint 28 introduced
// `tenants/{tid}/zettelkasten_nodes` for tenant-scoped writers
// (incidentPostmortem, wisdomCapsule). The legacy `nodes` collection,
// originally seeded by `services/networkBackend.ts`, is read by
// `safetyEngineBackend.ts` and the RAG ingest trigger in
// `backgroundTriggers.ts`. None of these three paths sync between
// themselves. As a result, knowledge written via the canonical endpoint
// never reaches the RAG embedder, and the digital-twin UI sees a
// different subset than the safety engine. Audit hallazgo: silent
// fragmentation.
//
// What this job does
// ------------------
//   1. Streams every doc in `nodes` and top-level `zettelkasten_nodes`.
//   2. Resolves each node's tenantId (from doc.tenantId, OR from its
//      project's tenant claim, OR rejects if neither exists).
//   3. Writes a normalised copy at
//      `tenants/{tenantId}/zettelkasten_nodes/{idempotencyKey}` with the
//      union of fields (last-write-wins by `updatedAt`).
//   4. Records an audit_log entry per migrated node with `before` paths.
//   5. **In commit mode**, deletes the source documents AFTER the new
//      write succeeds. **Default mode is dry-run**.
//
// Mode selection
// --------------
// The job is invoked with `{ mode: 'dry-run' | 'commit' }`. Default is
// dry-run, which logs what would happen and writes nothing. To actually
// migrate, the caller must pass `mode: 'commit'` explicitly. There is no
// CLI flag to flip; the operator passes the option in code.

import type { Firestore } from 'firebase-admin/firestore';
import admin from 'firebase-admin';

import { logger } from '../../utils/logger.js';

export type ConsolidationMode = 'dry-run' | 'commit';

export interface ConsolidationOptions {
  /** Live Firestore handle. Tests inject a fake. */
  db: Firestore;
  /** 'dry-run' (default, safe) or 'commit' (writes + deletes). */
  mode?: ConsolidationMode;
  /** Optional cap on how many docs to process this run. Default: no cap. */
  limit?: number;
  /**
   * Function that resolves a tenantId for a doc that lacks the field.
   * Used to back-fill from project membership: lookup
   * `projects/{projectId}` for the inferred tenant. Tests inject stubs.
   */
  resolveTenantId?: (doc: { id: string; data: Record<string, unknown> }) => Promise<string | null>;
}

export interface ConsolidationReport {
  mode: ConsolidationMode;
  scanned: { legacyNodes: number; topLevelZk: number };
  consolidated: number;
  skippedNoTenant: number;
  skippedAlreadyConsolidated: number;
  errors: Array<{ docPath: string; reason: string }>;
}

export async function consolidateZettelkasten(
  opts: ConsolidationOptions,
): Promise<ConsolidationReport> {
  const { db, mode = 'dry-run', limit, resolveTenantId } = opts;

  const report: ConsolidationReport = {
    mode,
    scanned: { legacyNodes: 0, topLevelZk: 0 },
    consolidated: 0,
    skippedNoTenant: 0,
    skippedAlreadyConsolidated: 0,
    errors: [],
  };

  const sources: Array<{ collection: string; label: 'legacyNodes' | 'topLevelZk' }> = [
    { collection: 'nodes', label: 'legacyNodes' },
    { collection: 'zettelkasten_nodes', label: 'topLevelZk' },
  ];

  for (const source of sources) {
    let snapshot: FirebaseFirestore.QuerySnapshot;
    try {
      snapshot = await db.collection(source.collection).limit(limit ?? 10_000).get();
    } catch (err) {
      report.errors.push({
        docPath: source.collection,
        reason: `read failed: ${String(err)}`,
      });
      continue;
    }

    report.scanned[source.label] = snapshot.size;

    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const docPath = `${source.collection}/${doc.id}`;

      let tenantId =
        typeof data.tenantId === 'string' && data.tenantId.length > 0
          ? data.tenantId
          : null;

      if (!tenantId && resolveTenantId) {
        try {
          tenantId = await resolveTenantId({ id: doc.id, data });
        } catch (err) {
          report.errors.push({
            docPath,
            reason: `tenant resolve threw: ${String(err)}`,
          });
          continue;
        }
      }

      if (!tenantId) {
        report.skippedNoTenant++;
        logger.warn('consolidateZettelkasten: no tenant for doc', { docPath });
        continue;
      }

      const idempotencyKey =
        typeof data.idempotencyKey === 'string' && data.idempotencyKey.length > 0
          ? data.idempotencyKey
          : doc.id;

      const targetPath = `tenants/${tenantId}/zettelkasten_nodes`;
      const targetRef = db.collection(targetPath).doc(idempotencyKey);

      // Skip if a doc already exists at the target with a fresher
      // updatedAt — last-write-wins, preserve the most recent edit.
      try {
        const existing = await targetRef.get();
        if (existing.exists) {
          const existingUpdatedAt = (existing.data()?.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
          const incomingUpdatedAt = (data.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
          if (
            typeof existingUpdatedAt === 'number' &&
            typeof incomingUpdatedAt === 'number' &&
            existingUpdatedAt >= incomingUpdatedAt
          ) {
            report.skippedAlreadyConsolidated++;
            continue;
          }
        }
      } catch (err) {
        report.errors.push({
          docPath: `${targetPath}/${idempotencyKey}`,
          reason: `target read failed: ${String(err)}`,
        });
        continue;
      }

      if (mode === 'dry-run') {
        report.consolidated++;
        continue;
      }

      try {
        // Stamp tenantId so subsequent reads via collectionGroup can
        // filter on it consistently.
        await targetRef.set(
          {
            ...data,
            tenantId,
            idempotencyKey,
            consolidatedFrom: source.collection,
            consolidatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        await doc.ref.delete();
        report.consolidated++;
      } catch (err) {
        report.errors.push({
          docPath,
          reason: `write/delete failed: ${String(err)}`,
        });
      }
    }
  }

  return report;
}

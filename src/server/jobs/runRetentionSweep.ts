// SPDX-License-Identifier: MIT
//
// runRetentionSweep — evalúa la política y archiva sin eliminar datos fuente.
//
// Ticket 39baa66d-73fe-81f8-b9f0-da5503007f5b:
// el motor `decideRetention()` existía, pero la ruta HTTP era deliberadamente
// stateless: "Caller decides what to do". En producción eso dejaba la política
// como calculadora intelectual, sin archivado/purga ni informe auditado.
//
// Este job es el aplicador programable para Cloud Scheduler:
//   1. recorre colecciones cubiertas;
//   2. transforma cada doc a DataRecord;
//   3. evalúa `decideRetention`;
//   4. aplica archive_immutable sin eliminar el documento fuente;
//   5. persiste `retention_sweep_runs/{runId}` con métricas y decisiones.
//
// Protección importante: ningún documento fuente se borra. Aunque una regla de
// retención diga `purge`, el job lo degrada a `archive_immutable`/keep-source
// conforme al ADR-0024, preservando datos de prevención y trazabilidad.

import type admin from "firebase-admin";
import {
  decideRetention,
  type DataCategory,
  type DataRecord,
  type Jurisdiction,
  type RetentionDecision,
  type RetentionRule,
} from "../../services/privacyRetention/dataRetentionPolicy.js";

interface DocSnapLike {
  id: string;
  ref: DocRefLike;
  data(): Record<string, unknown> | undefined;
}

interface QuerySnapLike {
  docs: DocSnapLike[];
}

interface CollectionRefLike {
  path: string;
  get(): Promise<QuerySnapLike>;
}

interface DocRefLike {
  path: string;
  set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void>;
}

export interface RetentionSweepDb {
  collection(path: string): CollectionRefLike;
  doc(path: string): DocRefLike;
}

export interface RetentionSweepOptions {
  now?: Date;
  /** Categorías a considerar. Si se omite, se barren todas las cubiertas. */
  categories?: readonly DataCategory[];
  /** Reglas custom para tests o rollout por jurisdicción. */
  defaultRules?: ReadonlyArray<RetentionRule>;
  /** Id explícito para idempotency externa/retry manual. */
  runId?: string;
  /** Colecciones directas que contienen records con fields category/jurisdiction/createdAt. */
  collectionPaths?: readonly string[];
}

export interface AppliedRetentionDecision extends RetentionDecision {
  collectionPath: string;
  sourcePath: string;
}

export interface RetentionSweepReport {
  runId: string;
  now: string;
  collectionPaths: string[];
  categories: DataCategory[];
  totalDocs: number;
  /** `purge` remains for report compatibility and is always zero. */
  counts: Record<"keep_active" | "archive_immutable" | "purge", number>;
  archived: number;
  /** Source documents are never deleted; this remains zero under ADR-0024. */
  purged: number;
  auditLogLeftAlone: boolean;
  decisions: AppliedRetentionDecision[];
}

const DEFAULT_COLLECTION_PATHS = [
  "discrepancies",
  "audit_log",
  "incidents",
  "medical_records",
  "training_records",
  "epp_assignments",
  "sensor_telemetry",
  "consent_artifacts",
  "communication_logs",
  "document_versions",
] as const;

const ALL_CATEGORIES: readonly DataCategory[] = [
  "incident",
  "medical_aptitude",
  "medical_diagnosis",
  "training_record",
  "epp_assignment",
  "attendance",
  "audit_log",
  "sensor_telemetry",
  "consent_artifact",
  "communication_log",
  "document_version",
] as const;

function sanitizePath(path: string): string {
  return path.replace(/[^a-zA-Z0-9/_-]/g, "_");
}

function defaultRunId(now: Date): string {
  return `retention-${now.toISOString().slice(0, 10)}`;
}

function asDataRecord(
  id: string,
  raw: Record<string, unknown>,
): DataRecord | null {
  const category = raw.category;
  const jurisdiction = raw.jurisdiction;
  const createdAt = raw.createdAt;
  if (typeof category !== "string" || typeof jurisdiction !== "string")
    return null;
  if (typeof createdAt !== "string") return null;
  return {
    id: typeof raw.id === "string" ? raw.id : id,
    category: category as DataCategory,
    jurisdiction: jurisdiction as Jurisdiction,
    createdAt,
    legalHold: raw.legalHold === true,
    retentionOverrideDays:
      typeof raw.retentionOverrideDays === "number"
        ? raw.retentionOverrideDays
        : undefined,
  };
}

async function archiveImmutable(
  db: RetentionSweepDb,
  collectionPath: string,
  doc: DocSnapLike,
  raw: Record<string, unknown>,
  decision: RetentionDecision,
  nowIso: string,
): Promise<void> {
  const archivePath = `retention_archives/${sanitizePath(collectionPath)}/${doc.id}`;
  await db.doc(archivePath).set(
    {
      ...raw,
      archivedAt: nowIso,
      sourcePath: doc.ref.path,
      retentionDecision: decision,
      immutable: true,
      schemaVersion: 1,
    },
    { merge: true },
  );
}

export async function runRetentionSweep(
  dbOrDeps: RetentionSweepDb | { db: admin.firestore.Firestore },
  options: RetentionSweepOptions = {},
): Promise<RetentionSweepReport> {
  const db =
    "db" in dbOrDeps ? (dbOrDeps.db as unknown as RetentionSweepDb) : dbOrDeps;
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const runId = options.runId ?? defaultRunId(now);
  const categories = [...(options.categories ?? ALL_CATEGORIES)];
  const categorySet = new Set<DataCategory>(categories);
  const collectionPaths = [
    ...(options.collectionPaths ?? DEFAULT_COLLECTION_PATHS),
  ];

  const report: RetentionSweepReport = {
    runId,
    now: nowIso,
    collectionPaths,
    categories,
    totalDocs: 0,
    counts: { keep_active: 0, archive_immutable: 0, purge: 0 },
    archived: 0,
    purged: 0,
    auditLogLeftAlone: false,
    decisions: [],
  };

  for (const collectionPath of collectionPaths) {
    const snap = await db.collection(collectionPath).get();
    for (const doc of snap.docs) {
      const raw = doc.data();
      if (!raw) continue;
      const record = asDataRecord(doc.id, raw);
      if (!record || !categorySet.has(record.category)) continue;

      report.totalDocs += 1;
      let decision = decideRetention(record, {
        now,
        customRules: options.defaultRules,
      });

      // ADR-0024: el motor conserva su acción advisory `purge`, pero este
      // ejecutor nunca puede eliminar documentos fuente. Se degrada a un
      // archivo inmutable y la fuente se conserva para prevención/trazabilidad.
      if (decision.action === "purge") {
        const isAuditLog = record.category === "audit_log";
        if (isAuditLog) report.auditLogLeftAlone = true;
        decision = {
          ...decision,
          action: "archive_immutable",
          rationale: `${decision.rationale} Purge blocked by ADR-0024 — source retained and archived.${
            isAuditLog ? " Audit_log preserve-traceability guard." : ""
          }`,
        };
      }

      report.counts[decision.action] += 1;
      report.decisions.push({
        ...decision,
        collectionPath,
        sourcePath: doc.ref.path,
      });

      if (decision.action === "archive_immutable") {
        await archiveImmutable(db, collectionPath, doc, raw, decision, nowIso);
        report.archived += 1;
      }
    }
  }

  await db.doc(`retention_sweep_runs/${runId}`).set(
    {
      ...report,
      completedAt: nowIso,
      schemaVersion: 1,
    },
    { merge: true },
  );

  return report;
}

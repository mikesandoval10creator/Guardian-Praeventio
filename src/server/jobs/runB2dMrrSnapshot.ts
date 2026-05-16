// SPDX-License-Identifier: MIT
//
// runB2dMrrSnapshot — toma una "foto" mensual de los métricos B2D y la
// persiste en `b2d_mrr_snapshots/{YYYY-MM}`.
//
// 2026-05-16 (Sprint E backend debt):
// El panel `B2dAdminPanel.tsx:164-184` venía mostrando UN SOLO PUNTO
// (mes actual) en el chart MRR, después del fix Sprint D que eliminó
// la "rampa lineal mentirosa". El comentario inline pinta el camino:
//
//   "el cron `runB2dMrrSnapshot` (TODO Sprint E, ver server/jobs/)
//    llene `b2d_mrr_snapshots/{YYYY-MM}` con valores reales mensuales"
//
// Este job es el shim que cumple esa promesa:
//
//   1. Llama computeB2dMetrics() (que ya existe — calcula MRR real
//      desde b2d_api_keys + tier pricing)
//   2. Persiste el resultado en `b2d_mrr_snapshots/{YYYY-MM}` con
//      idempotency: si el doc del mes ya existe, hace merge (no
//      sobreescribe createdAt + churnRate30d acumulado).
//   3. Retorna la fila escrita para audit + telemetría.
//
// Caller esperado: Cloud Scheduler endpoint dedicado o
// /api/maintenance/run-b2d-mrr-snapshot. Frecuencia: 1× por mes
// (idealmente día 1 a 00:30 UTC para capturar el último día completo).
//
// Patrón idéntico a `runConsistencyAudit.ts` (Sprint 39 G.3): deps
// inyectadas para testabilidad, idempotency key explícito, audit log
// opcional.

import type admin from 'firebase-admin';
import {
  computeB2dMetrics,
  type B2dMetrics,
} from '../../services/analytics/b2dMetrics.js';
import { logger } from '../../utils/logger.js';

export interface B2dMrrSnapshotDeps {
  db: admin.firestore.Firestore;
  /** Override del clock para tests (default Date.now). */
  now?: () => Date;
  /** Override de computeB2dMetrics para tests. */
  computeMetrics?: typeof computeB2dMetrics;
}

/**
 * El doc que persistimos cada mes. El shape es un superset de
 * `B2dMetrics` con el `monthKey` + `capturedAt` para audit + sorting.
 */
export interface B2dMrrSnapshotDoc extends B2dMetrics {
  /** Identificador del mes en formato `YYYY-MM`. Es también el doc id. */
  monthKey: string;
  /** Etiqueta humana del mes (ej "May 26"). Pre-renderizada para chart. */
  monthLabel: string;
  /** ISO timestamp captura. */
  capturedAt: string;
  /** Versión del esquema (futuro-proof: si cambia el shape, queremos
   *  detectar drift en lecturas). */
  schemaVersion: 1;
}

export interface B2dMrrSnapshotResult {
  monthKey: string;
  /** True si el documento se creó por primera vez en esta corrida. */
  created: boolean;
  /** El doc final tras merge. */
  snapshot: B2dMrrSnapshotDoc;
}

/**
 * Captura el snapshot mensual y lo persiste.
 *
 * Idempotency: si el mismo job corre 2 veces en el mismo mes, la
 * segunda corrida sobrescribe los métricos PERO preserva `capturedAt`
 * de la primera (vía merge no destructivo). Las re-corridas son útiles
 * para refrescar métricos a mediados de mes si el operador lo necesita.
 */
export async function runB2dMrrSnapshot(
  deps: B2dMrrSnapshotDeps,
): Promise<B2dMrrSnapshotResult> {
  const now = deps.now ? deps.now() : new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const monthLabel = now.toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
  });

  const computeFn = deps.computeMetrics ?? computeB2dMetrics;
  const metrics = await computeFn({ now: now.getTime() });

  const docRef = deps.db.collection('b2d_mrr_snapshots').doc(monthKey);
  const existing = await docRef.get();
  const wasCreated = !existing.exists;

  const snapshot: B2dMrrSnapshotDoc = {
    ...metrics,
    monthKey,
    monthLabel,
    capturedAt: now.toISOString(),
    schemaVersion: 1,
  };

  // Merge: si ya existe, sobrescribimos las métricas pero NO el
  // capturedAt original (lo preservamos como `firstCapturedAt`
  // implícito vía merge). Esto da histórico fiel — el operador puede
  // re-correr el job durante el mes y los métricos se actualizan, pero
  // sabemos cuándo fue la primera captura.
  if (wasCreated) {
    await docRef.set(snapshot);
  } else {
    // No tocamos capturedAt; merge actualiza el resto.
    const { capturedAt: _drop, ...withoutFirstCapture } = snapshot;
    await docRef.set(withoutFirstCapture, { merge: true });
  }

  logger.info('b2d_mrr_snapshot_captured', {
    monthKey,
    mrr: metrics.mrr,
    arr: metrics.arr,
    customersActive: metrics.customersActive,
    wasCreated,
  });

  // Devolvemos el snapshot completo recién escrito (más útil para
  // audit que volver a leer Firestore).
  return {
    monthKey,
    created: wasCreated,
    snapshot,
  };
}

/**
 * Lee los últimos N snapshots (más reciente primero). Los componentes
 * UI lo usan para alimentar el chart de tendencia MRR.
 */
export async function readRecentB2dMrrSnapshots(
  db: admin.firestore.Firestore,
  limitN = 12,
): Promise<B2dMrrSnapshotDoc[]> {
  const snap = await db
    .collection('b2d_mrr_snapshots')
    .orderBy('monthKey', 'desc')
    .limit(limitN)
    .get();
  return snap.docs.map((d) => d.data() as B2dMrrSnapshotDoc);
}

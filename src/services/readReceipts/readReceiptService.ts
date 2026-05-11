// Praeventio Guard — Sprint 39 Fase G.1: confirmación lectura obligatoria.
//
// Cierra: Documento usuario "Recomendaciones nuevas §4"
//         Plan integral Top 15 #1
//
// Cuando se publica un procedimiento nuevo, política revisada o
// instructivo de emergencia, los trabajadores AFECTADOS deben confirmar
// lectura + aceptación. Este servicio:
//
//   1. Calcula el set de afectados según `audienceCriteria` del documento
//   2. Trackea estado por (documentId, workerUid): pending / acknowledged
//   3. Detecta vencimientos de lectura: si pasó > readDeadlineDays sin
//      confirmar, el item se eleva a Finding crítico
//
// API puro: el caller persiste (Firestore Admin SDK). Sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface DocumentAudience {
  /** Si está poblado, solo workers con estos UIDs. */
  workerUids?: string[];
  /** Si está poblado, workers con cargo en esta lista. */
  roles?: string[];
  /** Si está poblado, workers asignados a estos projects. */
  projectIds?: string[];
  /** Si está poblado, workers que tienen estos training codes. */
  trainingCodes?: string[];
  /** Si true, TODOS los workers activos del tenant. */
  allWorkers?: boolean;
}

export interface DocumentForRead {
  id: string;
  version: number;
  title: string;
  audience: DocumentAudience;
  /** Fecha desde la cual aplica obligación. */
  publishedAt: string;
  /** Días para confirmar lectura antes de elevar a Finding. */
  readDeadlineDays: number;
}

export interface WorkerForRead {
  uid: string;
  role: string;
  projectIds: string[];
  activeTrainings: string[];
  isActive: boolean;
}

export interface ReadReceipt {
  documentId: string;
  documentVersion: number;
  workerUid: string;
  acknowledgedAt: string | null;
  /** ISO-8601 deadline computed at publication. */
  deadlineAt: string;
  /** Status derivado: 'pending' | 'acknowledged' | 'overdue' */
  status: ReadReceiptStatus;
}

export type ReadReceiptStatus = 'pending' | 'acknowledged' | 'overdue';

// ────────────────────────────────────────────────────────────────────────
// Audience resolution
// ────────────────────────────────────────────────────────────────────────

/**
 * Resuelve qué workers están dentro del audience del documento.
 *
 * Reglas:
 *   - `allWorkers: true` → todos los activos
 *   - Si no, intersección de los filtros poblados:
 *     workerUids ∩ roles ∩ projectIds ∩ trainingCodes
 *   - Workers inactivos siempre excluidos
 */
export function resolveAudience(
  audience: DocumentAudience,
  workers: WorkerForRead[],
): WorkerForRead[] {
  const activeWorkers = workers.filter((w) => w.isActive);
  if (audience.allWorkers) return activeWorkers;

  return activeWorkers.filter((w) => {
    if (audience.workerUids && audience.workerUids.length > 0) {
      if (!audience.workerUids.includes(w.uid)) return false;
    }
    if (audience.roles && audience.roles.length > 0) {
      if (!audience.roles.includes(w.role)) return false;
    }
    if (audience.projectIds && audience.projectIds.length > 0) {
      if (!w.projectIds.some((pid) => audience.projectIds!.includes(pid))) return false;
    }
    if (audience.trainingCodes && audience.trainingCodes.length > 0) {
      const hasAny = audience.trainingCodes.some((t) =>
        w.activeTrainings.includes(t),
      );
      if (!hasAny) return false;
    }
    return true;
  });
}

// ────────────────────────────────────────────────────────────────────────
// Receipt generation + status
// ────────────────────────────────────────────────────────────────────────

export function buildInitialReceipts(
  doc: DocumentForRead,
  audience: WorkerForRead[],
): ReadReceipt[] {
  const deadline = computeDeadline(doc.publishedAt, doc.readDeadlineDays);
  return audience.map((w) => ({
    documentId: doc.id,
    documentVersion: doc.version,
    workerUid: w.uid,
    acknowledgedAt: null,
    deadlineAt: deadline,
    status: 'pending',
  }));
}

export function computeDeadline(publishedAt: string, deadlineDays: number): string {
  const t = Date.parse(publishedAt) + deadlineDays * 86_400_000;
  return new Date(t).toISOString();
}

export function deriveStatus(
  receipt: Pick<ReadReceipt, 'acknowledgedAt' | 'deadlineAt'>,
  now: Date = new Date(),
): ReadReceiptStatus {
  if (receipt.acknowledgedAt) return 'acknowledged';
  return Date.parse(receipt.deadlineAt) < now.getTime() ? 'overdue' : 'pending';
}

/**
 * Marca el receipt como acknowledged. Idempotente: si ya estaba ack,
 * mantiene el timestamp original (no se "renueva" la lectura).
 */
export function acknowledgeReceipt(
  receipt: ReadReceipt,
  ackedAt: string = new Date().toISOString(),
): ReadReceipt {
  if (receipt.acknowledgedAt) return receipt;
  return {
    ...receipt,
    acknowledgedAt: ackedAt,
    status: 'acknowledged',
  };
}

// ────────────────────────────────────────────────────────────────────────
// Aggregations — útiles para semáforo F.2 y bandeja prevencionista F.8
// ────────────────────────────────────────────────────────────────────────

export interface ReceiptSummary {
  documentId: string;
  documentVersion: number;
  totalAudience: number;
  acknowledged: number;
  pending: number;
  overdue: number;
  coveragePercent: number;
}

export function summarizeReceipts(
  doc: DocumentForRead,
  receipts: ReadReceipt[],
  now: Date = new Date(),
): ReceiptSummary {
  const relevant = receipts.filter(
    (r) => r.documentId === doc.id && r.documentVersion === doc.version,
  );
  let acknowledged = 0;
  let pending = 0;
  let overdue = 0;
  for (const r of relevant) {
    const status = deriveStatus(r, now);
    if (status === 'acknowledged') acknowledged += 1;
    else if (status === 'overdue') overdue += 1;
    else pending += 1;
  }
  return {
    documentId: doc.id,
    documentVersion: doc.version,
    totalAudience: relevant.length,
    acknowledged,
    pending,
    overdue,
    coveragePercent:
      relevant.length === 0 ? 100 : Math.round((acknowledged / relevant.length) * 100),
  };
}

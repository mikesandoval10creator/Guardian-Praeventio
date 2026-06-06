// Praeventio Guard — Sprint 39 Fase G.12: Conteo de evacuación con QR.
//
// Cierra: Documento usuario "Recomendaciones nuevas §79, §80, §81"
//         Plan integral Top 15 #11
//
// Cuando se activa evacuación:
//   1. Se publica drill/event con `expectedWorkers` (todos los activos en
//      la faena al momento)
//   2. Trabajadores llegan a punto de encuentro y escanean QR
//   3. Sistema lista quién falta + muestra última ubicación conocida
//
// Crítico en emergencias reales.

export interface EvacuationDrill {
  id: string;
  projectId: string;
  /** Tipo: simulacro vs emergencia real. */
  kind: 'drill' | 'real';
  startedAt: string;
  startedByUid: string;
  /** Punto de encuentro principal. */
  meetingPointId: string;
  /** Workers que se esperan presentes. */
  expectedWorkers: Array<{
    uid: string;
    fullName: string;
    lastKnownLocation?: { lat: number; lng: number; at: string };
  }>;
  /** Escaneos recibidos en orden cronológico. */
  scans: EvacuationScan[];
  /** Cuando se da por terminada. */
  endedAt?: string;
}

export interface EvacuationScan {
  workerUid: string;
  scannedAt: string;
  meetingPointId: string;
  /** Quién escaneó el QR (puede ser self o supervisor por el worker). */
  scannedByUid: string;
}

export interface EvacuationStatus {
  /** Workers que ya fueron registrados como seguros. */
  safe: Array<{ uid: string; fullName: string; scannedAt: string }>;
  /** Workers no registrados todavía. */
  missing: Array<{ uid: string; fullName: string; lastKnownLocation?: { lat: number; lng: number; at: string } }>;
  /** % de cobertura (safe / expected). */
  coveragePercent: number;
  /** Tiempo desde inicio del drill (segundos). */
  elapsedSec: number;
  /** Indica si todos están seguros (drill puede terminar). */
  isComplete: boolean;
}

export function computeStatus(
  drill: EvacuationDrill,
  now: Date = new Date(),
): EvacuationStatus {
  const safeUids = new Set(drill.scans.map((s) => s.workerUid));
  const safe = drill.expectedWorkers
    .filter((w) => safeUids.has(w.uid))
    .map((w) => {
      const scan = drill.scans.find((s) => s.workerUid === w.uid)!;
      return { uid: w.uid, fullName: w.fullName, scannedAt: scan.scannedAt };
    });
  const missing = drill.expectedWorkers
    .filter((w) => !safeUids.has(w.uid))
    .map((w) => ({
      uid: w.uid,
      fullName: w.fullName,
      lastKnownLocation: w.lastKnownLocation,
    }));
  const elapsedSec = Math.floor((now.getTime() - Date.parse(drill.startedAt)) / 1000);
  const coverage =
    drill.expectedWorkers.length === 0
      ? 100
      : Math.round((safe.length / drill.expectedWorkers.length) * 100);
  return {
    safe,
    missing,
    coveragePercent: coverage,
    elapsedSec,
    isComplete: missing.length === 0,
  };
}

export function recordScan(
  drill: EvacuationDrill,
  scan: Omit<EvacuationScan, 'scannedAt'> & { scannedAt?: string },
): EvacuationDrill {
  const scannedAt = scan.scannedAt ?? new Date().toISOString();
  // Idempotente: si el worker ya escaneó, mantenemos el PRIMER scan
  // (timestamp original es legalmente relevante).
  if (drill.scans.some((s) => s.workerUid === scan.workerUid)) return drill;
  return {
    ...drill,
    scans: [
      ...drill.scans,
      {
        workerUid: scan.workerUid,
        scannedAt,
        meetingPointId: scan.meetingPointId,
        scannedByUid: scan.scannedByUid,
      },
    ],
  };
}

export function endDrill(
  drill: EvacuationDrill,
  endedAt: string = new Date().toISOString(),
): EvacuationDrill {
  return { ...drill, endedAt };
}

/**
 * Build postmortem básico (Top 15 §81): qué pasó, tiempos, brechas.
 */
export interface EvacuationPostmortem {
  drillId: string;
  kind: 'drill' | 'real';
  totalExpected: number;
  totalSafe: number;
  finalCoveragePercent: number;
  totalElapsedSec: number;
  missingWorkers: Array<{ uid: string; fullName: string }>;
  averageTimeToScanSec: number;
}

export function buildPostmortem(drill: EvacuationDrill): EvacuationPostmortem {
  const expectedCount = drill.expectedWorkers.length;
  const safeUids = new Set(drill.scans.map((s) => s.workerUid));
  const missingWorkers = drill.expectedWorkers
    .filter((w) => !safeUids.has(w.uid))
    .map((w) => ({ uid: w.uid, fullName: w.fullName }));
  // totalSafe counts UNIQUE workers who scanned in — a re-scan by the same
  // worker (or a duplicate event) must not inflate the headcount.
  const safeCount = safeUids.size;
  // Coverage is the % of EXPECTED workers accounted for. Basing it on
  // expected-minus-missing (NOT the raw scan count) guarantees it can never
  // exceed 100% even if non-expected people (visitors) scan in or a worker
  // re-scans — a coverage > 100% was nonsensical and misled drill reports.
  const expectedAccounted = expectedCount - missingWorkers.length;

  const startMs = Date.parse(drill.startedAt);
  const totalElapsedSec = drill.endedAt
    ? Math.floor((Date.parse(drill.endedAt) - startMs) / 1000)
    : 0;
  const scanTimesSec = drill.scans.map(
    (s) => (Date.parse(s.scannedAt) - startMs) / 1000,
  );
  const averageTimeToScanSec =
    scanTimesSec.length === 0
      ? 0
      : Math.round(scanTimesSec.reduce((a, b) => a + b, 0) / scanTimesSec.length);

  return {
    drillId: drill.id,
    kind: drill.kind,
    totalExpected: expectedCount,
    totalSafe: safeCount,
    finalCoveragePercent:
      expectedCount === 0 ? 100 : Math.round((expectedAccounted / expectedCount) * 100),
    totalElapsedSec,
    missingWorkers,
    averageTimeToScanSec,
  };
}

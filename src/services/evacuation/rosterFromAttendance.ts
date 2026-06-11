// Praeventio Guard — Phase 5 arista C1: asistencia ⇄ evacuación.
//
// Motor PURO (sin Firestore, sin side effects, determinista) que convierte
// los registros de asistencia de HOY — los que escribe
// `src/pages/Attendance.tsx` en `projects/{projectId}/attendance` con shape
// { workerId, workerName, type: 'Check-In'|'Check-Out', timestamp(ISO),
//   location, projectId } — más los escaneos QR del punto de encuentro, en
// la lista NOMINAL de evacuación:
//
//   expected = quienes registraron ingreso HOY sin salida posterior
//              (eventos con timestamp > now se ignoran: un check-out
//              DESPUÉS de iniciada la emergencia no saca a nadie de la
//              nómina — esa persona estaba en faena cuando empezó).
//   safe     = escaneados en el punto de encuentro. Un scan de alguien que
//              no marcó ingreso cuenta como safe igual, con flag
//              `unexpected: true` (visita / error de registro — está vivo,
//              eso es lo que importa).
//   missing  = expected − safe, con última ubicación conocida si existe.
//
// En emergencia real esta diferencia ("¿cuántos faltan?" → "QUIÉN falta y
// dónde se le vio") son los minutos de un rescate.

export interface AttendanceRecord {
  workerId: string;
  workerName?: string;
  /** 'Check-In' | 'Check-Out' tal como los escribe Attendance.tsx. */
  type: string;
  /** ISO 8601 (Attendance.tsx escribe `new Date().toISOString()`). */
  timestamp: string;
  /** Etiqueta humana del punto de marcaje, p. ej. 'Torniquete Principal'. */
  location?: string;
  /** Coordenadas si el dispositivo de marcaje las registró. */
  lastKnownLocation?: { lat: number; lng: number; at: string };
}

export interface RosterScan {
  workerUid: string;
  /** ISO 8601 del escaneo en el punto de encuentro. */
  scannedAt: string;
}

export interface RosterWorker {
  uid: string;
  fullName: string;
  lastKnownLocation?: { lat: number; lng: number; at: string };
  /** Etiqueta humana del último punto de marcaje conocido. */
  lastKnownLocationLabel?: string;
  /** Presente solo en `safe`: hora del scan en el punto de encuentro. */
  scannedAt?: string;
  /** Escaneado sin haber registrado ingreso hoy (visita / registro faltante). */
  unexpected?: boolean;
}

export interface EvacuationRoster {
  expected: RosterWorker[];
  safe: RosterWorker[];
  missing: RosterWorker[];
}

interface WorkerAccumulator {
  uid: string;
  fullName?: string;
  lastEventType?: string;
  lastEventMs: number;
  lastKnownLocation?: { lat: number; lng: number; at: string };
  lastKnownLocationMs: number;
  lastKnownLocationLabel?: string;
  lastKnownLocationLabelMs: number;
}

function isSameLocalDay(date: Date, now: Date): boolean {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function compareByName(a: RosterWorker, b: RosterWorker): number {
  return a.fullName.localeCompare(b.fullName, 'es') || a.uid.localeCompare(b.uid);
}

export function buildEvacuationRoster(
  attendanceRecords: ReadonlyArray<AttendanceRecord>,
  scans: ReadonlyArray<RosterScan>,
  now: Date = new Date(),
): EvacuationRoster {
  const nowMs = now.getTime();

  // ── 1. Plegar los registros válidos de HOY (≤ now) por trabajador ──────
  const byWorker = new Map<string, WorkerAccumulator>();
  for (const record of attendanceRecords) {
    if (!record || typeof record.workerId !== 'string' || record.workerId.length === 0) continue;
    if (typeof record.timestamp !== 'string') continue;
    const eventDate = new Date(record.timestamp);
    const eventMs = eventDate.getTime();
    if (Number.isNaN(eventMs)) continue;
    if (eventMs > nowMs) continue; // evento posterior al inicio del conteo
    if (!isSameLocalDay(eventDate, now)) continue; // solo asistencia de HOY

    let acc = byWorker.get(record.workerId);
    if (!acc) {
      acc = {
        uid: record.workerId,
        lastEventMs: -Infinity,
        lastKnownLocationMs: -Infinity,
        lastKnownLocationLabelMs: -Infinity,
      };
      byWorker.set(record.workerId, acc);
    }
    if (eventMs >= acc.lastEventMs) {
      acc.lastEventMs = eventMs;
      acc.lastEventType = record.type;
      if (record.workerName) acc.fullName = record.workerName;
    } else if (!acc.fullName && record.workerName) {
      acc.fullName = record.workerName;
    }
    if (record.lastKnownLocation && eventMs >= acc.lastKnownLocationMs) {
      acc.lastKnownLocationMs = eventMs;
      acc.lastKnownLocation = record.lastKnownLocation;
    }
    if (record.location && eventMs >= acc.lastKnownLocationLabelMs) {
      acc.lastKnownLocationLabelMs = eventMs;
      acc.lastKnownLocationLabel = record.location;
    }
  }

  const toRosterWorker = (acc: WorkerAccumulator): RosterWorker => ({
    uid: acc.uid,
    fullName: acc.fullName ?? acc.uid,
    ...(acc.lastKnownLocation ? { lastKnownLocation: acc.lastKnownLocation } : {}),
    ...(acc.lastKnownLocationLabel
      ? { lastKnownLocationLabel: acc.lastKnownLocationLabel }
      : {}),
  });

  // expected = último evento de hoy fue un ingreso (doble check-in cuenta una vez).
  const expected = [...byWorker.values()]
    .filter((acc) => acc.lastEventType === 'Check-In')
    .map(toRosterWorker)
    .sort(compareByName);
  const expectedByUid = new Map(expected.map((w) => [w.uid, w]));

  // ── 2. Scans: dedupe conservando el PRIMER scan (timestamp legal) ──────
  const firstScanByUid = new Map<string, RosterScan>();
  for (const scan of scans) {
    if (!scan || typeof scan.workerUid !== 'string' || scan.workerUid.length === 0) continue;
    if (!firstScanByUid.has(scan.workerUid)) firstScanByUid.set(scan.workerUid, scan);
  }

  const safe: RosterWorker[] = [...firstScanByUid.values()]
    .map((scan) => {
      const fromExpected = expectedByUid.get(scan.workerUid);
      if (fromExpected) {
        return { ...fromExpected, scannedAt: scan.scannedAt };
      }
      // No registró ingreso hoy: cuenta como seguro IGUAL (está vivo en el
      // punto de encuentro), pero marcado para que el supervisor lo audite.
      const fromAttendance = byWorker.get(scan.workerUid);
      return {
        ...(fromAttendance
          ? toRosterWorker(fromAttendance)
          : { uid: scan.workerUid, fullName: scan.workerUid }),
        scannedAt: scan.scannedAt,
        unexpected: true,
      };
    })
    .sort(
      (a, b) =>
        (a.scannedAt ?? '').localeCompare(b.scannedAt ?? '') ||
        a.uid.localeCompare(b.uid),
    );

  const missing = expected.filter((w) => !firstScanByUid.has(w.uid));

  return { expected, safe, missing };
}

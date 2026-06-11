// Praeventio Guard — Phase 5 arista C1 (asistencia ⇄ evacuación).
//
// Motor puro: a partir de los registros de asistencia de HOY
// (`projects/{projectId}/attendance`, escritos por src/pages/Attendance.tsx)
// y de los escaneos QR del punto de encuentro, construye la lista NOMINAL
// { expected, safe, missing } que convierte el headcount de "¿cuántos
// deberían estar?" en "QUIÉN falta, con nombre y última ubicación conocida".
//
// Determinista, sin side effects — los timestamps de prueba se construyen
// con el constructor LOCAL de Date para que la suite sea timezone-safe.

import { describe, it, expect } from 'vitest';
import {
  buildEvacuationRoster,
  type AttendanceRecord,
} from './rosterFromAttendance.js';

/** Local-time ISO builder — same calendar day regardless of runner TZ. */
function iso(hour: number, minute = 0, dayOffset = 0): string {
  return new Date(2026, 5, 11 + dayOffset, hour, minute, 0).toISOString();
}

// Drill / "now" at 10:00 local on 2026-06-11.
const NOW = new Date(2026, 5, 11, 10, 0, 0);

function rec(over: Partial<AttendanceRecord> & { workerId: string }): AttendanceRecord {
  return {
    workerName: `Nombre ${over.workerId}`,
    type: 'Check-In',
    timestamp: iso(8),
    location: 'Torniquete Principal',
    ...over,
  };
}

describe('buildEvacuationRoster — expected (asistencia de hoy)', () => {
  it('sin registros ni scans → todo vacío', () => {
    const r = buildEvacuationRoster([], [], NOW);
    expect(r.expected).toEqual([]);
    expect(r.safe).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('check-in de hoy sin salida → expected y missing nominal con nombre', () => {
    const r = buildEvacuationRoster(
      [rec({ workerId: 'w1', workerName: 'Ana Soto', timestamp: iso(8) })],
      [],
      NOW,
    );
    expect(r.expected).toHaveLength(1);
    expect(r.expected[0]).toMatchObject({ uid: 'w1', fullName: 'Ana Soto' });
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].fullName).toBe('Ana Soto');
    expect(r.safe).toEqual([]);
  });

  it('check-in + check-out posterior (antes del drill) → NO expected', () => {
    const r = buildEvacuationRoster(
      [
        rec({ workerId: 'w1', timestamp: iso(8), type: 'Check-In' }),
        rec({ workerId: 'w1', timestamp: iso(9), type: 'Check-Out' }),
      ],
      [],
      NOW,
    );
    expect(r.expected).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('salida y re-ingreso (out → in) → expected', () => {
    const r = buildEvacuationRoster(
      [
        rec({ workerId: 'w1', timestamp: iso(7), type: 'Check-In' }),
        rec({ workerId: 'w1', timestamp: iso(8), type: 'Check-Out' }),
        rec({ workerId: 'w1', timestamp: iso(9), type: 'Check-In' }),
      ],
      [],
      NOW,
    );
    expect(r.expected.map((w) => w.uid)).toEqual(['w1']);
  });

  it('doble check-in sin salida → cuenta UNA sola vez', () => {
    const r = buildEvacuationRoster(
      [
        rec({ workerId: 'w1', timestamp: iso(7), type: 'Check-In' }),
        rec({ workerId: 'w1', timestamp: iso(8), type: 'Check-In' }),
      ],
      [],
      NOW,
    );
    expect(r.expected).toHaveLength(1);
    expect(r.missing).toHaveLength(1);
  });

  it('check-in de AYER (sin evento hoy) → no expected', () => {
    const r = buildEvacuationRoster(
      [rec({ workerId: 'w1', timestamp: iso(8, 0, -1) })],
      [],
      NOW,
    );
    expect(r.expected).toEqual([]);
  });

  it('check-out DESPUÉS de iniciado el drill (timestamp > now) se ignora → sigue expected', () => {
    const r = buildEvacuationRoster(
      [
        rec({ workerId: 'w1', timestamp: iso(8), type: 'Check-In' }),
        rec({ workerId: 'w1', timestamp: iso(10, 5), type: 'Check-Out' }), // 10:05 > now 10:00
      ],
      [],
      NOW,
    );
    expect(r.expected.map((w) => w.uid)).toEqual(['w1']);
    expect(r.missing).toHaveLength(1);
  });

  it('check-in posterior a now también se ignora → no expected', () => {
    const r = buildEvacuationRoster(
      [rec({ workerId: 'w1', timestamp: iso(11), type: 'Check-In' })],
      [],
      NOW,
    );
    expect(r.expected).toEqual([]);
  });

  it('registros inválidos (sin workerId / timestamp ilegible) se descartan sin romper', () => {
    const r = buildEvacuationRoster(
      [
        rec({ workerId: '', timestamp: iso(8) }),
        rec({ workerId: 'w1', timestamp: 'no-es-fecha' }),
        rec({ workerId: 'w2', workerName: 'Bruno Díaz', timestamp: iso(8) }),
      ],
      [],
      NOW,
    );
    expect(r.expected.map((w) => w.uid)).toEqual(['w2']);
  });

  it('sin workerName → cae al uid como nombre visible', () => {
    const r = buildEvacuationRoster(
      [{ workerId: 'w9', type: 'Check-In', timestamp: iso(8) }],
      [],
      NOW,
    );
    expect(r.expected[0].fullName).toBe('w9');
  });

  it('propaga lastKnownLocation del registro más reciente que la traiga', () => {
    const loc = { lat: -33.45, lng: -70.66, at: iso(9) };
    const r = buildEvacuationRoster(
      [
        rec({ workerId: 'w1', timestamp: iso(7), type: 'Check-In' }),
        rec({ workerId: 'w1', timestamp: iso(9), type: 'Check-In', lastKnownLocation: loc }),
      ],
      [],
      NOW,
    );
    expect(r.expected[0].lastKnownLocation).toEqual(loc);
    expect(r.missing[0].lastKnownLocation).toEqual(loc);
  });

  it('propaga la etiqueta de ubicación (string) del último registro como lastKnownLocationLabel', () => {
    const r = buildEvacuationRoster(
      [rec({ workerId: 'w1', timestamp: iso(8), location: 'Torniquete Principal' })],
      [],
      NOW,
    );
    expect(r.missing[0].lastKnownLocationLabel).toBe('Torniquete Principal');
  });

  it('ordena expected/missing por nombre (determinista)', () => {
    const r = buildEvacuationRoster(
      [
        rec({ workerId: 'w2', workerName: 'Zoe Rivas', timestamp: iso(8) }),
        rec({ workerId: 'w1', workerName: 'Ana Soto', timestamp: iso(8, 30) }),
      ],
      [],
      NOW,
    );
    expect(r.expected.map((w) => w.fullName)).toEqual(['Ana Soto', 'Zoe Rivas']);
    expect(r.missing.map((w) => w.fullName)).toEqual(['Ana Soto', 'Zoe Rivas']);
  });
});

describe('buildEvacuationRoster — safe vs missing (scans del punto de encuentro)', () => {
  const records = [
    rec({ workerId: 'w1', workerName: 'Ana Soto', timestamp: iso(8) }),
    rec({ workerId: 'w2', workerName: 'Bruno Díaz', timestamp: iso(8, 15) }),
  ];

  it('scan de un expected → pasa a safe (con scannedAt) y sale de missing', () => {
    const r = buildEvacuationRoster(
      records,
      [{ workerUid: 'w1', scannedAt: iso(10, 2) }],
      new Date(2026, 5, 11, 10, 5, 0),
    );
    expect(r.safe).toHaveLength(1);
    expect(r.safe[0]).toMatchObject({ uid: 'w1', fullName: 'Ana Soto', scannedAt: iso(10, 2) });
    expect(r.safe[0].unexpected).toBeUndefined();
    expect(r.missing.map((w) => w.uid)).toEqual(['w2']);
    // expected sigue siendo la nómina completa.
    expect(r.expected).toHaveLength(2);
  });

  it('scan de alguien que NO marcó ingreso → safe igual, con flag unexpected', () => {
    const r = buildEvacuationRoster(
      records,
      [{ workerUid: 'w3', scannedAt: iso(10, 1) }],
      new Date(2026, 5, 11, 10, 5, 0),
    );
    expect(r.safe).toHaveLength(1);
    expect(r.safe[0]).toMatchObject({ uid: 'w3', unexpected: true });
    // No infla expected ni missing.
    expect(r.expected).toHaveLength(2);
    expect(r.missing).toHaveLength(2);
  });

  it('unexpected que sí registró eventos hoy (salió antes) recupera su nombre', () => {
    const r = buildEvacuationRoster(
      [
        ...records,
        rec({ workerId: 'w3', workerName: 'Carla Mena', timestamp: iso(7), type: 'Check-In' }),
        rec({ workerId: 'w3', workerName: 'Carla Mena', timestamp: iso(9), type: 'Check-Out' }),
      ],
      [{ workerUid: 'w3', scannedAt: iso(10, 1) }],
      new Date(2026, 5, 11, 10, 5, 0),
    );
    expect(r.safe[0]).toMatchObject({ uid: 'w3', fullName: 'Carla Mena', unexpected: true });
  });

  it('unexpected sin registro alguno → nombre cae al uid', () => {
    const r = buildEvacuationRoster(
      records,
      [{ workerUid: 'visita-9', scannedAt: iso(10, 1) }],
      new Date(2026, 5, 11, 10, 5, 0),
    );
    expect(r.safe[0].fullName).toBe('visita-9');
  });

  it('scans duplicados del mismo worker → se conserva el PRIMERO (timestamp legal)', () => {
    const r = buildEvacuationRoster(
      records,
      [
        { workerUid: 'w1', scannedAt: iso(10, 1) },
        { workerUid: 'w1', scannedAt: iso(10, 4) },
      ],
      new Date(2026, 5, 11, 10, 5, 0),
    );
    expect(r.safe).toHaveLength(1);
    expect(r.safe[0].scannedAt).toBe(iso(10, 1));
  });

  it('todos escaneados → missing vacío', () => {
    const r = buildEvacuationRoster(
      records,
      [
        { workerUid: 'w1', scannedAt: iso(10, 1) },
        { workerUid: 'w2', scannedAt: iso(10, 2) },
      ],
      new Date(2026, 5, 11, 10, 5, 0),
    );
    expect(r.missing).toEqual([]);
    expect(r.safe.map((w) => w.uid)).toEqual(['w1', 'w2']);
  });

  it('safe ordenado por scannedAt ascendente', () => {
    const r = buildEvacuationRoster(
      records,
      [
        { workerUid: 'w2', scannedAt: iso(10, 1) },
        { workerUid: 'w1', scannedAt: iso(10, 3) },
      ],
      new Date(2026, 5, 11, 10, 5, 0),
    );
    expect(r.safe.map((w) => w.uid)).toEqual(['w2', 'w1']);
  });

  it('es pura: no muta los arreglos de entrada', () => {
    const inputRecords = [
      rec({ workerId: 'w1', timestamp: iso(9) }),
      rec({ workerId: 'w1', timestamp: iso(8) }),
    ];
    const recordsSnapshot = JSON.parse(JSON.stringify(inputRecords));
    const scans = [{ workerUid: 'w1', scannedAt: iso(10, 1) }];
    const scansSnapshot = JSON.parse(JSON.stringify(scans));
    buildEvacuationRoster(inputRecords, scans, NOW);
    expect(inputRecords).toEqual(recordsSnapshot);
    expect(scans).toEqual(scansSnapshot);
  });
});

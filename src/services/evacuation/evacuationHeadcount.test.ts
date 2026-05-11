import { describe, it, expect } from 'vitest';
import {
  computeStatus,
  recordScan,
  endDrill,
  buildPostmortem,
  type EvacuationDrill,
} from './evacuationHeadcount.js';

function drill(over: Partial<EvacuationDrill> = {}): EvacuationDrill {
  return {
    id: 'd1',
    projectId: 'p1',
    kind: 'drill',
    startedAt: '2026-05-11T12:00:00Z',
    startedByUid: 'sup-1',
    meetingPointId: 'mp-1',
    expectedWorkers: [
      { uid: 'w1', fullName: 'Juan' },
      { uid: 'w2', fullName: 'María' },
      { uid: 'w3', fullName: 'Carlos' },
    ],
    scans: [],
    ...over,
  };
}

const NOW = new Date('2026-05-11T12:05:00Z');

describe('computeStatus', () => {
  it('sin scans → 0 safe, todos missing, 0% coverage', () => {
    const s = computeStatus(drill(), NOW);
    expect(s.safe).toHaveLength(0);
    expect(s.missing).toHaveLength(3);
    expect(s.coveragePercent).toBe(0);
    expect(s.isComplete).toBe(false);
  });

  it('escaneo parcial → 1 safe + 2 missing + 33%', () => {
    const d = drill({
      scans: [
        { workerUid: 'w1', scannedAt: '2026-05-11T12:03:00Z', meetingPointId: 'mp-1', scannedByUid: 'w1' },
      ],
    });
    const s = computeStatus(d, NOW);
    expect(s.safe).toHaveLength(1);
    expect(s.missing).toHaveLength(2);
    expect(s.coveragePercent).toBe(33);
    expect(s.isComplete).toBe(false);
  });

  it('todos escanean → 100% + isComplete', () => {
    const d = drill({
      scans: [
        { workerUid: 'w1', scannedAt: '2026-05-11T12:03:00Z', meetingPointId: 'mp-1', scannedByUid: 'w1' },
        { workerUid: 'w2', scannedAt: '2026-05-11T12:04:00Z', meetingPointId: 'mp-1', scannedByUid: 'w2' },
        { workerUid: 'w3', scannedAt: '2026-05-11T12:04:30Z', meetingPointId: 'mp-1', scannedByUid: 'w3' },
      ],
    });
    const s = computeStatus(d, NOW);
    expect(s.coveragePercent).toBe(100);
    expect(s.isComplete).toBe(true);
  });

  it('elapsedSec calcula desde startedAt', () => {
    const s = computeStatus(drill(), NOW);
    expect(s.elapsedSec).toBe(300); // 5 minutos
  });

  it('missing incluye lastKnownLocation cuando existe', () => {
    const d = drill({
      expectedWorkers: [
        {
          uid: 'w1',
          fullName: 'Juan',
          lastKnownLocation: { lat: -33.4, lng: -70.7, at: '2026-05-11T11:55:00Z' },
        },
      ],
    });
    const s = computeStatus(d, NOW);
    expect(s.missing[0].lastKnownLocation?.lat).toBe(-33.4);
  });
});

describe('recordScan', () => {
  it('agrega scan al drill', () => {
    const d = recordScan(drill(), {
      workerUid: 'w1',
      meetingPointId: 'mp-1',
      scannedByUid: 'w1',
      scannedAt: '2026-05-11T12:03:00Z',
    });
    expect(d.scans).toHaveLength(1);
  });

  it('idempotente: re-escaneo del mismo worker no duplica', () => {
    const d1 = recordScan(drill(), {
      workerUid: 'w1',
      meetingPointId: 'mp-1',
      scannedByUid: 'w1',
      scannedAt: '2026-05-11T12:03:00Z',
    });
    const d2 = recordScan(d1, {
      workerUid: 'w1',
      meetingPointId: 'mp-1',
      scannedByUid: 'w1',
      scannedAt: '2026-05-11T12:04:00Z',
    });
    expect(d2.scans).toHaveLength(1);
    expect(d2.scans[0].scannedAt).toBe('2026-05-11T12:03:00Z'); // mantiene primer
  });

  it('soporta scanned by supervisor (no self)', () => {
    const d = recordScan(drill(), {
      workerUid: 'w1',
      meetingPointId: 'mp-1',
      scannedByUid: 'sup-1',
    });
    expect(d.scans[0].scannedByUid).toBe('sup-1');
  });
});

describe('buildPostmortem', () => {
  it('genera postmortem con stats', () => {
    const d = endDrill(
      drill({
        scans: [
          { workerUid: 'w1', scannedAt: '2026-05-11T12:01:00Z', meetingPointId: 'mp-1', scannedByUid: 'w1' },
          { workerUid: 'w2', scannedAt: '2026-05-11T12:02:00Z', meetingPointId: 'mp-1', scannedByUid: 'w2' },
        ],
      }),
      '2026-05-11T12:10:00Z',
    );
    const pm = buildPostmortem(d);
    expect(pm.totalExpected).toBe(3);
    expect(pm.totalSafe).toBe(2);
    expect(pm.finalCoveragePercent).toBe(67); // 2/3
    expect(pm.totalElapsedSec).toBe(600); // 10 minutos
    expect(pm.missingWorkers).toHaveLength(1);
    expect(pm.missingWorkers[0].uid).toBe('w3');
    // average time: w1 a 60s, w2 a 120s → promedio 90
    expect(pm.averageTimeToScanSec).toBe(90);
  });

  it('drill sin scans → 0% + averageTime=0', () => {
    const pm = buildPostmortem(endDrill(drill(), '2026-05-11T12:10:00Z'));
    expect(pm.finalCoveragePercent).toBe(0);
    expect(pm.averageTimeToScanSec).toBe(0);
  });
});

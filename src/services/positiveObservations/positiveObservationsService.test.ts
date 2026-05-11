import { describe, it, expect } from 'vitest';
import {
  computeBalance,
  buildRecognitionStats,
  buildLocationBalance,
  type PositiveObservation,
} from './positiveObservationsService.js';

function pos(over: Partial<PositiveObservation> & { id: string }): PositiveObservation {
  return {
    id: over.id,
    observedWorkerUid: over.observedWorkerUid ?? 'w1',
    observerUid: over.observerUid ?? 'sup1',
    observerRole: 'supervisor',
    kind: over.kind ?? 'safe_behavior',
    description: 'Test',
    observedAt: over.observedAt ?? '2026-05-11T10:00:00Z',
    location: over.location ?? 'sector A',
    shared: over.shared ?? false,
  };
}

describe('computeBalance', () => {
  it('correctiveCount sin positivas → punitive', () => {
    const r = computeBalance({ positiveCount: 0, correctiveCount: 10 });
    expect(r.level).toBe('punitive');
  });

  it('balance saludable 50/50', () => {
    const r = computeBalance({ positiveCount: 5, correctiveCount: 5 });
    expect(r.level).toBe('balanced');
  });

  it('skew positivo (>75%) → positive_skew', () => {
    const r = computeBalance({ positiveCount: 80, correctiveCount: 10 });
    expect(r.level).toBe('positive_skew');
  });

  it('imbalanced <40%', () => {
    const r = computeBalance({ positiveCount: 2, correctiveCount: 10 });
    expect(r.level).toBe('imbalanced');
  });
});

describe('buildRecognitionStats', () => {
  it('agrupa por worker + cuenta por kind', () => {
    const stats = buildRecognitionStats([
      pos({ id: 'a', observedWorkerUid: 'w1', kind: 'safe_behavior' }),
      pos({ id: 'b', observedWorkerUid: 'w1', kind: 'mentoring_action' }),
      pos({ id: 'c', observedWorkerUid: 'w2', kind: 'improvement_idea' }),
    ]);
    expect(stats).toHaveLength(2);
    expect(stats[0].positiveObservationCount).toBe(2);
    expect(stats[0].byKind.safe_behavior).toBe(1);
    expect(stats[0].byKind.mentoring_action).toBe(1);
  });
});

describe('buildLocationBalance', () => {
  it('combina positivos + correctivos por ubicación', () => {
    const r = buildLocationBalance(
      [
        pos({ id: 'a', location: 'sector A' }),
        pos({ id: 'b', location: 'sector A' }),
        pos({ id: 'c', location: 'sector B' }),
      ],
      { 'sector A': 1, 'sector B': 5 },
    );
    const a = r.find((x) => x.location === 'sector A')!;
    const b = r.find((x) => x.location === 'sector B')!;
    expect(a.positiveCount).toBe(2);
    expect(a.correctiveCount).toBe(1);
    expect(b.positiveCount).toBe(1);
    expect(b.correctiveCount).toBe(5);
    expect(b.balance.level).toBe('imbalanced');
  });
});

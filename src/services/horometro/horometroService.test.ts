// [Hy3-audit] Adversarial probes for horometroService.recordReading —
// specifically the `source === 'manual'` regression override path. Resolves
// [Audit-2026-08-31] Horómetro regression — lectura manual no exige nota
// de corrección. Before this fix, the docstring claimed manual readings
// required a `corregir` note, but the implementation only checked `source`
// and skipped the notes check entirely.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordReading,
  HorometroValidationError,
  type RecordReadingInput,
} from './horometroService.js';

type StoredReading = NonNullable<
  Awaited<ReturnType<typeof recordReading>>
> | null;

interface FakeStore {
  latest: number | null;
  saved: Array<Record<string, unknown>>;
  getLatestReading: (q: {
    tenantId: string;
    projectId: string;
    equipmentId: string;
  }) => Promise<{ hours: number } | null>;
  saveReading: (r: Record<string, unknown>) => Promise<void>;
}

function makeFakeStore(initialHours: number | null = null): FakeStore {
  const store: FakeStore = {
    latest: initialHours,
    saved: [],
    async getLatestReading() {
      return store.latest === null ? null : { hours: store.latest };
    },
    async saveReading(r) {
      store.saved.push(r);
      store.latest = Number(r.hours);
    },
  };
  return store;
}

function baseInput(overrides: Partial<RecordReadingInput> = {}): RecordReadingInput {
  return {
    tenantId: 't1',
    projectId: 'p1',
    equipmentId: 'eq1',
    hours: 100,
    source: 'qr_entry',
    reportedByUid: 'u1',
    now: () => new Date('2026-09-19T00:00:00Z'),
    ...overrides,
  };
}

describe('recordReading — source: manual override policy', () => {
  let store: FakeStore;

  beforeEach(() => {
    store = makeFakeStore(120); // pre-existing latest reading
  });

  it('manual regression WITHOUT notes → THROWS HORSE_REGRESSION_MISSING_NOTES (was passing silently)', async () => {
    // New regression: hours < latest, source='manual', no notes.
    // The previous implementation let this pass; the new policy requires
    // a notes string mentioning the override reason.
    await expect(
      recordReading(
        {
          ...baseInput({ hours: 100, source: 'manual' }),
          // no notes
        } as RecordReadingInput,
        store as never,
      ),
    ).rejects.toThrow(/NOTES_REQUIRED|missing_notes|corregir/i);
  });

  it('manual regression WITH notes → 200 + saved with the note', async () => {
    await expect(
      recordReading(
        baseInput({
          hours: 100,
          source: 'manual',
          notes: 'corregir: valor anterior era error de dedo del operador',
        }),
        store as never,
      ),
    ).resolves.toBeTruthy();
    expect(store.saved).toHaveLength(1);
    expect((store.saved[0].reading as Record<string, unknown>).notes).toMatch(/corregir/i);
  });

  it('non-manual (qr_entry) regression WITHOUT notes → still throws HOURS_REGRESSION (regression of old behavior)', async () => {
    // Sanity: the existing regression check for non-manual is unchanged.
    await expect(
      recordReading(
        baseInput({ hours: 100, source: 'qr_entry' }),
        store as never,
      ),
    ).rejects.toThrow(/HOURS_REGRESSION/);
  });

  it('manual regression WITH notes too short (<5 chars after trim) → THROWS', async () => {
    await expect(
      recordReading(
        baseInput({
          hours: 100,
          source: 'manual',
          notes: 'fix', // 3 chars
        }),
        store as never,
      ),
    ).rejects.toThrow(/NOTES_REQUIRED|too short|corregir/i);
  });

  it('manual regression WITH notes mentioning corregir but otherwise empty → 200', async () => {
    // The minimal acceptable override note must contain "corregir" (the
    // operator-recognizable token from the docstring). This matches the
    // compliance trail requirement: any admin override has a paper trail.
    await expect(
      recordReading(
        baseInput({
          hours: 100,
          source: 'manual',
          notes: 'corregir',
        }),
        store as never,
      ),
    ).resolves.toBeTruthy();
  });

  it('non-regression manual reading WITHOUT notes → still passes (no override needed)', async () => {
    store = makeFakeStore(50); // latest is LOWER than new reading
    await expect(
      recordReading(
        baseInput({ hours: 100, source: 'manual' }),
        store as never,
      ),
    ).resolves.toBeTruthy();
    expect(store.saved).toHaveLength(1);
  });
});

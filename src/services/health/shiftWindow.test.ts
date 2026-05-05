// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  ShiftWindowError,
  assertWithinShift,
  isWithinShift,
  clampToShift,
  isTimestampInShift,
  filterSamplesToShift,
  type ShiftWindow,
} from './shiftWindow';

const SHIFT: ShiftWindow = {
  startMs: 1_000_000,
  endMs: 2_000_000,
  projectId: 'p1',
  workerUid: 'w1',
};

describe('ShiftWindow guard (ADR 0010 enforcement)', () => {
  describe('assertWithinShift', () => {
    it('passes for range fully inside shift', () => {
      expect(() => assertWithinShift(SHIFT, 1_500_000, 1_800_000)).not.toThrow();
    });

    it('throws when shift is null (no active shift)', () => {
      expect(() => assertWithinShift(null, 1_500_000, 1_800_000)).toThrow(
        ShiftWindowError,
      );
      expect(() => assertWithinShift(null, 1_500_000, 1_800_000)).toThrow(
        /No active shift/,
      );
    });

    it('throws when range starts before shift', () => {
      expect(() => assertWithinShift(SHIFT, 500_000, 1_500_000)).toThrow(
        /pre-turno/,
      );
    });

    it('throws when range ends after shift', () => {
      expect(() => assertWithinShift(SHIFT, 1_800_000, 2_500_000)).toThrow(
        /post-turno/,
      );
    });

    it('error message references ADR 0010', () => {
      try {
        assertWithinShift(null, 0, 0);
      } catch (e) {
        expect((e as Error).message).toMatch(/ADR 0010/);
      }
    });
  });

  describe('isWithinShift', () => {
    it('returns true for range fully inside', () => {
      expect(isWithinShift(SHIFT, 1_500_000, 1_800_000)).toBe(true);
    });

    it('returns false when shift is null', () => {
      expect(isWithinShift(null, 1_500_000, 1_800_000)).toBe(false);
    });

    it('returns false for pre-shift range', () => {
      expect(isWithinShift(SHIFT, 500_000, 1_500_000)).toBe(false);
    });

    it('returns false for post-shift range', () => {
      expect(isWithinShift(SHIFT, 1_800_000, 2_500_000)).toBe(false);
    });
  });

  describe('clampToShift', () => {
    it('returns full range when already inside', () => {
      expect(clampToShift(SHIFT, 1_500_000, 1_800_000)).toEqual({
        startMs: 1_500_000,
        endMs: 1_800_000,
      });
    });

    it('clamps start to shift start', () => {
      expect(clampToShift(SHIFT, 500_000, 1_500_000)).toEqual({
        startMs: 1_000_000,
        endMs: 1_500_000,
      });
    });

    it('clamps end to shift end', () => {
      expect(clampToShift(SHIFT, 1_500_000, 2_500_000)).toEqual({
        startMs: 1_500_000,
        endMs: 2_000_000,
      });
    });

    it('returns null when range is fully outside (after)', () => {
      expect(clampToShift(SHIFT, 2_500_000, 3_000_000)).toBeNull();
    });

    it('returns null when range is fully outside (before)', () => {
      expect(clampToShift(SHIFT, 0, 500_000)).toBeNull();
    });

    it('returns null when no shift', () => {
      expect(clampToShift(null, 1_500_000, 1_800_000)).toBeNull();
    });
  });

  describe('isTimestampInShift', () => {
    it('returns true for ts inside shift', () => {
      expect(isTimestampInShift(SHIFT, 1_500_000)).toBe(true);
    });

    it('returns true for shift boundaries', () => {
      expect(isTimestampInShift(SHIFT, 1_000_000)).toBe(true);
      expect(isTimestampInShift(SHIFT, 2_000_000)).toBe(true);
    });

    it('returns false outside shift', () => {
      expect(isTimestampInShift(SHIFT, 500_000)).toBe(false);
      expect(isTimestampInShift(SHIFT, 2_500_000)).toBe(false);
    });

    it('returns false when no shift', () => {
      expect(isTimestampInShift(null, 1_500_000)).toBe(false);
    });
  });

  describe('filterSamplesToShift', () => {
    const samples = [
      { timestampMs: 500_000, bpm: 70 },
      { timestampMs: 1_500_000, bpm: 110 },
      { timestampMs: 1_800_000, bpm: 95 },
      { timestampMs: 2_500_000, bpm: 65 },
    ];

    it('keeps only in-shift samples', () => {
      const result = filterSamplesToShift(SHIFT, samples);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.bpm)).toEqual([110, 95]);
    });

    it('returns empty when no shift (privacy default)', () => {
      expect(filterSamplesToShift(null, samples)).toEqual([]);
    });

    it('returns empty when no samples', () => {
      expect(filterSamplesToShift(SHIFT, [])).toEqual([]);
    });
  });
});

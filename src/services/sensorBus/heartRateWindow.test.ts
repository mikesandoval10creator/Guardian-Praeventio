// Praeventio Guard — heartRateWindow pure kernel tests (P0 VIDA).
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  evaluateHeartRateWindow,
  DEFAULT_HR_WINDOW_OPTIONS,
  type HeartRateSample,
} from './heartRateWindow';

const T0 = 1_700_000_000_000;

function s(bpm: number, offsetMs = 0): HeartRateSample {
  return { bpm, atMs: T0 + offsetMs };
}

describe('evaluateHeartRateWindow', () => {
  it('single elevated reading is NOT enough to escalate (info, keeps window)', () => {
    const r = evaluateHeartRateWindow([], s(130), DEFAULT_HR_WINDOW_OPTIONS);
    expect(r.severity).toBe('info');
    expect(r.window).toHaveLength(1);
  });

  it('confirms warning after minConfirmations sustained readings in window', () => {
    let w: HeartRateSample[] = [];
    w = evaluateHeartRateWindow(w, s(130, 0), DEFAULT_HR_WINDOW_OPTIONS).window;
    w = evaluateHeartRateWindow(w, s(132, 10_000), DEFAULT_HR_WINDOW_OPTIONS).window;
    const r = evaluateHeartRateWindow(w, s(135, 20_000), DEFAULT_HR_WINDOW_OPTIONS);
    expect(r.severity).toBe('warning');
    expect(r.window).toHaveLength(3);
  });

  it('single reading at/above critical ceiling escalates immediately', () => {
    const r = evaluateHeartRateWindow([], s(195), DEFAULT_HR_WINDOW_OPTIONS);
    expect(r.severity).toBe('critical');
  });

  it('normal reading resets the window (no escalation, empty window)', () => {
    let w: HeartRateSample[] = [];
    w = evaluateHeartRateWindow(w, s(130, 0), DEFAULT_HR_WINDOW_OPTIONS).window;
    w = evaluateHeartRateWindow(w, s(132, 10_000), DEFAULT_HR_WINDOW_OPTIONS).window;
    const r = evaluateHeartRateWindow(w, s(72, 20_000), DEFAULT_HR_WINDOW_OPTIONS);
    expect(r.severity).toBe('info');
    expect(r.window).toHaveLength(0);
  });

  it('stale readings outside the window are pruned (no false confirmation)', () => {
    // Two readings 30s apart, then a third 90s later: first two are stale.
    let w: HeartRateSample[] = [];
    w = evaluateHeartRateWindow(w, s(130, 0), DEFAULT_HR_WINDOW_OPTIONS).window;
    w = evaluateHeartRateWindow(w, s(132, 30_000), DEFAULT_HR_WINDOW_OPTIONS).window;
    const r = evaluateHeartRateWindow(w, s(135, 120_000), DEFAULT_HR_WINDOW_OPTIONS);
    // Only the newest reading survives → not confirmed → info.
    expect(r.severity).toBe('info');
    expect(r.window).toHaveLength(1);
  });

  it('readings at the boundary of the window count (inclusive cutoff)', () => {
    let w: HeartRateSample[] = [];
    w = evaluateHeartRateWindow(w, s(130, 0), DEFAULT_HR_WINDOW_OPTIONS).window;
    w = evaluateHeartRateWindow(w, s(132, 60_000), DEFAULT_HR_WINDOW_OPTIONS).window;
    const r = evaluateHeartRateWindow(w, s(135, 61_000), DEFAULT_HR_WINDOW_OPTIONS);
    // First reading is exactly at the cutoff → pruned (atMs > cutoff fails).
    // Only two remain → not confirmed.
    expect(r.severity).toBe('info');
    expect(r.window).toHaveLength(2);
  });

  it('custom options are honored (tighter window, lower threshold)', () => {
    const opts = { ...DEFAULT_HR_WINDOW_OPTIONS, windowMs: 10_000, elevatedAboveBpm: 100 };
    let w: HeartRateSample[] = [];
    w = evaluateHeartRateWindow(w, s(110, 0), opts).window;
    w = evaluateHeartRateWindow(w, s(112, 5_000), opts).window;
    const r = evaluateHeartRateWindow(w, s(114, 9_000), opts);
    expect(r.severity).toBe('warning');
  });

  it('exactly at threshold counts as elevated (>=, not >)', () => {
    const opts = { ...DEFAULT_HR_WINDOW_OPTIONS, elevatedAboveBpm: 120 };
    let w: HeartRateSample[] = [];
    w = evaluateHeartRateWindow(w, s(120, 0), opts).window;
    w = evaluateHeartRateWindow(w, s(120, 10_000), opts).window;
    const r = evaluateHeartRateWindow(w, s(120, 20_000), opts);
    expect(r.severity).toBe('warning');
  });
});

// Praeventio Guard — Sprint 12.
//
// Unit tests for the pure helpers in commuteSession.ts. The React hook
// `useCommuteSession` and the Firestore I/O are intentionally NOT exercised
// here — the helpers contain all the logic worth testing (cap, type guard,
// tag-incident decorator) and stay deterministic without mocks.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendCappedSample,
  isCommuteType,
  tagIncidentTipo,
  MAX_SAMPLES,
  _setActiveSessionForTesting,
  getActiveSession,
  type CommuteSample,
} from './commuteSession';

const sample = (t: number): CommuteSample => ({
  lat: -33.4 + t * 0.0001,
  lng: -70.6,
  speedKmh: 60,
  accuracyM: 10,
  timestamp: t,
});

describe('appendCappedSample', () => {
  it('appends below cap', () => {
    const buf: CommuteSample[] = [sample(1)];
    const next = appendCappedSample(buf, sample(2));
    expect(next).toHaveLength(2);
    expect(next[1].timestamp).toBe(2);
  });

  it('returns a new array (referential inequality)', () => {
    const buf: CommuteSample[] = [];
    const next = appendCappedSample(buf, sample(1));
    expect(next).not.toBe(buf);
  });

  it('caps at MAX_SAMPLES (240) by dropping the oldest entry', () => {
    let buf: CommuteSample[] = [];
    for (let i = 0; i < MAX_SAMPLES; i++) buf = appendCappedSample(buf, sample(i));
    expect(buf).toHaveLength(MAX_SAMPLES);
    const next = appendCappedSample(buf, sample(MAX_SAMPLES));
    expect(next).toHaveLength(MAX_SAMPLES);
    expect(next[0].timestamp).toBe(1); // oldest (0) dropped
    expect(next[MAX_SAMPLES - 1].timestamp).toBe(MAX_SAMPLES);
  });

  it('respects a custom cap', () => {
    const buf: CommuteSample[] = [sample(1), sample(2), sample(3)];
    const next = appendCappedSample(buf, sample(4), 3);
    expect(next).toHaveLength(3);
    expect(next.map((s) => s.timestamp)).toEqual([2, 3, 4]);
  });
});

describe('isCommuteType', () => {
  it('accepts the three valid taxonomies', () => {
    expect(isCommuteType('home-to-site')).toBe(true);
    expect(isCommuteType('site-to-home')).toBe(true);
    expect(isCommuteType('between-sites')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isCommuteType('home')).toBe(false);
    expect(isCommuteType('')).toBe(false);
    expect(isCommuteType(null)).toBe(false);
    expect(isCommuteType(undefined)).toBe(false);
    expect(isCommuteType(42)).toBe(false);
  });
});

describe('tagIncidentTipo', () => {
  beforeEach(() => {
    _setActiveSessionForTesting(null);
  });

  it('passes through unchanged when no session active', () => {
    const payload = { projectId: 'proj-A', workerId: 'u1' };
    expect(tagIncidentTipo(payload, null)).toEqual(payload);
  });

  it('passes through unchanged when session belongs to a different project', () => {
    const payload = { projectId: 'proj-A', workerId: 'u1' };
    const tagged = tagIncidentTipo(payload, { projectId: 'proj-B', sessionId: 'cs_1' });
    expect(tagged).toEqual(payload);
    expect((tagged as any).tipo).toBeUndefined();
  });

  it('decorates with tipo:trayecto + sessionId for matching project', () => {
    const payload = { projectId: 'proj-A', workerId: 'u1' };
    const tagged = tagIncidentTipo(payload, { projectId: 'proj-A', sessionId: 'cs_99' });
    expect(tagged).toMatchObject({
      projectId: 'proj-A',
      workerId: 'u1',
      tipo: 'trayecto',
      commuteSessionId: 'cs_99',
    });
  });
});

describe('module-level active session', () => {
  it('roundtrips via the test setter', () => {
    expect(getActiveSession()).toBeNull();
    _setActiveSessionForTesting({ projectId: 'p', sessionId: 's' });
    expect(getActiveSession()).toEqual({ projectId: 'p', sessionId: 's' });
    _setActiveSessionForTesting(null);
    expect(getActiveSession()).toBeNull();
  });
});

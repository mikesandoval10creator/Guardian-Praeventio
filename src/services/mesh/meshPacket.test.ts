// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  buildPacket,
  computePacketId,
  isPacketAlive,
  shouldRelay,
  applyHop,
  comparePackets,
  isSamePacket,
  packetBelongsToProject,
  isSos,
  isFileRequest,
  isGpsBreadcrumb,
  DEFAULT_TTL_BY_TYPE,
  DEFAULT_LIFETIME_MS_BY_TYPE,
  DEFAULT_PRIORITY_BY_TYPE,
} from './meshPacket';

const NOW = 1_000_000_000;

const samplePayload = {
  workerUid: 'w1',
  lat: -33.45,
  lng: -70.66,
  accuracyM: 10,
  capturedAtMs: NOW,
  projectId: 'p1',
};

describe('computePacketId — content-addressed', () => {
  it('returns same hash for same input', () => {
    const a = computePacketId({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      bornAtMs: NOW,
      payload: samplePayload,
    });
    const b = computePacketId({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      bornAtMs: NOW,
      payload: samplePayload,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different bornAtMs → different hash', () => {
    const a = computePacketId({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      bornAtMs: NOW,
      payload: samplePayload,
    });
    const b = computePacketId({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      bornAtMs: NOW + 1,
      payload: samplePayload,
    });
    expect(a).not.toBe(b);
  });
});

describe('buildPacket — defaults', () => {
  it('applies type-defaults for ttl, lifetime, priority', () => {
    const p = buildPacket({
      type: 'sos',
      fromUid: 'w1',
      toUid: 'broadcast',
      payload: { ...samplePayload, triggerReason: 'manual' },
      bornAtMs: NOW,
      projectId: 'p1',
    });
    expect(p.ttl).toBe(DEFAULT_TTL_BY_TYPE.sos);
    expect(p.expiresAtMs).toBe(NOW + DEFAULT_LIFETIME_MS_BY_TYPE.sos);
    expect(p.priority).toBe(DEFAULT_PRIORITY_BY_TYPE.sos);
    expect(p.priority).toBe('sos');
    expect(p.relayedBy).toEqual([]);
    expect(p.hopCount).toBe(0);
  });

  it('respects overrides', () => {
    const p = buildPacket({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      toUid: 'broadcast',
      payload: samplePayload,
      bornAtMs: NOW,
      ttl: 10,
      priority: 'low',
      projectId: 'p1',
    });
    expect(p.ttl).toBe(10);
    expect(p.priority).toBe('low');
  });

  it('id is content-addressed (deterministic)', () => {
    const p1 = buildPacket({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      toUid: 'broadcast',
      payload: samplePayload,
      bornAtMs: NOW,
      projectId: 'p1',
    });
    const p2 = buildPacket({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      toUid: 'broadcast',
      payload: samplePayload,
      bornAtMs: NOW,
      projectId: 'p1',
    });
    expect(p1.id).toBe(p2.id);
    expect(isSamePacket(p1, p2)).toBe(true);
  });
});

describe('isPacketAlive', () => {
  const p = buildPacket({
    type: 'gps_breadcrumb',
    fromUid: 'w1',
    toUid: 'broadcast',
    payload: samplePayload,
    bornAtMs: NOW,
    projectId: 'p1',
  });

  it('alive when ttl > 0 and now < expiresAtMs', () => {
    expect(isPacketAlive(p, { now: () => NOW + 1000 })).toBe(true);
  });

  it('dead when expired', () => {
    expect(isPacketAlive(p, { now: () => NOW + DEFAULT_LIFETIME_MS_BY_TYPE.gps_breadcrumb + 1 })).toBe(false);
  });

  it('dead when ttl=0', () => {
    const dead = { ...p, ttl: 0 };
    expect(isPacketAlive(dead, { now: () => NOW + 1000 })).toBe(false);
  });
});

describe('shouldRelay — loop avoidance', () => {
  const p = buildPacket({
    type: 'gps_breadcrumb',
    fromUid: 'w1',
    toUid: 'broadcast',
    payload: samplePayload,
    bornAtMs: NOW,
    projectId: 'p1',
  });

  it('relays when receiver not in relayedBy', () => {
    expect(shouldRelay(p, 'w2', { now: () => NOW + 1000 })).toBe(true);
  });

  it('does NOT relay when receiver already in relayedBy', () => {
    const seen = { ...p, relayedBy: ['w2'] };
    expect(shouldRelay(seen, 'w2', { now: () => NOW + 1000 })).toBe(false);
  });

  it('does NOT relay packet to its own origin', () => {
    expect(shouldRelay(p, 'w1', { now: () => NOW + 1000 })).toBe(false);
  });

  it('does NOT relay expired packet', () => {
    const expired = { ...p, expiresAtMs: NOW - 1 };
    expect(shouldRelay(expired, 'w2', { now: () => NOW })).toBe(false);
  });

  it('does NOT relay ack when receiver IS the destination', () => {
    const ack = buildPacket({
      type: 'ack',
      fromUid: 'w1',
      toUid: 'w2',
      payload: { ackedPacketId: 'x', confirmedBy: 'w1' },
      bornAtMs: NOW,
    });
    expect(shouldRelay(ack, 'w2', { now: () => NOW + 1000 })).toBe(false);
  });
});

describe('applyHop', () => {
  const p = buildPacket({
    type: 'sos',
    fromUid: 'w1',
    toUid: 'broadcast',
    payload: { ...samplePayload, triggerReason: 'manual' },
    bornAtMs: NOW,
    projectId: 'p1',
  });

  it('decrements ttl, increments hopCount, adds to relayedBy', () => {
    const hopped = applyHop(p, 'w2');
    expect(hopped.ttl).toBe(p.ttl - 1);
    expect(hopped.hopCount).toBe(1);
    expect(hopped.relayedBy).toEqual(['w2']);
    // Original NO se muta
    expect(p.ttl).toBe(DEFAULT_TTL_BY_TYPE.sos);
    expect(p.hopCount).toBe(0);
    expect(p.relayedBy).toEqual([]);
  });

  it('ttl never goes below 0', () => {
    const dead = { ...p, ttl: 0 };
    const hopped = applyHop(dead, 'w2');
    expect(hopped.ttl).toBe(0);
  });

  it('preserves id (content-addressed — relayedBy NOT in ID)', () => {
    const hopped = applyHop(p, 'w2');
    expect(hopped.id).toBe(p.id);
  });
});

describe('comparePackets — priority ordering', () => {
  const buildAt = (priority: 'sos' | 'high' | 'normal' | 'low', bornAt: number) =>
    buildPacket({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      toUid: 'broadcast',
      payload: { ...samplePayload, capturedAtMs: bornAt },
      bornAtMs: bornAt,
      priority,
      projectId: 'p1',
    });

  it('SOS before high', () => {
    const sos = buildAt('sos', NOW);
    const high = buildAt('high', NOW);
    expect(comparePackets(sos, high)).toBeLessThan(0);
  });

  it('high before normal', () => {
    expect(comparePackets(buildAt('high', NOW), buildAt('normal', NOW))).toBeLessThan(0);
  });

  it('within same priority, older first (FIFO)', () => {
    const old = buildAt('high', NOW);
    const newer = buildAt('high', NOW + 1000);
    expect(comparePackets(old, newer)).toBeLessThan(0);
  });

  it('sort respects ordering', () => {
    const arr = [
      buildAt('low', NOW),
      buildAt('sos', NOW + 5000),
      buildAt('normal', NOW + 1000),
      buildAt('high', NOW + 2000),
    ];
    arr.sort(comparePackets);
    expect(arr.map((p) => p.priority)).toEqual(['sos', 'high', 'normal', 'low']);
  });
});

describe('packetBelongsToProject — privacy isolation', () => {
  it('matches when payload.projectId matches', () => {
    const p = buildPacket({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      toUid: 'broadcast',
      payload: { ...samplePayload, projectId: 'p-target' },
      bornAtMs: NOW,
      projectId: 'p-target',
    });
    expect(packetBelongsToProject(p, 'p-target')).toBe(true);
  });

  it('rejects when project mismatch', () => {
    const p = buildPacket({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      toUid: 'broadcast',
      payload: { ...samplePayload, projectId: 'p-other' },
      bornAtMs: NOW,
      projectId: 'p-other',
    });
    expect(packetBelongsToProject(p, 'p-target')).toBe(false);
  });

  it('ack packets always belong (no project scope)', () => {
    const ack = buildPacket({
      type: 'ack',
      fromUid: 'w1',
      toUid: 'w2',
      payload: { ackedPacketId: 'x', confirmedBy: 'w1' },
      bornAtMs: NOW,
    });
    expect(packetBelongsToProject(ack, 'whatever')).toBe(true);
  });
});

describe('Type guards (narrow payload)', () => {
  it('isSos narrows correctly', () => {
    const sos = buildPacket({
      type: 'sos',
      fromUid: 'w1',
      toUid: 'broadcast',
      payload: { ...samplePayload, triggerReason: 'manual' as const },
      bornAtMs: NOW,
      projectId: 'p1',
    });
    expect(isSos(sos)).toBe(true);
    if (isSos(sos)) {
      expect(sos.payload.triggerReason).toBe('manual');
    }
  });

  it('isFileRequest distinct from isGpsBreadcrumb', () => {
    const breadcrumb = buildPacket({
      type: 'gps_breadcrumb',
      fromUid: 'w1',
      toUid: 'broadcast',
      payload: samplePayload,
      bornAtMs: NOW,
      projectId: 'p1',
    });
    expect(isGpsBreadcrumb(breadcrumb)).toBe(true);
    expect(isFileRequest(breadcrumb)).toBe(false);
  });
});

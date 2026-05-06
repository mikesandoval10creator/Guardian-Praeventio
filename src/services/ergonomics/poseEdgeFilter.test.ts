// SPDX-License-Identifier: MIT
//
// Sprint 34 — Cobertura PoseEdgeFilter.

import { describe, it, expect, beforeEach } from 'vitest';
import { PoseEdgeFilter } from './poseEdgeFilter.js';
import type { RebaResult } from './reba';
import type { PoseLandmark } from '../../hooks/useMediaPipePose';
import type { MeshPacket } from '../mesh/meshPacket.js';
import type { EdgeRecommendation } from '../iot/edgeFilter.js';

function makeFakeTransport() {
  const packets: MeshPacket[] = [];
  return {
    packets,
    sendLocal: async (p: MeshPacket) => {
      packets.push(p);
      return { enqueued: true, deliveredTo: ['peer-1'], queued: [] };
    },
  };
}

function fakeLandmarks(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
}

function rebaResult(score: number): RebaResult {
  return {
    scoreA: 0,
    scoreB: 0,
    scoreC: 0,
    activityScore: 0,
    finalScore: score,
    actionLevel:
      score === 1
        ? 'negligible'
        : score <= 3
        ? 'low'
        : score <= 7
        ? 'medium'
        : score <= 10
        ? 'high'
        : 'very_high',
    recommendation: '',
  };
}

describe('PoseEdgeFilter', () => {
  let now = 0;
  let pendingTimers: Array<{ at: number; cb: () => void }> = [];

  const advance = (ms: number) => {
    now += ms;
    const due = pendingTimers.filter((t) => t.at <= now);
    pendingTimers = pendingTimers.filter((t) => t.at > now);
    for (const t of due) t.cb();
  };

  beforeEach(() => {
    now = 1_700_000_000_000;
    pendingTimers = [];
  });

  it('REBA ≥ 11 → fase 1 disparada + recomendacion no-bloqueo con cita', async () => {
    const transport = makeFakeTransport();
    const recs: EdgeRecommendation[] = [];
    const f = new PoseEdgeFilter({
      transport,
      fromUid: 'helmet-cam-1',
      projectId: 'mine-A',
      now: () => now,
      scheduleTimeout: (cb, ms) => pendingTimers.push({ at: now + ms, cb }),
      onRecommendation: (r) => recs.push(r),
    });

    const r = await f.ingestRebaResult(rebaResult(12), {
      deviceId: 'helmet-1',
      landmarks: fakeLandmarks(),
    });
    expect(r).toBe('phase1');
    expect(transport.packets.length).toBe(1);
    expect(transport.packets[0].type).toBe('event_to_supervisor');
    expect(recs[0].blockOperation).toBe(false);
    expect(recs[0].citation).toMatch(/ISO 11226|DS-594/);
  });

  it('REBA < 11 → skipped (no packet, no recomendacion)', async () => {
    const transport = makeFakeTransport();
    const recs: EdgeRecommendation[] = [];
    const f = new PoseEdgeFilter({
      transport,
      fromUid: 'helmet-cam-1',
      now: () => now,
      onRecommendation: (r) => recs.push(r),
    });
    const r = await f.ingestRebaResult(rebaResult(7), { deviceId: 'helmet-1' });
    expect(r).toBe('skipped');
    expect(transport.packets.length).toBe(0);
    expect(recs.length).toBe(0);
  });

  it('phase 2 frame con landmarks despachado tras delay', async () => {
    const transport = makeFakeTransport();
    const f = new PoseEdgeFilter({
      transport,
      fromUid: 'helmet-cam-1',
      now: () => now,
      phase2DelayMs: 30_000,
      scheduleTimeout: (cb, ms) => pendingTimers.push({ at: now + ms, cb }),
    });
    await f.ingestRebaResult(rebaResult(13), {
      deviceId: 'helmet-1',
      landmarks: fakeLandmarks(),
    });
    expect(transport.packets.length).toBe(1);
    advance(31_000);
    expect(transport.packets.length).toBe(2);
    const phase2 = transport.packets[1];
    const payload = phase2.payload as {
      poseEvidence?: { frame?: { landmarks?: PoseLandmark[] } };
    };
    expect(payload.poseEvidence?.frame?.landmarks?.length).toBe(33);
  });
});

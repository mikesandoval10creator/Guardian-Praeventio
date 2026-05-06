// SPDX-License-Identifier: MIT
//
// Sprint 34 — Cobertura del EdgeFilter (2-fase + 90% drop ratio).

import { describe, it, expect, beforeEach } from 'vitest';
import { EdgeFilter, type EdgeRecommendation } from './edgeFilter.js';
import type { TelemetrySample } from './types.js';
import type { MeshPacket } from '../mesh/meshPacket.js';

interface FakeTransportCalls {
  packets: MeshPacket[];
}

function makeFakeTransport(): FakeTransportCalls & {
  sendLocal: (p: MeshPacket) => Promise<{
    enqueued: boolean;
    deliveredTo: string[];
    queued: string[];
  }>;
} {
  const calls: FakeTransportCalls = { packets: [] };
  return {
    ...calls,
    sendLocal: async (packet: MeshPacket) => {
      calls.packets.push(packet);
      return { enqueued: true, deliveredTo: ['peer-1'], queued: [] };
    },
  };
}

function criticalSample(t: number): TelemetrySample {
  return {
    deviceId: 'gas-01',
    timestamp: t,
    metric: 'gas_co_ppm',
    value: 75,
    unit: 'ppm',
    kind: 'gas-sensor',
  };
}

function warningSample(t: number): TelemetrySample {
  return {
    deviceId: 'gas-01',
    timestamp: t,
    metric: 'gas_co_ppm',
    value: 30,
    unit: 'ppm',
    kind: 'gas-sensor',
  };
}

function normalSample(t: number): TelemetrySample {
  return {
    deviceId: 'gas-01',
    timestamp: t,
    metric: 'gas_co_ppm',
    value: 5,
    unit: 'ppm',
    kind: 'gas-sensor',
  };
}

describe('EdgeFilter', () => {
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

  function makeFilter(opts: Partial<Parameters<typeof newFilter>[0]> = {}) {
    return newFilter(opts);
  }
  function newFilter(opts: {
    transport?: ReturnType<typeof makeFakeTransport>;
    onRecommendation?: (r: EdgeRecommendation) => void;
  }) {
    const transport = opts.transport ?? makeFakeTransport();
    const filter = new EdgeFilter({
      transport,
      fromUid: 'edge-node-1',
      projectId: 'mine-A',
      now: () => now,
      scheduleTimeout: (cb, ms) => {
        pendingTimers.push({ at: now + ms, cb });
      },
      onRecommendation: opts.onRecommendation,
    });
    return { filter, transport };
  }

  it('critical sample → phase 1 dispatched immediately', async () => {
    const { filter, transport } = newFilter({});
    const result = await filter.ingestSample(criticalSample(now));
    expect(result.severity).toBe('critical');
    expect(result.action).toBe('phase1');
    expect(transport.packets.length).toBe(1);
    expect(transport.packets[0].type).toBe('sos');
    expect(transport.packets[0].priority).toBe('sos');
  });

  it('warning sample → aggregated, not sent until 60s window', async () => {
    const { filter, transport } = newFilter({});
    // 5 warnings dentro de los primeros 30s — todos agregan, ninguno sale.
    for (let i = 0; i < 5; i++) {
      await filter.ingestSample(warningSample(now));
      now += 5_000;
    }
    expect(transport.packets.length).toBe(0);

    // Cruzamos el bucket 60s — el siguiente warning debe disparar el packet.
    now += 40_000;
    await filter.ingestSample(warningSample(now));
    expect(transport.packets.length).toBe(1);
    expect(transport.packets[0].type).toBe('event_to_supervisor');
    expect(transport.packets[0].priority).toBe('high');
  });

  it('normal sample → discarded (no packet) salvo heartbeat', async () => {
    const { filter, transport } = newFilter({});
    for (let i = 0; i < 10; i++) {
      const r = await filter.ingestSample(normalSample(now));
      expect(['heartbeat', 'discarded']).toContain(r.action);
      now += 1_000;
    }
    // No deberian haberse despachado packets — heartbeat no envia mesh.
    expect(transport.packets.length).toBe(0);
  });

  it('phase 2 fires after delay with context window', async () => {
    const { filter, transport } = newFilter({});
    // Primero, un poco de contexto.
    for (let i = 0; i < 3; i++) {
      await filter.ingestSample(normalSample(now));
      now += 1_000;
    }
    // Anomalia critica.
    await filter.ingestSample(criticalSample(now));
    expect(transport.packets.length).toBe(1);

    // Avanza el reloj y dispara los timers — Fase 2 debe salir.
    advance(31_000);

    expect(transport.packets.length).toBe(2);
    const phase2 = transport.packets[1];
    const payload = phase2.payload as { edgeContext?: { window?: TelemetrySample[] } };
    expect(payload.edgeContext?.window?.length ?? 0).toBeGreaterThan(0);
  });

  it('100 samples → ≥90% dropped or aggregated (1 packet/min worst case)', async () => {
    const { filter, transport } = newFilter({});
    // 100 samples warning a 1Hz — solo deberian salir ~2 packets max (60s buckets).
    for (let i = 0; i < 100; i++) {
      await filter.ingestSample(warningSample(now));
      now += 1_000; // 1 sample por segundo → 100s totales
    }
    // 100s / 60s = ~1-2 packets. Eso es ≥98% drop.
    expect(transport.packets.length).toBeLessThanOrEqual(10);
    const ratio = 1 - transport.packets.length / 100;
    expect(ratio).toBeGreaterThanOrEqual(0.9);

    const snap = filter.getMetricsSnapshot();
    expect(snap.ingested).toBe(100);
    // aggregated + dropped + phase1 ≈ 100
    expect(snap.aggregated + snap.phase1Sent).toBeGreaterThan(0);
  });

  it('recommendation always carries blockOperation: false + cita normativa', async () => {
    const recs: EdgeRecommendation[] = [];
    const { filter } = newFilter({
      onRecommendation: (r) => recs.push(r),
    });
    await filter.ingestSample(criticalSample(now));
    expect(recs.length).toBe(1);
    const rec = recs[0];
    expect(rec.blockOperation).toBe(false);
    expect(rec.citation.length).toBeGreaterThan(0);
    expect(rec.citation).toMatch(/DS-594|ISO|NIOSH|OSHA/i);
    expect(rec.severity).toBe('high');
  });
});

// Sprint 39 J3b — Phase 2 packet enrichment with EONET / USGS correlations.

import { describe, it, expect } from 'vitest';
import { EdgeFilter, type EdgeContextPacket, type EdgeAnomaly } from './edgeFilter.js';
import type { MeshPacket } from '../mesh/meshPacket.js';
import type { EonetEvent } from '../external/eonet/types.js';
import type { UsgsEarthquake } from '../external/usgs/types.js';

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
    sendLocal: async (p: MeshPacket) => {
      calls.packets.push(p);
      return { enqueued: true, deliveredTo: ['peer-1'], queued: [] };
    },
  };
}

function vibrationAnomaly(): EdgeAnomaly {
  return {
    type: 'iot_anomaly',
    severity: 'critical',
    metric: 'vibration_g',
    value: 4.2,
    unit: 'g',
    deviceId: 'dev-1',
    timestamp: 1_700_000_000_000,
    location: { lat: -33.45, lng: -70.66 },
    label: 'Vibration spike',
  };
}

function eonetWildfireNearby(): EonetEvent {
  return {
    id: 'EONET_X',
    title: 'Wildfire',
    description: null,
    closed: null,
    categories: [{ id: 'wildfires', title: 'Wildfires' }],
    sources: [],
    geometry: [{ date: '2026-05-01T00:00:00Z', type: 'Point', coordinates: [-70.6, -33.5] }],
  };
}

function usgsM4(): UsgsEarthquake {
  return {
    type: 'Feature',
    id: 'usgs_eq_x',
    properties: { mag: 4.2, place: 'Test', time: 1_700_000_000_000 },
    geometry: { type: 'Point', coordinates: [-70.5, -33.5, 10] },
  };
}

function makeFilter(extras: {
  eonetFetch?: () => Promise<EonetEvent[]>;
  usgsFetch?: () => Promise<UsgsEarthquake[]>;
}) {
  const transport = makeFakeTransport();
  const filter = new EdgeFilter({
    transport,
    fromUid: 'edge-1',
    projectId: 'mine-A',
    now: () => 1_700_000_000_000,
    externalAdapters: {
      eonet: extras.eonetFetch
        ? { fetchEvents: extras.eonetFetch }
        : undefined,
      usgs: extras.usgsFetch
        ? { fetchRecentEarthquakes: extras.usgsFetch }
        : undefined,
    },
  });
  return { filter, transport };
}

function lastPhase2Ctx(transport: FakeTransportCalls): EdgeContextPacket | undefined {
  for (let i = transport.packets.length - 1; i >= 0; i--) {
    const payload = transport.packets[i].payload as { edgeContext?: EdgeContextPacket };
    if (payload?.edgeContext) return payload.edgeContext;
  }
  return undefined;
}

describe('EdgeFilter Phase 2 with external correlations', () => {
  it('1) Phase 2 packet includes externalCorrelations when adapters return data', async () => {
    const { filter, transport } = makeFilter({
      eonetFetch: async () => [eonetWildfireNearby()],
      usgsFetch: async () => [usgsM4()],
    });
    await filter.dispatchPhase2(vibrationAnomaly());
    const ctx = lastPhase2Ctx(transport);
    expect(ctx).toBeDefined();
    expect(ctx!.externalCorrelations).toBeDefined();
    expect(ctx!.externalCorrelations!.eonet).toHaveLength(1);
    expect(ctx!.externalCorrelations!.usgs).toHaveLength(1);
  });

  it('2) adapter fetch failure => packet still emitted without correlations (no throw)', async () => {
    const { filter, transport } = makeFilter({
      eonetFetch: async () => {
        throw new Error('upstream 503');
      },
      // no usgs adapter → not vibration cross-checked
    });
    await expect(
      filter.dispatchPhase2(vibrationAnomaly()),
    ).resolves.toBeUndefined();
    // Phase 2 packet must have been sent regardless.
    expect(transport.packets.length).toBeGreaterThan(0);
    const ctx = lastPhase2Ctx(transport);
    expect(ctx).toBeDefined();
    // Correlations omitted when everything failed / empty.
    expect(ctx!.externalCorrelations).toBeUndefined();
  });
});

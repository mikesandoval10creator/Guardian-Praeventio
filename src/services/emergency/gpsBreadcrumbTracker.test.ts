import { describe, it, expect } from 'vitest';
import {
  addBreadcrumb,
  buildMeshBreadcrumbPacket,
  emptyBreadcrumbState,
  getRecentBreadcrumbs,
  type GpsBreadcrumb,
} from './gpsBreadcrumbTracker.js';

const ISO = (ms: number) => new Date(ms).toISOString();

function makeCrumb(
  capturedAtMs: number,
  over: Partial<GpsBreadcrumb> = {},
): GpsBreadcrumb {
  return {
    lat: over.lat ?? -33.45,
    lng: over.lng ?? -70.66,
    accuracyMeters: over.accuracyMeters ?? 10,
    capturedAt: ISO(capturedAtMs),
  };
}

describe('gpsBreadcrumbTracker', () => {
  describe('addBreadcrumb', () => {
    it('agrega un breadcrumb al estado vacío', () => {
      const now = new Date('2026-05-13T12:00:00Z');
      const state = addBreadcrumb(
        emptyBreadcrumbState(),
        makeCrumb(now.getTime()),
        now,
      );
      expect(state.breadcrumbs).toHaveLength(1);
    });

    it('descarta breadcrumbs fuera de la ventana (más viejos)', () => {
      const now = new Date('2026-05-13T12:00:00Z');
      // 90min atrás → fuera de ventana de 60min default
      const old = makeCrumb(now.getTime() - 90 * 60_000);
      const state = addBreadcrumb(emptyBreadcrumbState(), old, now);
      expect(state.breadcrumbs).toHaveLength(0);
    });

    it('respeta ventana custom de 5min', () => {
      const now = new Date('2026-05-13T12:00:00Z');
      const sixMinAgo = makeCrumb(now.getTime() - 6 * 60_000);
      const state = addBreadcrumb(emptyBreadcrumbState(), sixMinAgo, now, {
        windowMinutes: 5,
      });
      expect(state.breadcrumbs).toHaveLength(0);
    });

    it('mantiene orden ascendente por capturedAt', () => {
      const now = new Date('2026-05-13T12:00:00Z');
      let state = emptyBreadcrumbState();
      // Insertar fuera de orden
      state = addBreadcrumb(state, makeCrumb(now.getTime() - 10 * 60_000), now);
      state = addBreadcrumb(state, makeCrumb(now.getTime() - 30 * 60_000), now);
      state = addBreadcrumb(state, makeCrumb(now.getTime() - 5 * 60_000), now);

      const times = state.breadcrumbs.map((b) => Date.parse(b.capturedAt));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it('cap por maxPoints recorta los más viejos', () => {
      const now = new Date('2026-05-13T12:00:00Z');
      let state = emptyBreadcrumbState();
      for (let i = 0; i < 10; i += 1) {
        state = addBreadcrumb(
          state,
          makeCrumb(now.getTime() - (10 - i) * 60_000),
          now,
          { maxPoints: 3 },
        );
      }
      expect(state.breadcrumbs).toHaveLength(3);
      // Los 3 más recientes
      const ages = state.breadcrumbs.map((b) =>
        Math.round((now.getTime() - Date.parse(b.capturedAt)) / 60_000),
      );
      expect(ages).toEqual([3, 2, 1]);
    });
  });

  describe('getRecentBreadcrumbs', () => {
    it('lista solo los que caen en la ventana, sorted asc', () => {
      const now = new Date('2026-05-13T12:00:00Z');
      let state = emptyBreadcrumbState();
      state = addBreadcrumb(state, makeCrumb(now.getTime() - 30 * 60_000), now);
      state = addBreadcrumb(state, makeCrumb(now.getTime() - 5 * 60_000), now);

      const recent = getRecentBreadcrumbs(state, now, { windowMinutes: 10 });
      expect(recent).toHaveLength(1);
      expect(recent[0].capturedAt).toBe(ISO(now.getTime() - 5 * 60_000));
    });

    it('retorna array vacío si no hay breadcrumbs', () => {
      const now = new Date('2026-05-13T12:00:00Z');
      expect(getRecentBreadcrumbs(emptyBreadcrumbState(), now)).toEqual([]);
    });
  });

  describe('buildMeshBreadcrumbPacket', () => {
    it('crea packet de tipo gps_breadcrumb con TTL 3 y priority low', () => {
      const crumb = makeCrumb(Date.parse('2026-05-13T12:00:00Z'));
      const packet = buildMeshBreadcrumbPacket({
        breadcrumb: crumb,
        workerUid: 'worker-1',
        projectId: 'proj-1',
        nowMs: 1_700_000_000_000,
      });
      expect(packet.type).toBe('gps_breadcrumb');
      expect(packet.priority).toBe('low');
      expect(packet.ttl).toBe(3);
      expect(packet.fromUid).toBe('worker-1');
      expect(packet.toUid).toBe('supervisors');
      const payload = packet.payload as {
        workerUid: string;
        lat: number;
        lng: number;
        projectId: string;
      };
      expect(payload.workerUid).toBe('worker-1');
      expect(payload.projectId).toBe('proj-1');
      expect(payload.lat).toBe(crumb.lat);
    });
  });
});

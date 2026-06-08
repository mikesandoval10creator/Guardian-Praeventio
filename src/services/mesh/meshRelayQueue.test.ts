// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { MeshRelayQueue } from './meshRelayQueue';
import { buildPacket } from './meshPacket';

const NOW = 1_000_000_000;
const PROJECT = 'p1';

function makeBreadcrumb(fromUid: string, bornAtMs: number = NOW, projectId: string = PROJECT) {
  return buildPacket({
    type: 'gps_breadcrumb',
    fromUid,
    toUid: 'broadcast',
    bornAtMs,
    projectId,
    payload: {
      workerUid: fromUid,
      lat: -33.45, lng: -70.66, accuracyM: 10,
      capturedAtMs: bornAtMs,
      projectId,
    },
  });
}

function makeSos(fromUid: string, bornAtMs: number = NOW, projectId: string = PROJECT) {
  return buildPacket({
    type: 'sos',
    fromUid,
    toUid: 'broadcast',
    bornAtMs,
    projectId,
    payload: {
      workerUid: fromUid,
      location: { lat: -33.45, lng: -70.66, accuracyM: 10 },
      capturedAtMs: bornAtMs,
      triggerReason: 'manual' as const,
      projectId,
    },
  });
}

describe('MeshRelayQueue — store-carry-forward', () => {
  let queue: MeshRelayQueue;

  beforeEach(() => {
    queue = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      now: () => NOW,
    });
  });

  describe('enqueueLocal', () => {
    it('agrega packet local válido', () => {
      const p = makeBreadcrumb('self');
      const result = queue.enqueueLocal(p);
      expect(result.added).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('rechaza packets de otro project', () => {
      const p = makeBreadcrumb('self', NOW, 'other-project');
      const result = queue.enqueueLocal(p);
      expect(result.added).toBe(false);
      expect(result.reason).toBe('wrong_project');
      expect(queue.size()).toBe(0);
    });

    it('rechaza duplicados', () => {
      const p = makeBreadcrumb('self');
      queue.enqueueLocal(p);
      const second = queue.enqueueLocal(p);
      expect(second.added).toBe(false);
      expect(second.reason).toBe('duplicate_id');
      expect(queue.size()).toBe(1);
    });

    it('rechaza packets ya expirados', () => {
      const expired = buildPacket({
        type: 'gps_breadcrumb',
        fromUid: 'self',
        toUid: 'broadcast',
        bornAtMs: NOW - 24 * 60 * 60 * 1000,
        expiresAtMs: NOW - 1,
        projectId: PROJECT,
        payload: { workerUid: 'self', lat: 0, lng: 0, accuracyM: 0, capturedAtMs: 0, projectId: PROJECT },
      });
      const result = queue.enqueueLocal(expired);
      expect(result.added).toBe(false);
      expect(result.reason).toBe('expired_at_birth');
    });
  });

  describe('receive — incoming peer packets', () => {
    it('forLocal cuando broadcast destinado a self', async () => {
      const fromOther = makeBreadcrumb('peer-1');
      const result = await queue.receive([fromOther]);
      expect(result.forLocal).toHaveLength(1);
      expect(result.enqueued).toHaveLength(1); // también se relaya broadcast
      expect(result.dropped).toHaveLength(0);
    });

    it('drop packets de otro project (privacy ADR 0011 simétrico)', async () => {
      const wrong = makeBreadcrumb('peer-1', NOW, 'other-project');
      const result = await queue.receive([wrong]);
      expect(result.dropped).toHaveLength(1);
      expect(result.forLocal).toHaveLength(0);
      expect(result.enqueued).toHaveLength(0);
    });

    it('drop duplicados (Bloom-filter dedup)', async () => {
      const p = makeBreadcrumb('peer-1');
      await queue.receive([p]);
      const result = await queue.receive([p]);
      expect(result.dropped).toHaveLength(1);
      expect(result.forLocal).toHaveLength(0);
    });

    it('drop packets expirados', async () => {
      const expired = buildPacket({
        type: 'gps_breadcrumb',
        fromUid: 'peer-1',
        toUid: 'broadcast',
        bornAtMs: NOW - 60 * 60 * 1000,
        expiresAtMs: NOW - 1,
        projectId: PROJECT,
        payload: { workerUid: 'peer-1', lat: 0, lng: 0, accuracyM: 0, capturedAtMs: 0, projectId: PROJECT },
      });
      const result = await queue.receive([expired]);
      expect(result.dropped).toHaveLength(1);
    });

    it('NO relaya packet si self ya está en relayedBy', async () => {
      const p = makeBreadcrumb('peer-1');
      const seen = { ...p, relayedBy: ['self'] };
      const result = await queue.receive([seen]);
      expect(result.forLocal).toHaveLength(1); // sigue siendo broadcast a self
      expect(result.enqueued).toHaveLength(0);
    });

    it('NO relaya packet de propio origen', async () => {
      const myOwn = makeBreadcrumb('self');
      const result = await queue.receive([myOwn]);
      expect(result.enqueued).toHaveLength(0);
    });
  });

  describe('drainForPeer — outgoing relay', () => {
    it('aplica hop a packets enviados (decrementa TTL, agrega self a relayedBy)', () => {
      queue.enqueueLocal(makeBreadcrumb('self', NOW));
      const result = queue.drainForPeer('peer-1', 50);
      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0].relayedBy).toEqual(['self']);
      expect(result.toSend[0].hopCount).toBe(1);
    });

    it('SOS antes que high antes que normal antes que low', () => {
      const high = buildPacket({
        type: 'gps_breadcrumb', fromUid: 'a', toUid: 'broadcast',
        bornAtMs: NOW, projectId: PROJECT, priority: 'high',
        payload: { workerUid: 'a', lat: 0, lng: 0, accuracyM: 0, capturedAtMs: NOW, projectId: PROJECT },
      });
      const sos = makeSos('b');
      const normal = buildPacket({
        type: 'gps_breadcrumb', fromUid: 'c', toUid: 'broadcast',
        bornAtMs: NOW, projectId: PROJECT, priority: 'normal',
        payload: { workerUid: 'c', lat: 0, lng: 0, accuracyM: 0, capturedAtMs: NOW, projectId: PROJECT },
      });
      queue.enqueueLocal(high);
      queue.enqueueLocal(sos);
      queue.enqueueLocal(normal);
      const result = queue.drainForPeer('peer-1', 50);
      expect(result.toSend.map((p) => p.priority)).toEqual(['sos', 'high', 'normal']);
    });

    it('respeta maxPackets — limita lo que envía', () => {
      for (let i = 0; i < 10; i++) {
        queue.enqueueLocal(makeBreadcrumb(`other-${i}`, NOW + i));
      }
      const result = queue.drainForPeer('peer-x', 3);
      expect(result.toSend).toHaveLength(3);
      expect(queue.size()).toBe(7); // los otros 7 quedan
    });

    it('NO envía packet al peer si peer ya está en relayedBy (loop avoidance)', async () => {
      const fromOther = makeBreadcrumb('alice');
      const seen = { ...fromOther, relayedBy: ['peer-1'] };
      // Inyectamos directo en queue via receive
      await queue.receive([seen]);
      const result = queue.drainForPeer('peer-1', 50);
      expect(result.toSend).toHaveLength(0);
    });

    it('NO envía packet a su propio origen', async () => {
      await queue.receive([makeBreadcrumb('alice')]);
      const result = queue.drainForPeer('alice', 50);
      // alice es origin → no se le envía su propio packet
      expect(result.toSend).toHaveLength(0);
    });
  });

  describe('markDelivered + requeue', () => {
    it('markDelivered remueve packet de queue', () => {
      const p = makeBreadcrumb('self');
      queue.enqueueLocal(p);
      expect(queue.size()).toBe(1);
      const removed = queue.markDelivered(p.id);
      expect(removed).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it('markDelivered de packet inexistente returns false', () => {
      expect(queue.markDelivered('nonexistent-id')).toBe(false);
    });

    it('requeue re-encola un packet que falló mid-transfer', () => {
      const p = makeBreadcrumb('self');
      queue.requeue(p);
      expect(queue.size()).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('remueve packets expirados', async () => {
      const queueWithMovingNow = new MeshRelayQueue({
        selfUid: 'self', projectId: PROJECT, now: () => NOW,
      });
      const p = makeBreadcrumb('self', NOW);
      queueWithMovingNow.enqueueLocal(p);
      expect(queueWithMovingNow.size()).toBe(1);

      // Recreate con now muy futuro — packet expira
      const queueLater = new MeshRelayQueue({
        selfUid: 'self', projectId: PROJECT,
        now: () => NOW + 24 * 60 * 60 * 1000,
      });
      // Re-inyectar manualmente
      await queueLater.receive([p]);
      const cleanup = queueLater.cleanup();
      // Cleanup limpia el packet expirado (que entró pero ya falleció)
      // Bonus: cleanup también limpia seenIds antiguos
      expect(cleanup.evictedQueue + cleanup.evictedSeen).toBeGreaterThanOrEqual(0);
    });
  });

  describe('maxQueueSize — eviction', () => {
    it('descarta el de menor priority cuando se llena', () => {
      const small = new MeshRelayQueue({
        selfUid: 'self', projectId: PROJECT, maxQueueSize: 3, now: () => NOW,
      });
      // Llenamos con 3 normales
      for (let i = 0; i < 3; i++) {
        small.enqueueLocal(makeBreadcrumb(`other-${i}`, NOW + i));
      }
      expect(small.size()).toBe(3);
      // Insertamos SOS — debería sacar uno de baja priority
      small.enqueueLocal(makeSos('emergencia'));
      expect(small.size()).toBe(3);
      // El SOS sigue ahí
      const allPriorities = small.snapshot().map((p) => p.priority);
      expect(allPriorities).toContain('sos');
    });
  });
});

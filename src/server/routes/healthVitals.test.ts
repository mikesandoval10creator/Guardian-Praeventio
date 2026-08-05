// @vitest-environment node
// Praeventio Guard — vital capability probes del health check (tarea P1).
//
// Cobertura: cada sub-check vital (FCM, Scheduler, MQTT, Mesh, offline,
// geofence, ManDown, wearables, SLM) reporta ok/skipped/fail con semántica
// honesta por entorno: en producción una capacidad vital sin configurar o
// inalcanzable es FAIL (rojo); en dev se reporta skipped.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const sendMock = vi.fn();
  const getMock = vi.fn();
  return { sendMock, getMock };
});

vi.mock('firebase-admin', () => ({
  default: {
    firestore: () => ({
      collection: () => ({ limit: () => ({ get: h.getMock }) }),
    }),
    messaging: () => ({ send: h.sendMock }),
  },
}));

vi.mock('../triggers/criticalAlertOutbox.js', () => ({
  createCriticalAlertOutbox: vi.fn(),
  claimOutboxForDelivery: vi.fn(),
}));
vi.mock('../triggers/systemEngineTrigger.js', () => ({
  setupSystemEngineTrigger: vi.fn(),
}));
vi.mock('../triggers/mqttTelemetryBridge.js', () => ({
  startMqttTelemetryBridge: vi.fn(),
}));
vi.mock('../../services/geofence/permissionUXDecision.js', () => ({
  decidePermissionUX: vi.fn(),
}));
vi.mock('../../services/slm/guardianOffline.js', () => ({
  rankChunks: vi.fn(),
}));

import {
  checkFcmCapability,
  checkSchedulerCapability,
  checkMqttCapability,
  tcpPing,
  checkMeshCapability,
  checkOfflineOutboxCapability,
  checkGeofenceCapability,
  checkManDownCapability,
  checkWearablesCapability,
  checkSlmCapability,
} from './health.js';

describe('vital capability probes', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    h.sendMock.mockReset();
    h.getMock.mockReset().mockResolvedValue({ empty: true });
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('checkSchedulerCapability', () => {
    it('ok cuando hay auth configurada (secret o SA pinnable)', async () => {
      vi.stubEnv('SCHEDULER_SHARED_SECRET', 's3cret');
      await expect(checkSchedulerCapability()).resolves.toBeUndefined();
    });

    it('skipped en dev sin configuración', async () => {
      await expect(checkSchedulerCapability()).resolves.toEqual({
        skipped: true,
      });
    });

    it('FAIL en producción sin configuración (jobs de escalación caídos)', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      await expect(checkSchedulerCapability()).rejects.toThrow(
        'scheduler_auth_not_configured',
      );
    });
  });

  describe('checkMqttCapability', () => {
    it('skipped en dev sin MQTT_BROKER_URL', async () => {
      await expect(checkMqttCapability()).resolves.toEqual({ skipped: true });
    });

    it('FAIL en producción sin broker (telemetría caída)', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      await expect(checkMqttCapability()).rejects.toThrow(
        'mqtt_broker_not_configured',
      );
    });

    it('rechaza URL de broker inválida', async () => {
      vi.stubEnv('MQTT_BROKER_URL', 'not a url');
      await expect(checkMqttCapability()).rejects.toThrow(
        'mqtt_broker_url_invalid',
      );
    });
  });

  describe('tcpPing', () => {
    it('resuelve cuando el puerto acepta conexiones', async () => {
      const net = await import('node:net');
      const server = net.createServer();
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const { port } = server.address() as { port: number };
      try {
        await expect(tcpPing('127.0.0.1', port)).resolves.toBeUndefined();
      } finally {
        server.close();
      }
    });

    it('rechaza con mqtt_broker_unreachable cuando el puerto está cerrado', async () => {
      const net = await import('node:net');
      const server = net.createServer();
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const { port } = server.address() as { port: number };
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await expect(tcpPing('127.0.0.1', port)).rejects.toThrow(
        'mqtt_broker_unreachable',
      );
    });
  });

  describe('checkFcmCapability', () => {
    it('ok cuando FCM rechaza el token inválido (alcanzable)', async () => {
      h.sendMock.mockRejectedValue(new Error('registration-token-not-registered'));
      await expect(checkFcmCapability()).resolves.toBeUndefined();
    });

    it('skipped en dev ante error de credenciales/red', async () => {
      h.sendMock.mockRejectedValue(new Error('messaging/authentication-error'));
      await expect(checkFcmCapability()).resolves.toEqual({ skipped: true });
    });

    it('FAIL en producción ante error de credenciales/red', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      h.sendMock.mockRejectedValue(new Error('messaging/authentication-error'));
      await expect(checkFcmCapability()).rejects.toThrow('fcm_unreachable');
    });
  });

  describe('checks de contrato de módulos (capacidad server)', () => {
    it('mesh ok cuando Firestore responde', async () => {
      await expect(checkMeshCapability()).resolves.toBeUndefined();
    });

    it('mesh FAIL cuando Firestore no responde', async () => {
      h.getMock.mockRejectedValue(new Error('firestore_unreachable'));
      await expect(checkMeshCapability()).rejects.toThrow('firestore_unreachable');
    });

    it('offline ok con exports del outbox presentes', async () => {
      await expect(checkOfflineOutboxCapability()).resolves.toBeUndefined();
    });

    it('geofence ok con motor de decisión presente', async () => {
      await expect(checkGeofenceCapability()).resolves.toBeUndefined();
    });

    it('manDown ok con setupSystemEngineTrigger presente', async () => {
      await expect(checkManDownCapability()).resolves.toBeUndefined();
    });

    it('wearables ok con bridge presente + telemetry_events consultable', async () => {
      await expect(checkWearablesCapability()).resolves.toBeUndefined();
    });

    it('slm ok (skipped) con rankChunks presente', async () => {
      await expect(checkSlmCapability()).resolves.toEqual({ skipped: true });
    });
  });

  describe('contrato roto → FAIL (anti deploy verde falso)', () => {
    it('offline FAIL si un refactor rompe los exports del outbox', async () => {
      // Exports presentes pero NO funciones (contrato roto) — el proxy de
      // vitest no debe lanzar "export missing", sino dejar typeof undefined.
      vi.doMock('../triggers/criticalAlertOutbox.js', () => ({
        createCriticalAlertOutbox: undefined,
        claimOutboxForDelivery: undefined,
      }));
      vi.resetModules();
      const mod = await import('./health.js');
      await expect(mod.checkOfflineOutboxCapability()).rejects.toThrow(
        'offline_outbox_unavailable',
      );
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { runResilienceHealthAlertCron } from './runResilienceHealthAlert.js';
import type { SubsystemChecker } from '../../services/observability/resilienceHealthMonitor.js';

// ────────────────────────────────────────────────────────────────────────
// Minimal Firestore fake (suficiente para .collection().doc().set() y .get())
// ────────────────────────────────────────────────────────────────────────

interface WriteRecord {
  path: string;
  data: unknown;
}

function buildFakeDb(opts: {
  existingAlertIds?: string[];
  failOn?: 'persist' | 'alertCheck' | 'alertMarker';
} = {}) {
  const writes: WriteRecord[] = [];
  const existingAlerts = new Set(opts.existingAlertIds ?? []);

  const db = {
    collection(name: string) {
      return {
        doc(id: string) {
          const path = `${name}/${id}`;
          return {
            async get() {
              if (opts.failOn === 'alertCheck' && name === 'health_alerts') {
                throw new Error('alertCheck-fail');
              }
              return {
                exists:
                  name === 'health_alerts' && existingAlerts.has(id),
                data: () => ({}),
              };
            },
            async set(data: unknown) {
              if (
                opts.failOn === 'persist' &&
                name === 'health_reports'
              ) {
                throw new Error('persist-fail');
              }
              if (
                opts.failOn === 'alertMarker' &&
                name === 'health_alerts'
              ) {
                throw new Error('alertMarker-fail');
              }
              writes.push({ path, data });
            },
          };
        },
      };
    },
    _writes: writes,
  } as unknown as { _writes: WriteRecord[] } & Parameters<
    typeof runResilienceHealthAlertCron
  >[0]['db'];

  return { db, writes };
}

// Helpers — checkers que devuelven el status que queramos.
type AnyId =
  | 'slm'
  | 'zettelkasten'
  | 'firestore'
  | 'gemini'
  | 'device_kek'
  | 'encrypted_kv'
  | 'network';

const healthyChecker =
  (id: AnyId): SubsystemChecker =>
  async () => ({
    id,
    status: 'healthy',
    detail: `${id}: ok`,
  });

const criticalChecker =
  (id: AnyId): SubsystemChecker =>
  async () => ({
    id,
    status: 'critical',
    detail: `${id}: down`,
  });

/** Set completo de checkers healthy — para tests que verifican overall=healthy. */
function allHealthyCheckers() {
  return {
    slm: healthyChecker('slm'),
    zettelkasten: healthyChecker('zettelkasten'),
    firestore: healthyChecker('firestore'),
    gemini: healthyChecker('gemini'),
    device_kek: healthyChecker('device_kek'),
    encrypted_kv: healthyChecker('encrypted_kv'),
    network: healthyChecker('network'),
  };
}

const fixedNow = () => new Date('2026-05-14T10:00:00.000Z');

describe('runResilienceHealthAlertCron', () => {
  it('healthy: NO dispara FCM, persiste reporte', async () => {
    const { db, writes } = buildFakeDb();
    const notifyOps = vi.fn();
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      notifyOps,
      checkers: allHealthyCheckers(),
    });
    expect(result.overallStatus).toBe('healthy');
    expect(result.alertFired).toBe(false);
    expect(result.reportPersisted).toBe(true);
    expect(notifyOps).not.toHaveBeenCalled();
    // 1 write a health_reports/, ningún write a health_alerts/
    expect(writes.filter((w) => w.path.startsWith('health_reports/'))).toHaveLength(
      1,
    );
    expect(writes.filter((w) => w.path.startsWith('health_alerts/'))).toHaveLength(
      0,
    );
  });

  it('critical: dispara FCM + persiste reporte + marca alert idempotente', async () => {
    const { db, writes } = buildFakeDb();
    const notifyOps = vi.fn().mockResolvedValue(undefined);
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      notifyOps,
      checkers: {
        slm: criticalChecker('slm'),
        zettelkasten: criticalChecker('zettelkasten'),
        firestore: healthyChecker('firestore'),
      },
    });
    expect(result.overallStatus).toBe('critical');
    expect(result.alertFired).toBe(true);
    expect(result.alertIdempotencyKey).toBe('2026-05-14');
    expect(notifyOps).toHaveBeenCalledTimes(1);
    // Verificar que la marca de idempotency se persistió
    const alertWrites = writes.filter((w) =>
      w.path.startsWith('health_alerts/'),
    );
    expect(alertWrites).toHaveLength(1);
    expect(alertWrites[0]!.path).toBe('health_alerts/2026-05-14');
  });

  it('strict: una caída aislada de Firestore es crítica y notifica a operaciones', async () => {
    const { db, writes } = buildFakeDb();
    const notifyOps = vi.fn().mockResolvedValue(undefined);

    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      overallPolicy: 'strict',
      notifyOps,
      checkers: {
        firestore: criticalChecker('firestore'),
        network: healthyChecker('network'),
      },
    });

    expect(result.overallStatus).toBe('critical');
    expect(result.report.subsystems).toContainEqual(
      expect.objectContaining({ id: 'firestore', status: 'critical' }),
    );
    expect(notifyOps).toHaveBeenCalledTimes(1);
    expect(notifyOps).toHaveBeenCalledWith(
      expect.objectContaining({ overallStatus: 'critical' }),
    );
    expect(
      writes.filter((write) => write.path.startsWith('health_alerts/')),
    ).toHaveLength(1);
  });

  it('critical pero ya alertado hoy: NO re-dispara FCM (idempotency)', async () => {
    const { db } = buildFakeDb({ existingAlertIds: ['2026-05-14'] });
    const notifyOps = vi.fn();
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      notifyOps,
      checkers: {
        slm: criticalChecker('slm'),
        zettelkasten: criticalChecker('zettelkasten'),
      },
    });
    expect(result.overallStatus).toBe('critical');
    expect(result.alertFired).toBe(false);
    expect(notifyOps).not.toHaveBeenCalled();
  });

  it('critical sin notifyOps: igualmente marca idempotency para evitar re-intentos', async () => {
    const { db, writes } = buildFakeDb();
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      checkers: {
        slm: criticalChecker('slm'),
        zettelkasten: criticalChecker('zettelkasten'),
      },
    });
    expect(result.alertFired).toBe(true);
    const alertWrite = writes.find((w) =>
      w.path.startsWith('health_alerts/'),
    );
    expect(alertWrite).toBeDefined();
    expect((alertWrite!.data as { notified: boolean }).notified).toBe(false);
  });

  it('persistAllReports=false + healthy: NO persiste reporte', async () => {
    const { db, writes } = buildFakeDb();
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      persistAllReports: false,
      checkers: allHealthyCheckers(),
    });
    expect(result.overallStatus).toBe('healthy');
    expect(result.reportPersisted).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it('persistAllReports=false + critical: persiste igual', async () => {
    const { db, writes } = buildFakeDb();
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      persistAllReports: false,
      checkers: {
        slm: criticalChecker('slm'),
        zettelkasten: criticalChecker('zettelkasten'),
      },
    });
    expect(result.reportPersisted).toBe(true);
    expect(writes.filter((w) => w.path.startsWith('health_reports/'))).toHaveLength(
      1,
    );
  });

  it('notifyOps lanza: error contado pero el cron termina', async () => {
    const { db } = buildFakeDb();
    const notifyOps = vi.fn().mockRejectedValue(new Error('FCM down'));
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      notifyOps,
      checkers: {
        slm: criticalChecker('slm'),
        zettelkasten: criticalChecker('zettelkasten'),
      },
    });
    expect(result.errors).toBeGreaterThanOrEqual(1);
    // Aun así marcamos el alert — sino el próximo cron del día reintentaría
    expect(result.alertFired).toBe(true);
  });

  it('persist falla: error contado pero el cron termina', async () => {
    const { db } = buildFakeDb({ failOn: 'persist' });
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      checkers: {
        slm: healthyChecker('slm'),
      },
    });
    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(result.reportPersisted).toBe(false);
  });

  it('degraded: NO dispara FCM aunque haya recomendaciones', async () => {
    const degradedChecker: SubsystemChecker = async () => ({
      id: 'slm',
      status: 'degraded',
      detail: 'slow',
    });
    const { db } = buildFakeDb();
    const notifyOps = vi.fn();
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      notifyOps,
      checkers: { slm: degradedChecker },
    });
    expect(result.overallStatus).toBe('degraded');
    expect(result.alertFired).toBe(false);
    expect(notifyOps).not.toHaveBeenCalled();
  });

  it('result contiene el reporte completo (auditable)', async () => {
    const { db } = buildFakeDb();
    const result = await runResilienceHealthAlertCron({
      db,
      now: fixedNow,
      checkers: {
        slm: healthyChecker('slm'),
        firestore: healthyChecker('firestore'),
      },
    });
    expect(result.report.subsystems.length).toBeGreaterThan(0);
    expect(result.report.generatedAt).toBe('2026-05-14T10:00:00.000Z');
  });

  it('idempotency key cambia entre días distintos', async () => {
    const day1 = await runResilienceHealthAlertCron({
      db: buildFakeDb().db,
      now: () => new Date('2026-05-14T10:00:00.000Z'),
      checkers: {
        slm: criticalChecker('slm'),
        zettelkasten: criticalChecker('zettelkasten'),
      },
    });
    const day2 = await runResilienceHealthAlertCron({
      db: buildFakeDb().db,
      now: () => new Date('2026-05-15T10:00:00.000Z'),
      checkers: {
        slm: criticalChecker('slm'),
        zettelkasten: criticalChecker('zettelkasten'),
      },
    });
    expect(day1.alertIdempotencyKey).toBe('2026-05-14');
    expect(day2.alertIdempotencyKey).toBe('2026-05-15');
  });
});

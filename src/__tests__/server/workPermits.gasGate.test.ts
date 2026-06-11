// Real-router supertest for the gas-telemetry soft-block on confined-space
// permits (arista C3 — telemetría→bloqueo operacional, 2026-06-11).
//
// Before this wire, a gas sensor reporting LEL 15 % in zona-7 had NO effect on
// a confined-space permit for zona-7: the sensor informed, nothing stopped.
// Now the SIGN path reads recent zone telemetry server-side (hard 3 s
// deadline, Promise.race — weatherGate precedent) and:
//   • blocked + no override        → 409 `gas_telemetry_block` (+ audit + FCM alert)
//   • blocked + supervisor override → 200, dedicated audit row w/ readings snapshot
//   • stale/absent telemetry        → NEVER blocks; es-CL note (fail-open)
// validate-critical surfaces the same gate as ADVISORY issues for `confinado`.
//
// SOFT block by design (horometerEngine precedent): the app never stops work
// physically — it refuses to ISSUE the permit until the atmosphere is safe or
// a supervisor-tier role documents an override. Life-safety: no tier-gating
// anywhere in this flow (ADR 0021).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  sendToProjectSupervisors: vi.fn<
    (
      projectId: string,
      payload: { title: string; body: string; data?: Record<string, string> },
      db: unknown,
      messaging: unknown,
    ) => Promise<{ notified: number; failed: number; supervisorEmails: string[] }>
  >(async () => ({ notified: 1, failed: 0, supervisorEmails: [] })),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const m = adminMock(() => H.db!);
  // The gas-block alert path passes admin.messaging() through to the (mocked)
  // emergency fan-out; a stub object is enough here.
  const messaging = () => ({});
  return { ...m, messaging, default: { ...(m.default as object), messaging } };
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
      roles: [],
      admin: req.header('x-test-admin') === 'true',
    };
    next();
  },
}));

vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));

// FCM fan-out reused from the IoT critical-alert path (firestoreBridge
// precedent) — mocked so the test asserts the call, not Firebase Messaging.
vi.mock('../../server/routes/emergency.js', () => ({
  sendToProjectSupervisors: H.sendToProjectSupervisors,
}));

import workPermitsRouter from '../../server/routes/workPermits.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { GAS_NO_TELEMETRY_NOTE_ES } from '../../services/workPermits/gasGate.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', workPermitsRouter);
  return app;
}

const issuer = { 'x-test-uid': 'sup1', 'x-test-role': 'supervisor' };

const CONFINADO_LABELS = [
  'Medición de gases pre-ingreso',
  'Ventilación forzada operativa',
  'Vigía exterior asignado',
  'Equipo rescate listo',
  'Comunicación radio establecida',
];

/** Full supervisor attestation for a confinado permit (sign happy path). */
const ATTEST_BODY = {
  workerHasTraining: true,
  workerHasEpp: true,
  workerMedicallyFit: true,
  checkedLabels: CONFINADO_LABELS,
};

function seedConfinadoPermit(
  db: NonNullable<typeof H.db>,
  permitId: string,
  overrides: Record<string, unknown> = {},
) {
  const now = new Date();
  db._seed(`tenants/t1/projects/p1/work_permits/${permitId}`, {
    id: permitId,
    kind: 'confinado',
    workerUid: 'worker-uid',
    approverUid: 'sup1',
    approverRole: 'supervisor',
    zoneId: 'zona-7',
    taskDescription: 'Limpieza interior de estanque de relaves',
    status: 'pending_approval',
    preconditions: {
      workerHasTraining: false,
      workerHasEpp: false,
      workerMedicallyFit: false,
      checklist: {
        items: CONFINADO_LABELS.map((label, idx) => ({
          id: `confinado-check-${idx}`,
          label,
          checked: false,
        })),
      },
    },
    createdAt: now.toISOString(),
    approvedAt: null,
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + 4 * 3_600_000).toISOString(),
    cancelledAt: null,
    cancelledReason: null,
    fulfilledAt: null,
    ...overrides,
  });
}

/** Seed a telemetry_events row the HMAC ingest would have written. */
function seedTelemetry(
  db: NonNullable<typeof H.db>,
  id: string,
  data: Record<string, unknown>,
) {
  db._seed(`telemetry_events/${id}`, {
    type: 'environmental',
    source: 'gs-01',
    unit: '%',
    status: 'normal',
    projectId: 'p1',
    zoneId: 'zona-7',
    timestamp: new Date().toISOString(),
    ...data,
  });
}

function auditRows(db: NonNullable<typeof H.db>): Array<Record<string, unknown>> {
  return Object.entries(db._dump())
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v);
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', name: 'Faena Test' });
  H.sendToProjectSupervisors.mockClear();
});

// ════════════════════════════════════════════════════════════════════════
// SIGN — soft block
// ════════════════════════════════════════════════════════════════════════

describe('POST .../:permitId/sign — gas telemetry soft-block (confinado)', () => {
  it('409 gas_telemetry_block when fresh zone LEL ≥ 10% — permit stays unsigned, audited, crew alerted', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-1');
    seedTelemetry(H.db!, 'ev1', { metric: 'lel_pct', value: 15 });

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-1/sign')
      .set(issuer)
      .send(ATTEST_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('gas_telemetry_block');
    expect(typeof res.body.message).toBe('string'); // es-CL copy
    const codes = (res.body.reasons as { code: string }[]).map((i) => i.code);
    expect(codes).toContain('GAS_LEL_HIGH');
    expect(res.body.worstReadings?.lel?.value).toBe(15);

    // Permit must NOT have been issued.
    const stored = (await H.db!.doc('tenants/t1/projects/p1/work_permits/wp-gas-1').get()).data();
    expect(stored?.status).toBe('pending_approval');

    // Blocked attempt is audited with the readings snapshot.
    const blockedAudit = auditRows(H.db!).find((r) => r.action === 'work_permits.sign.gas_blocked');
    expect(blockedAudit).toBeDefined();
    expect(blockedAudit?.userId).toBe('sup1'); // server-stamped from token
    expect((blockedAudit?.details as Record<string, unknown>)?.permitId).toBe('wp-gas-1');

    // Crew alert fan-out fired (life-safety, free on all tiers).
    expect(H.sendToProjectSupervisors).toHaveBeenCalledTimes(1);
    expect(H.sendToProjectSupervisors.mock.calls[0][0]).toBe('p1');
  });

  it('409 when O₂ is below 19.5% in the zone', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-2');
    seedTelemetry(H.db!, 'ev1', { metric: 'o2_pct', value: 18.0 });

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-2/sign')
      .set(issuer)
      .send(ATTEST_BODY);

    expect(res.status).toBe(409);
    const codes = (res.body.reasons as { code: string }[]).map((i) => i.code);
    expect(codes).toContain('GAS_OXYGEN_LOW');
  });

  it('200 with supervisor override — permit issued, dedicated audit row carries snapshot + reason', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-3');
    seedTelemetry(H.db!, 'ev1', { metric: 'lel_pct', value: 12 });

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-3/sign')
      .set(issuer)
      .send({
        ...ATTEST_BODY,
        overrideGasBlock: true,
        overrideReason: 'Ventilación forzada operando; medición manual con detector calibrado en 2% LEL.',
      });

    expect(res.status).toBe(200);
    expect(res.body.permit.status).toBe('active');
    expect(res.body.gasVerification?.blocked).toBe(true);

    const overrideAudit = auditRows(H.db!).find((r) => r.action === 'work_permits.sign.gas_override');
    expect(overrideAudit).toBeDefined();
    expect(overrideAudit?.userId).toBe('sup1');
    const details = overrideAudit?.details as Record<string, unknown>;
    expect(details?.overrideReason).toContain('Ventilación forzada');
    expect(details?.worstReadings).toBeDefined();
    expect(Array.isArray(details?.reasons)).toBe(true);

    // The normal sign audit row still exists too.
    expect(auditRows(H.db!).some((r) => r.action === 'work_permits.sign')).toBe(true);
    // Crew is alerted that an override was exercised.
    expect(H.sendToProjectSupervisors).toHaveBeenCalledTimes(1);
  });

  it('400 when override is requested without a documented reason', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-4');
    seedTelemetry(H.db!, 'ev1', { metric: 'lel_pct', value: 12 });

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-4/sign')
      .set(issuer)
      .send({ ...ATTEST_BODY, overrideGasBlock: true });

    expect(res.status).toBe(400);
    const stored = (await H.db!.doc('tenants/t1/projects/p1/work_permits/wp-gas-4').get()).data();
    expect(stored?.status).toBe('pending_approval');
  });

  it('403 for a worker-tier caller even when attempting an override (issuer-role gate)', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-5');
    seedTelemetry(H.db!, 'ev1', { metric: 'lel_pct', value: 12 });

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-5/sign')
      .set({ 'x-test-uid': 'worker-1', 'x-test-role': 'worker' })
      .send({ ...ATTEST_BODY, overrideGasBlock: true, overrideReason: 'Quiero entrar igual, hay apuro' });

    expect(res.status).toBe(403);
    const stored = (await H.db!.doc('tenants/t1/projects/p1/work_permits/wp-gas-5').get()).data();
    expect(stored?.status).toBe('pending_approval');
  });

  it('200 + es-CL note when the zone has NO recent telemetry (absence of data never blocks)', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-6');

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-6/sign')
      .set(issuer)
      .send(ATTEST_BODY);

    expect(res.status).toBe(200);
    expect(res.body.permit.status).toBe('active');
    expect(res.body.gasVerification?.blocked).toBe(false);
    expect(res.body.gasVerification?.note).toBe(GAS_NO_TELEMETRY_NOTE_ES);
    expect(H.sendToProjectSupervisors).not.toHaveBeenCalled();
  });

  it('200 when the only over-threshold reading is stale (>15 min old)', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-7');
    seedTelemetry(H.db!, 'ev1', {
      metric: 'lel_pct',
      value: 50,
      timestamp: new Date(Date.now() - 20 * 60_000).toISOString(),
    });

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-7/sign')
      .set(issuer)
      .send(ATTEST_BODY);

    expect(res.status).toBe(200);
    expect(res.body.gasVerification?.blocked).toBe(false);
    expect(res.body.gasVerification?.note).toBe(GAS_NO_TELEMETRY_NOTE_ES);
  });

  it('200 — readings from ANOTHER zone do not block this permit', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-8');
    seedTelemetry(H.db!, 'ev1', { metric: 'lel_pct', value: 50, zoneId: 'zona-99' });

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-8/sign')
      .set(issuer)
      .send(ATTEST_BODY);

    expect(res.status).toBe(200);
    expect(res.body.gasVerification?.blocked).toBe(false);
  });

  it('200 + note when the permit has no zoneId (cannot join telemetry)', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-9', { zoneId: null });
    seedTelemetry(H.db!, 'ev1', { metric: 'lel_pct', value: 50 });

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-9/sign')
      .set(issuer)
      .send(ATTEST_BODY);

    expect(res.status).toBe(200);
    expect(res.body.gasVerification?.source).toBe('no_zone');
    expect(typeof res.body.gasVerification?.note).toBe('string');
  });

  it('200 fail-open when the telemetry lookup itself fails (Firestore outage)', async () => {
    seedConfinadoPermit(H.db!, 'wp-gas-10');
    H.db!._failReads('telemetry_events');

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-gas-10/sign')
      .set(issuer)
      .send(ATTEST_BODY);

    expect(res.status).toBe(200);
    expect(res.body.gasVerification?.source).toBe('unavailable');
    expect(typeof res.body.gasVerification?.note).toBe('string');
  });

  it('non-gas kind (altura) is unaffected even with bad readings in its zone — no regression', async () => {
    const now = new Date();
    H.db!._seed('tenants/t1/projects/p1/work_permits/wp-alt-1', {
      id: 'wp-alt-1',
      kind: 'altura',
      workerUid: 'worker-uid',
      approverUid: 'sup1',
      approverRole: 'supervisor',
      zoneId: 'zona-7',
      taskDescription: 'Instalar panel solar en cubierta',
      status: 'pending_approval',
      preconditions: {
        workerHasTraining: false,
        workerHasEpp: false,
        workerMedicallyFit: false,
        checklist: {
          items: [
            { id: 'altura-check-0', label: 'Verificar arnés y línea de vida', checked: false },
            { id: 'altura-check-1', label: 'Verificar superficie de apoyo / barandas', checked: false },
            { id: 'altura-check-2', label: 'Verificar condiciones climáticas (viento ≤ 60 km/h)', checked: false },
            { id: 'altura-check-3', label: 'Verificar plan rescate', checked: false },
          ],
        },
      },
      createdAt: now.toISOString(),
      validFrom: now.toISOString(),
      validUntil: new Date(now.getTime() + 4 * 3_600_000).toISOString(),
    });
    seedTelemetry(H.db!, 'ev1', { metric: 'lel_pct', value: 50 });

    const res = await request(buildApp())
      .post('/api/sprint-k/p1/work-permits/wp-alt-1/sign')
      .set(issuer)
      .send({
        workerHasTraining: true,
        workerHasEpp: true,
        workerMedicallyFit: true,
        checkedLabels: [
          'Verificar arnés y línea de vida',
          'Verificar superficie de apoyo / barandas',
          'Verificar condiciones climáticas (viento ≤ 60 km/h)',
          'Verificar plan rescate',
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.permit.status).toBe('active');
    expect(res.body.gasVerification).toBeUndefined();
    expect(H.sendToProjectSupervisors).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
// VALIDATE-CRITICAL — advisory surface for confinado
// ════════════════════════════════════════════════════════════════════════

describe('POST .../validate-critical — confinado gas advisory', () => {
  const URL = '/api/sprint-k/p1/work-permits/validate-critical';

  it('200 with blocking gas issues + gasVerification when zone telemetry is over threshold', async () => {
    seedTelemetry(H.db!, 'ev1', { metric: 'lel_pct', value: 15 });

    const res = await request(buildApp())
      .post(URL)
      .set(issuer)
      .send({ kind: 'confinado', zoneId: 'zona-7', data: {} });

    expect(res.status).toBe(200); // advisory endpoint NEVER 409s
    expect(res.body.result.kind).toBe('confinado');
    expect(res.body.result.hasBlockers).toBe(true);
    const codes = (res.body.result.issues as { code: string }[]).map((i) => i.code);
    expect(codes).toContain('GAS_LEL_HIGH');
    expect(res.body.gasVerification).toMatchObject({ source: 'telemetry', blocked: true });
    // Read-only advisory: no alert spam from polling.
    expect(H.sendToProjectSupervisors).not.toHaveBeenCalled();
  });

  it('200 clean + es-CL note when the zone has no recent telemetry', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(issuer)
      .send({ kind: 'confinado', zoneId: 'zona-7', data: {} });

    expect(res.status).toBe(200);
    expect(res.body.result.hasBlockers).toBe(false);
    expect(res.body.gasVerification?.note).toBe(GAS_NO_TELEMETRY_NOTE_ES);
  });

  it('existing kinds keep their contract (loto without telemetry interaction)', async () => {
    seedTelemetry(H.db!, 'ev1', { metric: 'lel_pct', value: 50 });
    const res = await request(buildApp())
      .post(URL)
      .set(issuer)
      .send({ kind: 'loto', data: { identifiedSources: [], locks: [], tryoutPerformed: true } });

    expect(res.status).toBe(200);
    expect(res.body.gasVerification).toBeUndefined();
  });
});

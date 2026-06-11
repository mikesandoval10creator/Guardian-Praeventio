// Praeventio Guard — F.15 Centro de Permisos de Trabajo.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/work-permits*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// Permisos digitales para tareas críticas:
//   - Trabajo en altura (DS 594 art. 53)
//   - Trabajo en caliente (DS 132)
//   - Espacios confinados (DS 132 + protocolo MINSAL)
//   - LOTO / bloqueo energético (DS 132 + DS 109)
//   - Excavaciones (DS 594)
//   - Izaje crítico (DS 132)
//
// 4 endpoints:
//   GET  /:projectId/work-permits             — list (filters status/kind)
//   POST /:projectId/work-permits             — create permit (engine valida)
//   POST /:projectId/work-permits/:permitId/sign   — sign/issue active permit
//   POST /:projectId/work-permits/:permitId/close  — close (fulfill/cancel)
//
// Codex P1 fixes preservados:
//   - Issuer identity (workerUid/approverUid/approverRole) NUNCA del body
//   - Checklist items siempre seeded como false en create — supervisor
//     atesta en /sign
//   - Permit issuance gated por canIssuePermits claim
//   - Expired permits no se pueden marcar como fulfilled/cancelled

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  WorkPermitAdapter,
  WorkPermitDuplicateError,
} from '../../services/workPermits/workPermitFirestoreAdapter.js';
import {
  createPendingPermit,
  attestAndIssuePermit,
  cancelPermit,
  fulfillPermit,
  deriveStatus,
  WorkPermitValidationError,
  type WorkPermit,
  type WorkPermitKind,
  type WorkPermitStatus,
} from '../../services/workPermits/workPermitEngine.js';
// Wire (2026-05-29): surface the deep per-kind critical validators
// (izaje/excavación/LOTO — DS 132). They were implemented + unit-tested
// (criticalPermitValidators.test.ts) but never reachable from the API.
// ADVISORY ONLY — returns severity-tagged issues for the supervisor; never
// blocks issuance (the validators explicitly "no toma decisiones" and the
// product directive is recommend-not-block).
import {
  validateCriticalPermit,
  type CriticalMetadata,
  type CriticalIssue,
  type CriticalValidationResult,
} from '../../services/workPermits/criticalPermitValidators.js';
// Arista C3 — telemetría→bloqueo operacional (2026-06-11): gas sensors already
// ingest readings into `telemetry_events` (HMAC route), but a reading over
// threshold in a zone had no operational consequence. For gas-sensitive kinds
// (espacio confinado) we now read the zone's recent telemetry server-side
// (hard 3 s deadline, Promise.race — weatherGate precedent) and run the pure
// gasGate engine. SOFT block by design (horometerEngine precedent): a blocked
// permit cannot be SIGNED unless a supervisor-tier caller records an explicit,
// audited override; the app never physically stops work. Life-safety flow —
// never tier-gated (ADR 0021).
import {
  evaluateGasTelemetry,
  type GasGateResult,
  type GasTelemetryReading,
} from '../../services/workPermits/gasGate.js';
// Arista clima→permisos (2026-06-10): `windSpeedMps` used to come exclusively
// from the client body, making the DS 132 / ISO 12480 wind thresholds
// decorative when the requester under-declares. For wind-sensitive kinds we
// now resolve an independent server-side wind sample from the project's
// `geo:{lat,lng}` (environmentBackend.getForecast — OpenWeather) and validate
// with effective = max(declared, server). See weatherGate.ts for the policy.
import {
  mergeWindForValidation,
  resolveServerWindWithTimeout,
  type WindMergeResult,
} from '../../services/workPermits/weatherGate.js';

const router = Router();

// ── Guard helpers ─────────────────────────────────────────────────────

async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  const members = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .where('uid', '==', callerUid)
    .limit(1)
    .get();
  if (!members.empty) {
    const tid = members.docs[0]?.data()?.tenantId;
    if (typeof tid === 'string') return tid;
  }
  return null;
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<{ tenantId: string } | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await resolveTenantId(
    callerUid,
    projectId,
    admin.firestore(),
  );
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ── Constants + role gate ─────────────────────────────────────────────

const VALID_KINDS: ReadonlySet<WorkPermitKind> = new Set<WorkPermitKind>([
  'altura',
  'caliente',
  'confinado',
  'loto',
  'excavacion',
  'izaje_critico',
]);

const VALID_STATUSES: ReadonlySet<WorkPermitStatus> =
  new Set<WorkPermitStatus>([
    'draft',
    'pending_approval',
    'active',
    'expired',
    'cancelled',
    'fulfilled',
  ]);

const PERMIT_ISSUER_ROLES: ReadonlySet<string> = new Set([
  'supervisor',
  'prevencionista',
  'gerente',
  'admin',
]);

interface CallerRoleContext {
  role: string | null;
  canIssuePermits: boolean;
}

function resolveCallerRoleContext(
  user: Express.PraeventioAuthUser,
): CallerRoleContext {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const primaryRole =
    typeof user.role === 'string' && user.role.length > 0 ? user.role : null;
  if (user.admin === true) {
    return { role: primaryRole ?? 'admin', canIssuePermits: true };
  }
  if (primaryRole && PERMIT_ISSUER_ROLES.has(primaryRole)) {
    return { role: primaryRole, canIssuePermits: true };
  }
  for (const r of roles) {
    if (typeof r === 'string' && PERMIT_ISSUER_ROLES.has(r)) {
      return { role: r, canIssuePermits: true };
    }
  }
  return { role: primaryRole, canIssuePermits: false };
}

// ── GET /:projectId/work-permits ──────────────────────────────────────

router.get('/:projectId/work-permits', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new WorkPermitAdapter({
      db: admin.firestore() as any,
      tenantId: g.tenantId,
      projectId,
    });
    const statusQ =
      typeof req.query.status === 'string' ? req.query.status : null;
    const kindQ =
      typeof req.query.kind === 'string' ? req.query.kind : null;
    const kind =
      kindQ && VALID_KINDS.has(kindQ as WorkPermitKind)
        ? (kindQ as WorkPermitKind)
        : null;
    const status =
      statusQ && VALID_STATUSES.has(statusQ as WorkPermitStatus)
        ? (statusQ as WorkPermitStatus)
        : null;
    const wantsAll = statusQ === 'all';
    const now = new Date();

    let permits: WorkPermit[];
    if (kind && status) {
      if (status === 'active') {
        permits = (
          await adapter.listByKindAndStatus(kind, 'active')
        ).filter((p) => deriveStatus(p, now) === 'active');
      } else if (status === 'expired') {
        permits = (
          await adapter.listByKindAndStatus(kind, 'active')
        ).filter((p) => deriveStatus(p, now) === 'expired');
      } else {
        permits = await adapter.listByKindAndStatus(kind, status);
      }
    } else if (kind && wantsAll) {
      permits = await adapter.listByKind(kind);
    } else if (kind) {
      permits = (
        await adapter.listByKindAndStatus(kind, 'active')
      ).filter((p) => deriveStatus(p, now) === 'active');
    } else if (status === 'active') {
      permits = await adapter.listActive(now);
    } else if (status === 'expired') {
      const candidates = await adapter.listByStatus('active');
      permits = candidates.filter(
        (p) => deriveStatus(p, now) === 'expired',
      );
    } else if (status) {
      permits = await adapter.listByStatus(status);
    } else if (wantsAll) {
      permits = await adapter.listActive(now);
    } else {
      permits = await adapter.listActive(now);
    }

    return res.json({ permits });
  } catch (err) {
    logger.error?.('workPermits.list.error', err);
    captureRouteError(err, 'workPermits.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/work-permits ─────────────────────────────────────

const checklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  checked: z.boolean(),
  verifiedAt: z.string().optional(),
});

const workPermitCreateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'altura',
    'caliente',
    'confinado',
    'loto',
    'excavacion',
    'izaje_critico',
  ]),
  workerUid: z.string().min(1).optional(),
  zoneId: z.string().optional(),
  taskDescription: z.string().min(3).max(4000),
  durationHours: z.number().positive().max(24),
  preconditions: z
    .object({
      workerHasTraining: z.boolean().optional(),
      workerHasEpp: z.boolean().optional(),
      workerMedicallyFit: z.boolean().optional(),
      checklist: z
        .object({
          items: z.array(checklistItemSchema),
        })
        .optional(),
    })
    .optional(),
});

router.post(
  '/:projectId/work-permits',
  verifyAuth,
  validate(workPermitCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof workPermitCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const ctx = resolveCallerRoleContext(req.user!);
    if (!ctx.canIssuePermits) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_permit_issuer_role',
      });
    }
    const workerUid =
      typeof body.workerUid === 'string' && body.workerUid.length > 0
        ? body.workerUid
        : callerUid;
    try {
      const permit = createPendingPermit({
        id: body.id,
        kind: body.kind,
        workerUid,
        approverUid: callerUid,
        approverRole: ctx.role ?? 'supervisor',
        zoneId: body.zoneId,
        taskDescription: body.taskDescription,
        preconditions: {
          workerHasTraining: false,
          workerHasEpp: false,
          workerMedicallyFit: false,
          checklist: { items: [] },
        },
        durationHours: body.durationHours,
      });
      const adapter = new WorkPermitAdapter({
        db: admin.firestore() as any,
        tenantId: g.tenantId,
        projectId,
      });
      await adapter.create(permit);
      // CLAUDE.md #3: permit lifecycle (DS 132) must be audited.
      await auditServerEvent(req, 'work_permits.create', 'work_permits', {
        permitId: permit.id,
        projectId,
        kind: permit.kind,
      }, { projectId });
      return res.status(201).json({ permit });
    } catch (err) {
      if (err instanceof WorkPermitDuplicateError) {
        return res
          .status(409)
          .json({ error: 'permit_id_duplicate', permitId: err.permitId });
      }
      if (err instanceof WorkPermitValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('workPermits.create.error', err);
      captureRouteError(err, 'workPermits.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/work-permits/validate-critical ───────────────────
// Advisory deep-validation for critical permit kinds (izaje/excavación/LOTO).
// Wires criticalPermitValidators (DS 132 + ISO 12480-1 + NCh 349). Read-only:
// surfaces blocking/advisory/info issues so the supervisor can resolve blockers
// or override advisories with a documented reason. NEVER blocks issuance here.

const criticalValidateSchema = z.object({
  kind: z.enum(['izaje_critico', 'excavacion', 'loto', 'confinado']),
  data: z.record(z.string(), z.unknown()),
  /** Zone whose telemetry verifies the atmosphere (gas-sensitive kinds). */
  zoneId: z.string().min(1).max(128).optional(),
});

/** Kinds whose validators consume `windSpeedMps` (izaje only today). */
const KINDS_WITH_WIND: ReadonlySet<string> = new Set(['izaje_critico']);

/** Hard deadline for the independent wind lookup — never hang the endpoint. */
const WIND_LOOKUP_TIMEOUT_MS = 3000;

/** Read `projects/{projectId}.geo` when it carries finite lat/lng. */
async function readProjectGeo(
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const snap = await db.collection('projects').doc(projectId).get();
    const geo = snap.exists ? (snap.data()?.geo as unknown) : null;
    if (
      geo &&
      typeof (geo as { lat?: unknown }).lat === 'number' &&
      typeof (geo as { lng?: unknown }).lng === 'number' &&
      Number.isFinite((geo as { lat: number }).lat) &&
      Number.isFinite((geo as { lng: number }).lng)
    ) {
      return { lat: (geo as { lat: number }).lat, lng: (geo as { lng: number }).lng };
    }
    return null;
  } catch (err) {
    // Geo is an enhancement — a failed read degrades to the declared value.
    logger.warn?.('workPermits.validateCritical.geo_read_failed', err);
    return null;
  }
}

interface WeatherVerification {
  source: WindMergeResult['source'];
  serverWindMps: number | null;
  discrepancy: boolean;
  note?: string;
}

// ── Gas telemetry gate (arista C3) ────────────────────────────────────
// Server-side counterpart of the pure gasGate engine: queries the zone's
// recent `telemetry_events` (written by POST /api/telemetry/ingest with the
// optional `zoneId` tag) under a hard deadline and maps the verdict onto the
// validate (advisory) and sign (soft-block) flows.

/** Kinds whose atmosphere is verified against zone telemetry. */
const GAS_SENSITIVE_KINDS: ReadonlySet<WorkPermitKind> = new Set<WorkPermitKind>([
  'confinado',
]);

/** Hard deadline for the telemetry lookup — never hang validate/sign. */
const GAS_TELEMETRY_LOOKUP_TIMEOUT_MS = 3000;

/** Max telemetry rows considered per lookup (newest first). */
const GAS_TELEMETRY_LOOKUP_LIMIT = 100;

/** es-CL — permit carries no zone, so telemetry cannot be joined. */
const GAS_NO_ZONE_NOTE_ES =
  'El permiso no tiene zona asignada — sin verificación automática de gases. La medición manual pre-ingreso sigue siendo obligatoria.';

/** es-CL — Firestore lookup failed/timed out; absence of data never blocks. */
const GAS_TELEMETRY_UNAVAILABLE_NOTE_ES =
  'No fue posible consultar la telemetría de la zona — verificación automática de gases no realizada. La medición manual pre-ingreso sigue siendo obligatoria.';

/** es-CL — 409 body when signing is soft-blocked by zone telemetry. */
const GAS_BLOCK_MESSAGE_ES =
  'Lectura de gas sobre umbral en la zona del permiso. La firma queda bloqueada hasta que la atmósfera vuelva a rango seguro o un supervisor registre un override con razón documentada.';

interface GasVerification {
  source: 'telemetry' | 'unavailable' | 'no_zone';
  blocked: boolean;
  freshReadingCount?: number;
  reasons?: CriticalIssue[];
  worstReadings?: GasGateResult['worstReadings'];
  note?: string;
}

/** Map a raw telemetry_events doc onto the engine's reading shape. */
function toGasTelemetryReading(
  data: Record<string, unknown>,
): GasTelemetryReading | null {
  const { metric, value, timestamp } = data as {
    metric?: unknown;
    value?: unknown;
    timestamp?: unknown;
  };
  if (typeof metric !== 'string' || typeof value !== 'number') return null;
  let timestampMs: number | null = null;
  if (
    timestamp &&
    typeof (timestamp as { toMillis?: unknown }).toMillis === 'function'
  ) {
    timestampMs = (timestamp as { toMillis(): number }).toMillis();
  } else if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    timestampMs = Number.isFinite(parsed) ? parsed : null;
  } else if (typeof timestamp === 'number') {
    timestampMs = timestamp;
  }
  if (timestampMs === null || !Number.isFinite(timestampMs)) return null;
  return {
    metric,
    value,
    timestampMs,
    ...(typeof data.unit === 'string' ? { unit: data.unit } : {}),
    ...(typeof data.source === 'string' ? { source: data.source } : {}),
  };
}

/**
 * Newest telemetry rows for (projectId, zoneId), or null on failure. Requires
 * the composite index projectId ASC + zoneId ASC + timestamp DESC
 * (firestore.indexes.json).
 */
async function readZoneGasReadings(
  db: admin.firestore.Firestore,
  projectId: string,
  zoneId: string,
): Promise<GasTelemetryReading[] | null> {
  try {
    const snap = await db
      .collection('telemetry_events')
      .where('projectId', '==', projectId)
      .where('zoneId', '==', zoneId)
      .orderBy('timestamp', 'desc')
      .limit(GAS_TELEMETRY_LOOKUP_LIMIT)
      .get();
    return snap.docs
      .map((d) => toGasTelemetryReading(d.data() ?? {}))
      .filter((r): r is GasTelemetryReading => r !== null);
  } catch (err) {
    logger.warn?.('workPermits.gasGate.telemetry_read_failed', err);
    return null;
  }
}

/** `readZoneGasReadings` bounded by a hard deadline (weatherGate pattern). */
async function readZoneGasReadingsWithTimeout(
  db: admin.firestore.Firestore,
  projectId: string,
  zoneId: string,
  timeoutMs = GAS_TELEMETRY_LOOKUP_TIMEOUT_MS,
): Promise<GasTelemetryReading[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([
      readZoneGasReadings(db, projectId, zoneId),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve the gate verdict for a permit zone. Fail-open: missing zone, failed
 * lookup or stale/absent readings yield `blocked: false` plus an es-CL note —
 * absence of data must never stop work (weatherGate unavailability policy).
 */
async function resolveGasVerification(
  db: admin.firestore.Firestore,
  projectId: string,
  zoneId: string | null | undefined,
): Promise<GasVerification> {
  if (typeof zoneId !== 'string' || zoneId.length === 0) {
    return { source: 'no_zone', blocked: false, note: GAS_NO_ZONE_NOTE_ES };
  }
  const readings = await readZoneGasReadingsWithTimeout(db, projectId, zoneId);
  if (readings === null) {
    return {
      source: 'unavailable',
      blocked: false,
      note: GAS_TELEMETRY_UNAVAILABLE_NOTE_ES,
    };
  }
  const gate = evaluateGasTelemetry(readings, Date.now());
  return {
    source: 'telemetry',
    blocked: gate.blocked,
    freshReadingCount: gate.freshReadingCount,
    reasons: gate.reasons,
    worstReadings: gate.worstReadings,
    ...(gate.note ? { note: gate.note } : {}),
  };
}

/**
 * Best-effort FCM fan-out when the gate blocks a sign attempt or a supervisor
 * overrides the block — reuses the IoT critical-alert path
 * (`sendToProjectSupervisors`, firestoreBridge precedent). Never breaks the
 * response. NEXT STEP (documented, not faked): broadcast to the whole zone
 * crew, not only supervisors, once a zone-membership channel exists.
 */
async function notifyGasBlockAlert(
  event: 'blocked' | 'override',
  projectId: string,
  permit: WorkPermit,
  gas: GasVerification,
): Promise<void> {
  try {
    const { sendToProjectSupervisors } = await import('./emergency.js');
    const zone = permit.zoneId ?? 'sin zona';
    const payload =
      event === 'blocked'
        ? {
            title: 'Bloqueo por gas — espacio confinado',
            body: `Lectura de gas sobre umbral en zona ${zone}: la firma del permiso ${permit.id} quedó bloqueada.`,
          }
        : {
            title: 'Override de bloqueo por gas',
            body: `El permiso ${permit.id} fue firmado con override de supervisor pese a lectura de gas sobre umbral en zona ${zone}.`,
          };
    await sendToProjectSupervisors(
      projectId,
      {
        ...payload,
        data: {
          permitId: permit.id,
          projectId,
          zoneId: permit.zoneId ?? '',
          event: `gas_${event}`,
          freshReadingCount: String(gas.freshReadingCount ?? 0),
          source: 'work_permits.gas_gate',
        },
      },
      admin.firestore(),
      admin.messaging(),
    );
  } catch (err) {
    // Alert is best-effort; the 409/200 + audit trail are the hard guarantees.
    logger.warn?.('workPermits.gasGate.notify_failed', err);
  }
}

router.post(
  '/:projectId/work-permits/validate-critical',
  verifyAuth,
  validate(criticalValidateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof criticalValidateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const ctx = resolveCallerRoleContext(req.user!);
    if (!ctx.canIssuePermits) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_permit_issuer_role',
      });
    }

    // ── Server-side wind verification (wind-sensitive kinds + project geo) ─
    let data = body.data;
    let weatherVerification: WeatherVerification | null = null;
    let merged: WindMergeResult | null = null;
    if (KINDS_WITH_WIND.has(body.kind)) {
      const geo = await readProjectGeo(projectId, admin.firestore());
      if (geo) {
        const serverWind = await resolveServerWindWithTimeout(
          {
            fetchForecast: async (days, loc) => {
              const { getForecast } = await import(
                '../../services/environmentBackend.js'
              );
              return getForecast(days, loc);
            },
          },
          geo,
          WIND_LOOKUP_TIMEOUT_MS,
        );
        const declared =
          typeof data.windSpeedMps === 'number' ? data.windSpeedMps : null;
        merged = mergeWindForValidation(declared, serverWind);
        if (merged.effectiveWindMps !== null) {
          // Inject the safety-effective wind BEFORE validation — the existing
          // IZAJE thresholds (11/15 m/s) then block/advise on the worst case.
          data = { ...data, windSpeedMps: merged.effectiveWindMps };
        }
        weatherVerification = {
          source: merged.source,
          serverWindMps: merged.serverWindMps,
          discrepancy: merged.discrepancy,
          ...(merged.note ? { note: merged.note } : {}),
        };
      }
    }

    let result: CriticalValidationResult;
    if (body.kind === 'confinado') {
      // No declared-metadata validator for confinado yet — its deep check is
      // the zone-telemetry gas gate below (DS 594 + protocolo MINSAL).
      result = {
        kind: 'confinado',
        issues: [],
        hasBlockers: false,
        hasAdvisories: false,
      };
    } else {
      try {
        result = validateCriticalPermit({
          kind: body.kind,
          data,
        } as unknown as CriticalMetadata);
      } catch {
        // The pure validator throws only on incomplete/malformed metadata
        // (e.g. a missing required array like `identifiedSources`/`locks`) —
        // that's bad client input, not a server fault. Return 400 so the UI
        // can prompt for the missing fields instead of seeing a 500.
        logger.warn?.('workPermits.validateCritical.invalid_metadata', {
          kind: body.kind,
        });
        return res.status(400).json({ error: 'invalid_metadata', kind: body.kind });
      }
    }

    // Surface the under-declaration to the supervisor as a recorded advisory
    // (the blocking decision itself already ran on the effective wind).
    if (merged?.discrepancy && merged.serverWindMps !== null) {
      const discrepancyIssue: CriticalIssue = {
        severity: 'advisory',
        code: 'WIND_CLIENT_UNDERREPORTED',
        message: `Viento declarado ${(merged.clientWindMps ?? 0).toFixed(1)} m/s está por debajo del viento verificado por el servidor ${merged.serverWindMps.toFixed(1)} m/s. La validación se realizó con el valor verificado.`,
        context: {
          clientWindMps: merged.clientWindMps ?? 0,
          serverWindMps: merged.serverWindMps,
        },
      };
      result = {
        ...result,
        issues: [...result.issues, discrepancyIssue],
        hasAdvisories: true,
      };
    }

    // ── Zone gas telemetry (gas-sensitive kinds, arista C3) ──────────────
    // Advisory here: issues are merged into the result for the supervisor,
    // but this endpoint never blocks (the sign path enforces the soft block).
    // No alert fan-out from validate either — it is a read-only check the UI
    // may poll, and alert spam would desensitize the crew.
    let gasVerification: GasVerification | null = null;
    if (GAS_SENSITIVE_KINDS.has(body.kind as WorkPermitKind)) {
      gasVerification = await resolveGasVerification(
        admin.firestore(),
        projectId,
        body.zoneId ?? null,
      );
      const gasIssues = gasVerification.reasons ?? [];
      if (gasIssues.length > 0) {
        result = {
          ...result,
          issues: [...result.issues, ...gasIssues],
          hasBlockers:
            result.hasBlockers ||
            gasIssues.some((i) => i.severity === 'blocking'),
          hasAdvisories:
            result.hasAdvisories ||
            gasIssues.some((i) => i.severity === 'advisory'),
        };
      }
    }

    // NOTE: this endpoint is deliberately NOT audited — it is a read-only
    // advisory validation (no state change); permit create/sign/close are the
    // audited lifecycle events (CLAUDE.md #3).
    return res.json({
      result,
      ...(weatherVerification ? { weatherVerification } : {}),
      ...(gasVerification ? { gasVerification } : {}),
    });
  },
);

// ── POST /:projectId/work-permits/:permitId/sign ──────────────────────

const signPermitSchema = z
  .object({
    workerHasTraining: z.boolean().optional(),
    workerHasEpp: z.boolean().optional(),
    workerMedicallyFit: z.boolean().optional(),
    checkedLabels: z.array(z.string()).optional(),
    /**
     * Explicit supervisor override of an active gas soft-block (arista C3).
     * Only honored for callers whose VERIFIED token role passed the
     * issuer-role gate (supervisor tier); always audited with the readings
     * snapshot + documented reason.
     */
    overrideGasBlock: z.boolean().optional(),
    overrideReason: z.string().min(10).max(2000).optional(),
  })
  .optional();

router.post(
  '/:projectId/work-permits/:permitId/sign',
  verifyAuth,
  validate(signPermitSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, permitId } = req.params;
    const body = (req.body ?? {}) as z.infer<typeof signPermitSchema> &
      object;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const ctx = resolveCallerRoleContext(req.user!);
    if (!ctx.canIssuePermits) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_permit_issuer_role',
      });
    }
    try {
      const adapter = new WorkPermitAdapter({
        db: admin.firestore() as any,
        tenantId: g.tenantId,
        projectId,
      });
      const permit = await adapter.getById(permitId);
      if (!permit) return res.status(404).json({ error: 'not_found' });

      // ── Gas telemetry soft-block (gas-sensitive kinds, arista C3) ──────
      // Runs BEFORE issuance: a fresh over-threshold reading in the permit's
      // zone refuses the signature (409) unless the caller — already verified
      // as supervisor-tier by the issuer-role gate above — records an explicit
      // override with a documented reason. Both outcomes are audited with the
      // readings snapshot; missing/stale telemetry never blocks (fail-open
      // note, weatherGate policy).
      let gasVerification: GasVerification | null = null;
      let gasOverride: {
        reason: string;
        reasons: CriticalIssue[];
        worstReadings: GasGateResult['worstReadings'];
      } | null = null;
      if (GAS_SENSITIVE_KINDS.has(permit.kind)) {
        gasVerification = await resolveGasVerification(
          admin.firestore(),
          projectId,
          permit.zoneId ?? null,
        );
        if (gasVerification.blocked) {
          if (body?.overrideGasBlock !== true) {
            // CLAUDE.md #3/#14: the blocked attempt is a compliance-relevant
            // outcome — audit it (helper stamps uid/email from the verified
            // token and swallows its own failures).
            await auditServerEvent(
              req,
              'work_permits.sign.gas_blocked',
              'work_permits',
              {
                permitId: permit.id,
                projectId,
                zoneId: permit.zoneId ?? null,
                reasons: gasVerification.reasons ?? [],
                worstReadings: gasVerification.worstReadings ?? {},
                freshReadingCount: gasVerification.freshReadingCount ?? 0,
              },
              { projectId },
            );
            await notifyGasBlockAlert('blocked', projectId, permit, gasVerification);
            return res.status(409).json({
              error: 'gas_telemetry_block',
              message: GAS_BLOCK_MESSAGE_ES,
              reasons: gasVerification.reasons ?? [],
              worstReadings: gasVerification.worstReadings ?? {},
            });
          }
          const overrideReason =
            typeof body?.overrideReason === 'string'
              ? body.overrideReason.trim()
              : '';
          if (overrideReason.length < 10) {
            return res.status(400).json({
              error: 'gas_override_reason_required',
              message:
                'El override del bloqueo por gas requiere una razón documentada (mínimo 10 caracteres).',
            });
          }
          gasOverride = {
            reason: overrideReason,
            reasons: gasVerification.reasons ?? [],
            worstReadings: gasVerification.worstReadings ?? {},
          };
        }
      }

      const checkedLabels =
        body?.checkedLabels ??
        permit.preconditions.checklist.items
          .filter((i) => i.checked)
          .map((i) => i.label);
      const attestation = {
        workerHasTraining:
          body?.workerHasTraining ??
          permit.preconditions.workerHasTraining,
        workerHasEpp:
          body?.workerHasEpp ?? permit.preconditions.workerHasEpp,
        workerMedicallyFit:
          body?.workerMedicallyFit ??
          permit.preconditions.workerMedicallyFit,
        checkedLabels,
      };

      const next: WorkPermit =
        permit.status === 'active'
          ? { ...permit, approvedAt: new Date().toISOString() }
          : attestAndIssuePermit(permit, attestation);
      await adapter.save(next);
      await auditServerEvent(req, 'work_permits.sign', 'work_permits', {
        permitId: next.id,
        projectId,
        status: next.status,
      }, { projectId });
      if (gasOverride) {
        // Dedicated audit row: signed-while-blocked via supervisor override,
        // with the telemetry snapshot that was overridden (arista C3).
        await auditServerEvent(
          req,
          'work_permits.sign.gas_override',
          'work_permits',
          {
            permitId: next.id,
            projectId,
            zoneId: permit.zoneId ?? null,
            overrideReason: gasOverride.reason,
            reasons: gasOverride.reasons,
            worstReadings: gasOverride.worstReadings,
          },
          { projectId },
        );
        if (gasVerification) {
          await notifyGasBlockAlert('override', projectId, permit, gasVerification);
        }
      }
      return res.json({
        permit: next,
        ...(gasVerification ? { gasVerification } : {}),
      });
    } catch (err) {
      if (err instanceof WorkPermitValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('workPermits.sign.error', err);
      captureRouteError(err, 'workPermits.sign');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/work-permits/:permitId/close ─────────────────────

const closePermitSchema = z.object({
  reason: z.string().min(10).max(2000),
  outcome: z.enum(['fulfill', 'cancel']).optional(),
});

router.post(
  '/:projectId/work-permits/:permitId/close',
  verifyAuth,
  validate(closePermitSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, permitId } = req.params;
    const body = req.body as z.infer<typeof closePermitSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new WorkPermitAdapter({
        db: admin.firestore() as any,
        tenantId: g.tenantId,
        projectId,
      });
      const permit = await adapter.getById(permitId);
      if (!permit) return res.status(404).json({ error: 'not_found' });

      const now = new Date();
      const derived = deriveStatus(permit, now);
      if (derived === 'expired') {
        return res.status(422).json({
          error: 'permit_already_expired',
          hint: 'extend the validity (re-sign) or omit this close call; expired permits cannot be marked as fulfilled or cancelled',
        });
      }
      if (derived === 'cancelled' || derived === 'fulfilled') {
        return res.status(422).json({
          error: 'permit_already_terminal',
          status: derived,
        });
      }

      const outcome = body.outcome ?? 'fulfill';
      const next =
        outcome === 'cancel'
          ? cancelPermit(permit, body.reason, now)
          : fulfillPermit(permit, now);
      await adapter.save(next);
      await auditServerEvent(req, 'work_permits.close', 'work_permits', {
        permitId,
        projectId,
        outcome,
        status: next.status,
      }, { projectId });
      return res.json({ permit: next });
    } catch (err) {
      if (err instanceof WorkPermitValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('workPermits.close.error', err);
      captureRouteError(err, 'workPermits.close');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;

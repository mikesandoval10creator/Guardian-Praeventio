// Praeventio Guard — F.21 Panel de Riesgo por Turno (pre-turno).
//
// Endpoint dedicado para `/api/sprint-k/:projectId/pre-shift-risk`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// El supervisor abre este panel ANTES de iniciar el turno y el sistema
// le dice "hoy tu turno arranca con riesgo X por estas razones". Cruza
// 7 fuentes determinísticas (clima, fatiga, novatos, tareas críticas,
// mantenimiento, incidentes recientes, brigada de emergencia) usando
// `composeShiftRiskPanel` del Sprint 40 Fase F.21.
//
// 100% determinístico — sin IA — cada factor tiene peso conocido.
// Codex P1+P2 fixes (PR #311 rounds 1-2) preservados:
//   - normalizeSeverity para incidentes ES legacy
//   - coerceToDate unificado (ISO/Timestamp/epoch/YYYY-MM-DD)
//   - Hire date desde 5 paths (hireDate/joinedAt/startDate/hiredAt/createdAt)
//   - Incidents window por createdAt fallback (sin requerir índice
//     occurredAt nuevo)
//   - Tasks ±24h alrededor de la fecha del turno, filtrado JS
//   - Equipment merge legacy assets + canonical tenant store
//   - Weather nested paths (weather/current/data) + km/h→m/s back-convert
//   - Visibility meters (OpenWeather) vs km explicit detection

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

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

// ── GET /:projectId/pre-shift-risk ────────────────────────────────────

router.get('/:projectId/pre-shift-risk', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { composeShiftRiskPanel } = await import(
      '../../services/shiftRiskPanel/preShiftRiskComposer.js'
    );
    const { normalizeSeverity } = await import(
      '../../services/incidentBundle/incidentEvidenceBundle.js'
    );
    const db = admin.firestore();

    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`preShiftRisk.${label}.fetch_failed`, err);
        return [];
      }
    };

    const projectRef = db.collection('projects').doc(projectId);
    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    const shiftParam =
      typeof req.query.shift === 'string' &&
      ['day', 'evening', 'night'].includes(req.query.shift)
        ? (req.query.shift as 'day' | 'evening' | 'night')
        : 'day';
    const dateParam =
      typeof req.query.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : todayStartIso.slice(0, 10);

    const shiftDayStart = new Date(`${dateParam}T00:00:00.000Z`);
    const shiftDayEnd = new Date(
      shiftDayStart.getTime() + 24 * 60 * 60 * 1000,
    );

    const coerceToDate = (raw: unknown): Date | null => {
      if (!raw) return null;
      if (raw instanceof Date)
        return Number.isNaN(raw.getTime()) ? null : raw;
      if (typeof raw === 'number') {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if (typeof raw === 'string') {
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
          ? `${raw}T00:00:00.000Z`
          : raw;
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if (typeof raw === 'object' && raw !== null) {
        const maybeTs = raw as {
          toDate?: () => Date;
          seconds?: number;
        };
        if (typeof maybeTs.toDate === 'function') {
          try {
            const d = maybeTs.toDate();
            return d instanceof Date && !Number.isNaN(d.getTime())
              ? d
              : null;
          } catch {
            return null;
          }
        }
        if (typeof maybeTs.seconds === 'number') {
          const d = new Date(maybeTs.seconds * 1000);
          return Number.isNaN(d.getTime()) ? null : d;
        }
      }
      return null;
    };

    const [
      workers,
      recentIncidents,
      criticalTasks,
      equipment,
      environment,
      activePermits,
      projectDoc,
    ] = await Promise.all([
      safeRead('workers', async () => {
        const snap = await projectRef.collection('workers').get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const hireDate =
            coerceToDate(data.hireDate) ??
            coerceToDate(data.joinedAt) ??
            coerceToDate(data.startDate) ??
            coerceToDate(data.hiredAt) ??
            coerceToDate(data.createdAt);
          const daysSinceHire = hireDate
            ? Math.max(
                0,
                Math.floor(
                  (Date.now() - hireDate.getTime()) /
                    (1000 * 60 * 60 * 24),
                ),
              )
            : 999;
          return {
            uid: d.id,
            fullName: String(
              data.fullName ?? data.name ?? data.displayName ?? d.id,
            ),
            fatigueRisk:
              typeof data.fatigueRisk === 'string' &&
              ['low', 'moderate', 'high', 'critical'].includes(
                data.fatigueRisk,
              )
                ? (data.fatigueRisk as
                    | 'low'
                    | 'moderate'
                    | 'high'
                    | 'critical')
                : 'low',
            daysSinceHire,
            hasNightShiftHistory:
              typeof data.hasNightShiftHistory === 'boolean'
                ? data.hasNightShiftHistory
                : undefined,
          };
        });
      }),
      safeRead('incidents', async () => {
        const snap = await byProject('incidents').limit(200).get();
        const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const tsDate =
              coerceToDate(data.occurredAt) ??
              coerceToDate(data.createdAt);
            if (!tsDate || tsDate.getTime() < sevenDaysAgoMs) {
              return null;
            }
            const sevRaw =
              typeof data.severity === 'string' ? data.severity : '';
            const normalized = sevRaw ? normalizeSeverity(sevRaw) : null;
            const severity: 'low' | 'medium' | 'high' | 'critical' =
              normalized === 'sif'
                ? 'critical'
                : normalized ?? 'medium';
            return {
              id: d.id,
              severity,
              occurredAt: tsDate.toISOString(),
            };
          })
          .filter((i): i is NonNullable<typeof i> => i !== null)
          .slice(0, 50);
      }),
      safeRead('tasks', async () => {
        const snap = await byProject('tasks').limit(500).get();
        return snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const plannedDate =
              coerceToDate(data.plannedDate) ??
              coerceToDate(data.scheduledFor) ??
              coerceToDate(data.dueDate) ??
              coerceToDate(data.date) ??
              coerceToDate(data.day);
            if (plannedDate) {
              const ts = plannedDate.getTime();
              if (
                ts < shiftDayStart.getTime() ||
                ts >= shiftDayEnd.getTime()
              ) {
                return null;
              }
            }
            const criticality =
              typeof data.criticality === 'string'
                ? data.criticality
                : null;
            const isCritical =
              criticality === 'high' ||
              criticality === 'critical' ||
              data.isCriticalTask === true;
            return {
              id: d.id,
              category: String(data.category ?? data.kind ?? 'general'),
              isCriticalTask: isCritical,
              requiresPermit:
                typeof data.requiresPermit === 'boolean'
                  ? data.requiresPermit
                  : undefined,
            };
          })
          .filter((t): t is NonNullable<typeof t> => t !== null);
      }),
      safeRead('equipment', async () => {
        const mapDoc = (d: { id: string; data(): unknown }) => {
          const data = d.data() as Record<string, unknown>;
          const nextMaint =
            coerceToDate(data.nextMaintenanceAt) ??
            coerceToDate(data.nextMaintenance);
          const overdue = nextMaint
            ? nextMaint.getTime() < shiftDayStart.getTime()
            : false;
          return {
            id: d.id,
            code: String(data.code ?? data.name ?? d.id),
            overdueMaintenance: overdue,
          };
        };

        const legacyPromise = byProject('assets')
          .get()
          .then(
            (s: {
              docs: Array<{ id: string; data(): unknown }>;
            }) => s.docs.map(mapDoc),
          )
          .catch(() => [] as ReturnType<typeof mapDoc>[]);

        const canonicalPromise: Promise<ReturnType<typeof mapDoc>[]> =
          (async () => {
            try {
              const canonSnap = await db
                .collection(
                  `tenants/${g.tenantId}/projects/${projectId}/equipment`,
                )
                .limit(500)
                .get();
              return canonSnap.docs.map(mapDoc);
            } catch {
              return [];
            }
          })();

        const [legacy, canonical] = await Promise.all([
          legacyPromise,
          canonicalPromise,
        ]);

        const dedupKey = (e: { id: string; code: string }) =>
          e.code && e.code !== e.id ? `code:${e.code}` : `id:${e.id}`;
        const merged = new Map<string, ReturnType<typeof mapDoc>>();
        for (const e of legacy) merged.set(dedupKey(e), e);
        for (const e of canonical) merged.set(dedupKey(e), e);
        return Array.from(merged.values());
      }),
      safeRead('environment', async () => {
        const snap = await db
          .collection('global_context')
          .doc('environment')
          .get();
        return snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
      }),
      safeRead('permits', async () => {
        const snap = await byProject('work_permits')
          .where('status', '==', 'active')
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }),
      safeRead('project', async () => {
        const snap = await projectRef.get();
        return snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
      }),
    ]);

    const envDoc = environment[0] ?? {};
    const envRoot = envDoc as Record<string, unknown>;
    const pickObj = (key: string): Record<string, unknown> | null => {
      const v = envRoot[key];
      return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    };
    const envWeather = pickObj('weather');
    const envCurrent = pickObj('current');
    const envData = pickObj('data');
    const envSources: Array<Record<string, unknown>> = [
      ...(envWeather ? [envWeather] : []),
      ...(envCurrent ? [envCurrent] : []),
      ...(envData ? [envData] : []),
      envRoot,
    ];
    const readNumber = (...keys: string[]): number | undefined => {
      for (const src of envSources) {
        for (const k of keys) {
          const v = src[k];
          if (typeof v === 'number' && Number.isFinite(v)) return v;
        }
      }
      return undefined;
    };

    const rainProbability =
      readNumber('rainProbability', 'pop', 'precipProbability') ?? 0;
    const windMs = readNumber('windSpeedMs', 'wind_ms');
    const windKmh = readNumber('windKmh', 'windSpeedKmh');
    const windFallbackKmh = readNumber('windSpeed', 'wind');
    const windSpeedMs =
      windMs ??
      (typeof windKmh === 'number' ? windKmh / 3.6 : undefined) ??
      (typeof windFallbackKmh === 'number'
        ? windFallbackKmh / 3.6
        : 0);

    const visibilityKmExplicit = readNumber('visibilityKm');
    const visibilityMeters = readNumber('visibility');
    const visibilityKm =
      visibilityKmExplicit ??
      (typeof visibilityMeters === 'number'
        ? visibilityMeters / 1000
        : undefined) ??
      10;

    const weather = {
      rainProbability,
      windSpeedMs,
      uvIndex: readNumber('uvIndex', 'uv', 'uvi') ?? 0,
      temperatureC:
        readNumber('temperatureC', 'temp', 'temperature') ?? 20,
      lightningRiskWithinHours: readNumber('lightningRiskWithinHours'),
      visibilityKm,
    };

    const projectData = (projectDoc[0] as Record<string, unknown>) ?? {};
    const emergencyBrigadeReady =
      typeof projectData.emergencyBrigadeReady === 'boolean'
        ? projectData.emergencyBrigadeReady
        : false;

    const panel = composeShiftRiskPanel({
      projectId,
      shift: shiftParam,
      date: dateParam,
      weather,
      workers,
      plannedTasks: criticalTasks,
      equipment,
      recentIncidents,
      activePermitsCount: activePermits.length,
      emergencyBrigadeReady,
    });

    return res.json({ panel });
  } catch (err) {
    logger.error?.('preShiftRisk.error', err);
    captureRouteError(err, 'preShiftRisk');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;

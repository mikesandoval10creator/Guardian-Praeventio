// Praeventio Guard — F.29 Indicadores de Tendencia de Incidentes.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/incidents/trends`.
// Migrado del monolito `sprintK.ts` (2026-05-17) — cada feature Sprint K
// debe vivir en su propio archivo de dominio según directiva del usuario.
//
// Time series + leading indicators sobre la colección top-level
// `incidents` filtrada por `projectId`. Compara ventanas (12m/6m/3m)
// y agrupa por mes o semana. Calcula:
//
//   - `buckets[]`: serie con count + severidad ponderada + breakdown
//     por `type` (kind).
//   - `leading.nearMissRatio`: % de incidents marcados como near-miss
//     vs total. Indicador adelantado: si los near-miss caen sin que
//     los reportes totales lo hagan, suele señalar sub-reporte, no
//     mejora real.
//   - `leading.closureRate`: % de incidents con `status` en
//     {closed, resolved} sobre el total.
//   - `leading.averageDaysOpen`: promedio de días entre `occurredAt`
//     y `closedAt`/`resolvedAt` para los cerrados; mide velocidad
//     de respuesta del SGSST.
//   - `trend` + `trendConfidence`: regresión lineal simple sobre la
//     serie ponderada por severidad. Direccionalidad cualitativa
//     (improving / stable / worsening), no predicción cuantitativa.
//
// NO clasifica por ningún kind hardcodeado. El breakdown `byKind` se
// arma observando los valores reales de `type` que existen en los
// incidents del proyecto. Esto evita inventar categorías que la
// empresa no usa.

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

// ── Guard helper (replicado del monolito para mantener este route auto-contenido).
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
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ── F.29 specific helpers ─────────────────────────────────────────────

const TREND_WINDOW_MS: Record<string, number> = {
  '3m': 90 * 24 * 60 * 60 * 1000,
  '6m': 180 * 24 * 60 * 60 * 1000,
  '12m': 365 * 24 * 60 * 60 * 1000,
};

// Peso ordinal por severidad — calibrado con el documento Sprint K §296:
// critical/sif pesan más que high; medium y low son baseline.
const TREND_SEVERITY_WEIGHT: Record<string, number> = {
  low: 1,
  medium: 2,
  // Codex P2 fix: el schema canónico `POST /api/incidents/report`
  // persiste `med` para severidad media.
  med: 2,
  high: 4,
  critical: 8,
  sif: 8,
  // Spanish aliases (matching SEVERITY_ALIASES en incidentEvidenceBundle).
  baja: 1,
  media: 2,
  alta: 4,
  critica: 8,
  'crítica': 8,
};

function trendSeverityWeight(raw: unknown): number {
  if (typeof raw !== 'string') return 1;
  const key = raw.trim().toLowerCase();
  return TREND_SEVERITY_WEIGHT[key] ?? 1;
}

/**
 * Etiqueta determinística para un bucket. month=YYYY-MM, week=YYYY-Www
 * (ISO-8601). Mantenemos UTC para evitar saltos por DST y para que las
 * series sean reproducibles desde el navegador.
 */
function trendBucketLabel(iso: string, group: 'month' | 'week'): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (group === 'month') {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  }
  // ISO-8601 week numbering.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Heurística near-miss: aceptamos varios shapes legados.
 * - `nearMiss: true` (booleano explícito).
 * - `isNearMiss: true`.
 * - `type` / `kind` con valor `near_miss` / `nearmiss` / `casi_accidente`.
 * - `severity` === 'near_miss' (algunos imports legacy lo mezclaron).
 */
function isNearMissRecord(rec: Record<string, unknown>): boolean {
  if (rec.nearMiss === true || rec.isNearMiss === true) return true;
  // Codex P2 fix: el flujo canónico `POST /api/incidents/report`
  // categoriza near-misses bajo `incidentType: 'near_miss'`.
  const candidates = [rec.incidentType, rec.type, rec.kind, rec.severity];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const k = c.trim().toLowerCase().replace(/[\s-]/g, '_');
    if (k === 'near_miss' || k === 'nearmiss' || k === 'casi_accidente') {
      return true;
    }
  }
  return false;
}

/**
 * Convierte el campo de timestamp de un incident (string ISO, Firestore
 * Timestamp, o `{_seconds}`/`{seconds}`) a ISO-8601. Null si no es parseable.
 * Mismo contrato que el helper inline del endpoint de trends — extraído a
 * nivel módulo para que el endpoint de `list` lo reuse sin duplicar la lógica
 * (Codex P1 fix: el flujo canónico persiste `ts` + `createdAt` serverTimestamp).
 */
export function incidentTsToIso(raw: unknown): string | null {
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw === 'object') {
    const t = raw as { toDate?: () => Date; _seconds?: number; seconds?: number };
    if (typeof t.toDate === 'function') {
      const d = t.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
    }
    const seconds =
      typeof t._seconds === 'number'
        ? t._seconds
        : typeof t.seconds === 'number'
          ? t.seconds
          : null;
    if (seconds !== null) {
      const d = new Date(seconds * 1000);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

/** Best occurred-at ISO for an incident: ts → occurredAt → createdAt. */
export function incidentOccurredIso(rec: Record<string, unknown>): string | null {
  return (
    incidentTsToIso(rec.ts) ??
    incidentTsToIso(rec.occurredAt) ??
    incidentTsToIso(rec.createdAt) ??
    null
  );
}

/**
 * Regresión lineal simple (least squares) sobre los valores de la
 * serie. Devuelve la pendiente normalizada al promedio para hacerla
 * comparable entre proyectos con distinta escala de incidentes, más
 * un score de confianza R² (0..1) para que el cliente pueda mostrar
 * el chip solo cuando hay señal real.
 */
function trendLinearRegression(values: number[]): {
  slopePerStep: number;
  slopeNormalized: number;
  rSquared: number;
} {
  const n = values.length;
  if (n < 2) return { slopePerStep: 0, slopeNormalized: 0, rSquared: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i] ?? 0;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denomX = sumXX - n * meanX * meanX;
  if (denomX === 0) return { slopePerStep: 0, slopeNormalized: 0, rSquared: 0 };
  const slope = (sumXY - n * meanX * meanY) / denomX;
  const denomY = sumYY - n * meanY * meanY;
  const numerator = sumXY - n * meanX * meanY;
  const r2 =
    denomY === 0
      ? 0
      : Math.min(1, Math.max(0, (numerator * numerator) / (denomX * denomY)));
  const slopeNormalized = meanY > 0 ? slope / meanY : slope;
  return {
    slopePerStep: slope,
    slopeNormalized,
    rSquared: r2,
  };
}

export interface TrendBucket {
  label: string;
  count: number;
  severityWeighted: number;
  byKind: Record<string, number>;
}

export interface TrendLeadingIndicators {
  nearMissRatio: number;
  closureRate: number;
  averageDaysOpen: number;
}

export interface TrendResponse {
  window: '3m' | '6m' | '12m';
  group: 'month' | 'week';
  totalIncidents: number;
  buckets: TrendBucket[];
  leading: TrendLeadingIndicators;
  trend: 'improving' | 'stable' | 'worsening';
  trendConfidence: number;
  generatedAt: string;
}

// ── Endpoint ──────────────────────────────────────────────────────────

router.get('/:projectId/incidents/trends', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!projectId) {
    return res.status(400).json({ error: 'project_id_required' });
  }
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();

    const windowKey = ((): '3m' | '6m' | '12m' => {
      const raw = typeof req.query.window === 'string' ? req.query.window.toLowerCase() : '';
      if (raw === '3m' || raw === '6m' || raw === '12m') return raw;
      return '12m';
    })();
    const groupKey: 'month' | 'week' = (() => {
      const raw = typeof req.query.group === 'string' ? req.query.group.toLowerCase() : '';
      if (raw === 'week') return 'week';
      return 'month';
    })();

    const windowMs = TREND_WINDOW_MS[windowKey] ?? TREND_WINDOW_MS['12m']!;
    const cutoffMs = Date.now() - windowMs;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.trends.${label}.read_failed`, err);
        return [];
      }
    };

    // Incidents pueden vivir top-level (filtrados por projectId, según
    // backgroundTriggers.ts:374) o anidados en
    // `tenants/{tid}/projects/{pid}/incidents`. Leemos ambos paths y
    // de-duplicamos por docId para no contar el mismo incidente dos
    // veces si una migración dejó copia en los dos lados.
    const [topLevel, nested] = await Promise.all([
      safeRead<Record<string, unknown>>('incidents_top', async () => {
        const snap = await db
          .collection('incidents')
          .where('projectId', '==', projectId)
          .get();
        return snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        }));
      }),
      safeRead<Record<string, unknown>>('incidents_nested', async () => {
        const snap = await db
          .collection(`tenants/${g.tenantId}/projects/${projectId}/incidents`)
          .get();
        return snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        }));
      }),
    ]);

    const byId = new Map<string, Record<string, unknown>>();
    for (const rec of topLevel) {
      const id = String(rec.id ?? '');
      if (id) byId.set(id, rec);
    }
    for (const rec of nested) {
      const id = String(rec.id ?? '');
      if (id && !byId.has(id)) byId.set(id, rec);
    }
    const allIncidents = Array.from(byId.values());

    // Codex P1 fix: el flujo canónico `POST /api/incidents/report`
    // persiste el timestamp en `ts` y escribe `createdAt` como
    // FieldValue.serverTimestamp() (no string). Si no leemos `ts`
    // ni convertimos el Timestamp de Firestore, esos incidents quedan
    // fuera de la ventana → totales/leading indicators a cero.
    // (Helpers extraídos a nivel módulo — reusados por el endpoint `list`.)
    const occurredOf = incidentOccurredIso;
    const windowed = allIncidents.filter((rec) => {
      const ts = occurredOf(rec);
      if (!ts) return false;
      return ts >= cutoffIso;
    });

    // Bucketing.
    const bucketMap = new Map<string, TrendBucket>();
    for (const rec of windowed) {
      const ts = occurredOf(rec);
      if (!ts) continue;
      const label = trendBucketLabel(ts, groupKey);
      if (!label) continue;
      const existing =
        bucketMap.get(label) ??
        ({
          label,
          count: 0,
          severityWeighted: 0,
          byKind: {},
        } satisfies TrendBucket);
      existing.count += 1;
      existing.severityWeighted += trendSeverityWeight(rec.severity);
      // Codex P2: aceptar `incidentType` (canónico), `type` y `kind`
      // para nombrar el breakdown; legacy escribió cada uno en distinta
      // etapa.
      const kindRaw =
        (typeof rec.incidentType === 'string' && rec.incidentType) ||
        (typeof rec.type === 'string' && rec.type) ||
        (typeof rec.kind === 'string' && rec.kind) ||
        'sin_categoria';
      existing.byKind[kindRaw] = (existing.byKind[kindRaw] ?? 0) + 1;
      bucketMap.set(label, existing);
    }
    // Codex P2 fix: incluir buckets vacíos entre cutoff y now para que
    // la regresión lineal y el gráfico tengan periodos consecutivos.
    // Sin esto, gaps de meses sin incidents distorsionan la tendencia.
    const fillEmpty = (group: 'month' | 'week', from: Date, to: Date): string[] => {
      const labels: string[] = [];
      const cursor = new Date(from.getTime());
      if (group === 'month') {
        cursor.setUTCDate(1);
        cursor.setUTCHours(0, 0, 0, 0);
        while (cursor.getTime() <= to.getTime()) {
          const label = trendBucketLabel(cursor.toISOString(), 'month');
          if (label) labels.push(label);
          cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
      } else {
        // Snap to ISO week start (Monday).
        const day = cursor.getUTCDay() || 7;
        cursor.setUTCDate(cursor.getUTCDate() - day + 1);
        cursor.setUTCHours(0, 0, 0, 0);
        while (cursor.getTime() <= to.getTime()) {
          const label = trendBucketLabel(cursor.toISOString(), 'week');
          if (label) labels.push(label);
          cursor.setUTCDate(cursor.getUTCDate() + 7);
        }
      }
      return labels;
    };
    const allLabels = fillEmpty(groupKey, new Date(cutoffMs), new Date());
    for (const label of allLabels) {
      if (!bucketMap.has(label)) {
        bucketMap.set(label, {
          label,
          count: 0,
          severityWeighted: 0,
          byKind: {},
        });
      }
    }
    const buckets = Array.from(bucketMap.values()).sort((a, b) =>
      a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
    );

    // Leading indicators.
    const total = windowed.length;
    const nearMissCount = windowed.filter(isNearMissRecord).length;
    const closedCount = windowed.filter((rec) => {
      const status = String(rec.status ?? '').toLowerCase();
      return status === 'closed' || status === 'resolved';
    }).length;

    let totalDaysOpen = 0;
    let daysOpenSamples = 0;
    for (const rec of windowed) {
      const status = String(rec.status ?? '').toLowerCase();
      if (status !== 'closed' && status !== 'resolved') continue;
      const opened = occurredOf(rec);
      const closedRaw =
        (typeof rec.closedAt === 'string' && rec.closedAt) ||
        (typeof rec.resolvedAt === 'string' && rec.resolvedAt) ||
        (typeof rec.updatedAt === 'string' && rec.updatedAt) ||
        null;
      if (!opened || !closedRaw) continue;
      const openedMs = Date.parse(opened);
      const closedMs = Date.parse(closedRaw);
      if (!Number.isFinite(openedMs) || !Number.isFinite(closedMs)) continue;
      const delta = closedMs - openedMs;
      if (delta < 0) continue;
      totalDaysOpen += delta / (24 * 60 * 60 * 1000);
      daysOpenSamples += 1;
    }

    const leading: TrendLeadingIndicators = {
      nearMissRatio: total > 0 ? Math.round((nearMissCount / total) * 100) / 100 : 0,
      closureRate: total > 0 ? Math.round((closedCount / total) * 100) / 100 : 0,
      averageDaysOpen:
        daysOpenSamples > 0
          ? Math.round((totalDaysOpen / daysOpenSamples) * 10) / 10
          : 0,
    };

    // Trend direction via linear regression sobre severityWeighted.
    // Si no hay suficientes buckets (<3) NO emitimos tendencia: stable
    // con confianza 0. Evita falsos positivos en proyectos nuevos.
    const weighted = buckets.map((b) => b.severityWeighted);
    let trend: 'improving' | 'stable' | 'worsening' = 'stable';
    let trendConfidence = 0;
    if (weighted.length >= 3) {
      const reg = trendLinearRegression(weighted);
      trendConfidence = Math.round(reg.rSquared * 100) / 100;
      // Umbral: 10% de cambio normalizado por bucket — calibrado para
      // que un goteo sostenido lo dispare, no un único pico.
      if (reg.slopeNormalized <= -0.1) trend = 'improving';
      else if (reg.slopeNormalized >= 0.1) trend = 'worsening';
      else trend = 'stable';
    }

    const response: TrendResponse = {
      window: windowKey,
      group: groupKey,
      totalIncidents: total,
      buckets,
      leading,
      trend,
      trendConfidence,
      generatedAt: new Date().toISOString(),
    };

    return res.json(response);
  } catch (err) {
    logger.error?.('sprintK.trends.error', err);
    captureRouteError(err, 'sprintK.trends');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── F3 (founder decision) — GET /:projectId/incidents/list ─────────────
//
// Lista REAL de los incidentes ocurridos del proyecto, para el Hub de Flujo
// de Incidentes (`/incident-flow`). Lee la MISMA colección `incidents` que el
// endpoint de trends (top-level filtrado por projectId + nested
// `tenants/{tid}/projects/{pid}/incidents`, de-duplicado por docId). No
// agrega ni fabrica nada: cada item refleja campos presentes en el doc real.
// Si el doc no tiene timestamp parseable, NO se descarta (a diferencia de
// trends que necesita ventana) pero `occurredAt` queda `null` honestamente.
//
// Orden: más reciente primero (por occurredAt, los sin fecha al final).
// `limit` opcional (default 100, máx 200) para no traer expedientes enormes.

export interface IncidentListItem {
  id: string;
  /** ISO-8601 o null si el doc no tiene timestamp parseable. */
  occurredAt: string | null;
  /** Severidad cruda tal como está en el doc (puede faltar). */
  severity: string | null;
  /** Tipo: incidentType → type → kind (lo que exista). */
  incidentType: string | null;
  /** Estado del incidente (open/closed/resolved/…) si está presente. */
  status: string | null;
  /** Resumen/descripción si está presente. */
  summary: string | null;
  /** Ubicación si está presente. */
  location: string | null;
  /** true si el doc matchea la heurística near-miss. */
  nearMiss: boolean;
}

export interface IncidentListResponse {
  projectId: string;
  total: number;
  incidents: IncidentListItem[];
  generatedAt: string;
}

router.get('/:projectId/incidents/list', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!projectId) {
    return res.status(400).json({ error: 'project_id_required' });
  }
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;

  try {
    const db = admin.firestore();

    const rawLimit =
      typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(200, Math.max(1, rawLimit))
      : 100;

    const safeRead = async <T,>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.list.${label}.read_failed`, err);
        return [];
      }
    };

    const [topLevel, nested] = await Promise.all([
      safeRead<Record<string, unknown>>('incidents_top', async () => {
        const snap = await db
          .collection('incidents')
          .where('projectId', '==', projectId)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
      }),
      safeRead<Record<string, unknown>>('incidents_nested', async () => {
        const snap = await db
          .collection(`tenants/${g.tenantId}/projects/${projectId}/incidents`)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
      }),
    ]);

    const byId = new Map<string, Record<string, unknown>>();
    for (const rec of topLevel) {
      const id = String(rec.id ?? '');
      if (id) byId.set(id, rec);
    }
    for (const rec of nested) {
      const id = String(rec.id ?? '');
      if (id && !byId.has(id)) byId.set(id, rec);
    }

    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim().length > 0 ? v : null;

    const incidents: IncidentListItem[] = Array.from(byId.values()).map((rec) => ({
      id: String(rec.id ?? ''),
      occurredAt: incidentOccurredIso(rec),
      severity: str(rec.severity),
      incidentType: str(rec.incidentType) ?? str(rec.type) ?? str(rec.kind),
      status: str(rec.status),
      summary: str(rec.summary) ?? str(rec.description),
      location: str(rec.location),
      nearMiss: isNearMissRecord(rec),
    }));

    // Más reciente primero; sin fecha al final (orden estable por id).
    incidents.sort((a, b) => {
      if (a.occurredAt && b.occurredAt) {
        return a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0;
      }
      if (a.occurredAt) return -1;
      if (b.occurredAt) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const limited = incidents.slice(0, limit);

    const response: IncidentListResponse = {
      projectId,
      total: incidents.length,
      incidents: limited,
      generatedAt: new Date().toISOString(),
    };
    return res.json(response);
  } catch (err) {
    logger.error?.('sprintK.list.error', err);
    captureRouteError(err, 'sprintK.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;

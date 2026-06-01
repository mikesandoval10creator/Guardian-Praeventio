// Praeventio Guard — §61-63 Encuesta de Percepción + Índice de Cultura.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/culture-pulse*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 4 endpoints:
//   GET  /:projectId/culture-pulse                    → snapshot agregado
//   POST /:projectId/culture-pulse/survey             → schedule wave (admin/sup)
//   POST /:projectId/culture-pulse/survey/:id/respond → respond (worker, una vez)
//   GET  /:projectId/culture-pulse/history            → últimas 6 olas
//
// PRIVACIDAD CRÍTICA (Ley Karín 21.643 / Ley 19.628 — anonimato de la encuesta):
//   - Responses NUNCA persisten `responderUid`. Solo `responderHash` =
//     HMAC-SHA256(pepper, uid + surveyId).slice(0,32) — keyed con un pepper
//     server-only (`CULTURE_PULSE_PEPPER`, si no `SESSION_SECRET`). Garantiza
//     idempotencia por respondedor Y bloquea la re-identificación off-server:
//     sin el pepper, un insider con read de Firestore + el roster de uids NO
//     puede recomputar el hash de cada candidato y mapear quién respondió qué.
//     Ver `pulseResponderHash` para el detalle + la nota de migración.
//   - Threshold de anonimato n>=5: con menos respuestas, suprimimos TODOS
//     los agregados derivados (cultureIndex, byQuestion, topConcerns,
//     topStrengths, punitive flag). Devolvemos sólo metadata de existencia.
//
// Codex P1+P2 fixes preservados (PR #323 rounds 1-2):
//   - Survey discovery con status + ventana openAt/closeAt enforcement
//   - Missing-index FAILED_PRECONDITION fallback a unordered query
//   - n<5 anonymity suppression con `insufficientResponses` flag
//   - Schedule endpoint gated por role (admin/prevencionista/supervisor)

import { createHash, createHmac } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
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

// ── Role gate ─────────────────────────────────────────────────────────

const CULTURE_PULSE_SCHEDULE_ROLES = new Set([
  'admin',
  'prevencionista',
  'supervisor',
]);

function callerCanScheduleSurvey(
  req: import('express').Request,
): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (
    typeof u.role === 'string' &&
    CULTURE_PULSE_SCHEDULE_ROLES.has(u.role)
  ) {
    return true;
  }
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (
    tenants &&
    typeof tenants === 'object' &&
    typeof u.tenantId === 'string'
  ) {
    const t = tenants[u.tenantId];
    if (
      t &&
      typeof t.role === 'string' &&
      CULTURE_PULSE_SCHEDULE_ROLES.has(t.role)
    ) {
      return true;
    }
  }
  return false;
}

// ── Constants + types ────────────────────────────────────────────────

const PULSE_QUESTION_KEYS = [
  'felt_safe_today',
  'manager_listens',
  'free_to_stop',
  'reported_incident_safely',
  'has_resources_to_be_safe',
] as const;
type PulseQuestionKey = (typeof PULSE_QUESTION_KEYS)[number];

interface StoredPulseSurvey {
  id: string;
  status: 'open' | 'closed';
  openAt: string;
  closeAt: string;
  title?: string;
  expectedRespondents?: number;
  createdAt: string;
  createdBy: string;
}

interface StoredPulseResponse {
  responderHash: string;
  workerRole: string;
  area: string;
  answers: Record<PulseQuestionKey, number>;
  submittedAt: string;
}

// Domain-separation label — garantiza que este hash keyed nunca colisione con
// ningún otro consumidor de `SESSION_SECRET` (firma de sesión, etc.). Bump :vN
// si la derivación cambia (re-keya TODOS los responder hashes → ver migración).
const PULSE_RESPONDER_HASH_DOMAIN = 'culture-pulse:responder:v1';

/**
 * Clave anonimizante e idempotente del respondedor. HMAC-SHA256 keyed por un
 * pepper server-only (`CULTURE_PULSE_PEPPER`, si no `SESSION_SECRET` — required
 * to boot per CLAUDE.md / validate-env.cjs). El pepper es lo que impide la
 * re-identificación: sin él, un insider con read de Firestore + el roster de
 * uids podría brute-forcear `SHA-256(uid:surveyId)` sobre cada candidato y
 * mapear los doc IDs de `responses/` → quién respondió qué. Con el pepper, los
 * doc IDs no son reproducibles fuera del servidor. (Ley Karín 21.643 / Ley
 * 19.628.) Defense-in-depth: el modelo de amenaza es el insider privilegiado
 * (dueño / consola GCP), ya que firestore.rules es default-deny para usuarios
 * normales de la app.
 *
 * Fallback test/dev: sin pepper configurado, degrada al SHA-256 unkeyed legacy
 * para que la suite quede determinista. Nunca se alcanza en prod (el boot falla
 * antes si `SESSION_SECRET` no está).
 *
 * MIGRACIÓN (2026-05-30): introducir el pepper cambia TODOS los outputs. Para
 * una encuesta que quede ABIERTA cruzando este deploy, un trabajador que ya
 * respondió (hash legacy) no es detectado por su nuevo hash peppered y podría
 * responder una vez más → skew transitorio, de baja magnitud, sobre un agregado
 * con umbral n>=5. Aceptado deliberadamente (opción a) en vez de dual-read; debe
 * anotarse en las notas de deploy. Encuestas nuevas no tienen este efecto.
 *
 * Exportada para aserción directa en culturePulse.test.ts.
 */
export function pulseResponderHash(uid: string, surveyId: string): string {
  const pepper =
    process.env.CULTURE_PULSE_PEPPER ?? process.env.SESSION_SECRET ?? '';
  if (pepper) {
    return createHmac('sha256', pepper)
      .update(`${PULSE_RESPONDER_HASH_DOMAIN}:${uid}:${surveyId}`)
      .digest('hex')
      .slice(0, 32);
  }
  // Legacy unkeyed path — test/dev only (ver doc arriba).
  return createHash('sha256')
    .update(`${uid}:${surveyId}`)
    .digest('hex')
    .slice(0, 32);
}

const PULSE_QUESTION_LABEL: Record<PulseQuestionKey, string> = {
  felt_safe_today: 'Me sentí seguro hoy',
  manager_listens: 'Mi jefe escucha mis inquietudes',
  free_to_stop: 'Me siento libre de detener un trabajo inseguro',
  reported_incident_safely: 'Puedo reportar incidentes sin miedo',
  has_resources_to_be_safe:
    'Tengo los recursos para trabajar seguro',
};

const PULSE_ANONYMITY_THRESHOLD = 5;

interface CulturePulseSnapshot {
  surveyId: string | null;
  status: 'open' | 'closed' | null;
  openAt: string | null;
  closeAt: string | null;
  cultureIndex: number;
  level: 'low' | 'fair' | 'good' | 'strong';
  totalResponses: number;
  expectedRespondents: number | null;
  participationRate: number | null;
  punitiveCulturedFlagged: boolean;
  byQuestion: Record<PulseQuestionKey, number>;
  topConcerns: Array<{
    key: PulseQuestionKey;
    label: string;
    score: number;
  }>;
  topStrengths: Array<{
    key: PulseQuestionKey;
    label: string;
    score: number;
  }>;
  hasResponded: boolean;
  insufficientResponses?: boolean;
  currentCount?: number;
  threshold?: number;
}

function isMissingFirestoreIndexError(err: unknown): boolean {
  const code = (err as { code?: string | number } | null)?.code;
  if (code === 9 || code === 'failed-precondition') return true;
  const msg = String((err as Error | null)?.message ?? '');
  return (
    /index/i.test(msg) &&
    /FAILED_PRECONDITION|requires an index/i.test(msg)
  );
}

// ── GET /:projectId/culture-pulse ─────────────────────────────────────

router.get(
  '/:projectId/culture-pulse',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { computePulseIndex } = await import(
        '../../services/culturePulse/safetyCulturePulse.js'
      );

      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/culture_pulse`,
      );

      const safeRead = async <T,>(
        fn: () => Promise<T>,
        fallback: T,
      ): Promise<T> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.('culturePulse.snapshot.read_failed', err);
          return fallback;
        }
      };

      const fetchSurveyOrdered = async (
        statusFilter: 'open' | 'closed',
        orderField: 'openAt' | 'closeAt',
      ): Promise<admin.firestore.QueryDocumentSnapshot[] | null> => {
        try {
          const snap = await baseRef
            .where('status', '==', statusFilter)
            .orderBy(orderField, 'desc')
            .limit(10)
            .get();
          return snap.docs;
        } catch (err) {
          if (!isMissingFirestoreIndexError(err)) {
            logger.warn?.('culturePulse.snapshot.read_failed', err);
            return null;
          }
          logger.warn?.(
            'culturePulse.snapshot.missing_index_fallback',
            { statusFilter, orderField, err },
          );
          try {
            const snap = await baseRef
              .where('status', '==', statusFilter)
              .get();
            const docs = snap.docs;
            docs.sort((a, b) => {
              const av = String(a.get(orderField) ?? '');
              const bv = String(b.get(orderField) ?? '');
              return bv.localeCompare(av);
            });
            return docs.slice(0, 10);
          } catch (innerErr) {
            logger.warn?.(
              'culturePulse.snapshot.unordered_fallback_failed',
              innerErr,
            );
            return null;
          }
        }
      };

      const nowIso = new Date().toISOString();
      let surveyDoc: admin.firestore.QueryDocumentSnapshot | null = null;

      const openDocs = await fetchSurveyOrdered('open', 'openAt');
      if (openDocs && openDocs.length > 0) {
        const liveOpen = openDocs.find((d) => {
          const openAt = d.get('openAt');
          const closeAt = d.get('closeAt');
          return (
            typeof openAt === 'string' &&
            typeof closeAt === 'string' &&
            openAt <= nowIso &&
            nowIso < closeAt
          );
        });
        surveyDoc = liveOpen ?? null;
      }

      if (!surveyDoc) {
        const closedDocs = await fetchSurveyOrdered('closed', 'closeAt');
        if (closedDocs && closedDocs.length > 0) {
          surveyDoc = closedDocs[0];
        } else {
          if (openDocs && openDocs.length > 0) {
            const expired = openDocs.find((d) => {
              const closeAt = d.get('closeAt');
              return typeof closeAt === 'string' && closeAt <= nowIso;
            });
            if (expired) surveyDoc = expired;
          }
        }
      }

      const emptySnapshot: CulturePulseSnapshot = {
        surveyId: null,
        status: null,
        openAt: null,
        closeAt: null,
        cultureIndex: 0,
        level: 'low',
        totalResponses: 0,
        expectedRespondents: null,
        participationRate: null,
        punitiveCulturedFlagged: false,
        byQuestion: {
          felt_safe_today: 0,
          manager_listens: 0,
          free_to_stop: 0,
          reported_incident_safely: 0,
          has_resources_to_be_safe: 0,
        },
        topConcerns: [],
        topStrengths: [],
        hasResponded: false,
      };

      if (!surveyDoc) {
        return res.json({ snapshot: emptySnapshot });
      }

      const survey = surveyDoc.data() as Omit<StoredPulseSurvey, 'id'>;
      const surveyId = surveyDoc.id;

      const effectiveStatus: 'open' | 'closed' =
        survey.status === 'open' &&
        survey.openAt <= nowIso &&
        nowIso < survey.closeAt
          ? 'open'
          : 'closed';

      const responsesSnap = await safeRead<
        admin.firestore.QuerySnapshot | null
      >(
        () => baseRef.doc(surveyId).collection('responses').get(),
        null,
      );

      const responses =
        responsesSnap?.docs.map(
          (d) => d.data() as StoredPulseResponse,
        ) ?? [];

      const callerHash = pulseResponderHash(callerUid, surveyId);
      const responderHashes = new Set(
        responses.map((r) => r.responderHash),
      );
      const hasResponded = responderHashes.has(callerHash);

      const expectedRespondentsOut: number | null =
        typeof survey.expectedRespondents === 'number'
          ? survey.expectedRespondents
          : null;

      if (responses.length < PULSE_ANONYMITY_THRESHOLD) {
        const suppressedSnapshot: CulturePulseSnapshot = {
          surveyId,
          status: effectiveStatus,
          openAt: survey.openAt,
          closeAt: survey.closeAt,
          cultureIndex: 0,
          level: 'low',
          totalResponses: responses.length,
          expectedRespondents: expectedRespondentsOut,
          participationRate: null,
          punitiveCulturedFlagged: false,
          byQuestion: {
            felt_safe_today: 0,
            manager_listens: 0,
            free_to_stop: 0,
            reported_incident_safely: 0,
            has_resources_to_be_safe: 0,
          },
          topConcerns: [],
          topStrengths: [],
          hasResponded,
          insufficientResponses: true,
          currentCount: responses.length,
          threshold: PULSE_ANONYMITY_THRESHOLD,
        };
        return res.json({ snapshot: suppressedSnapshot });
      }

      const index = computePulseIndex(responses);

      const ranked = (Object.keys(
        index.byQuestion,
      ) as PulseQuestionKey[])
        .map((k) => ({
          key: k,
          label: PULSE_QUESTION_LABEL[k],
          score: index.byQuestion[k],
        }))
        .filter((r) => r.score > 0);
      const sortedAsc = [...ranked].sort((a, b) => a.score - b.score);
      const sortedDesc = [...ranked].sort((a, b) => b.score - a.score);

      const participationRate =
        typeof survey.expectedRespondents === 'number' &&
        survey.expectedRespondents > 0
          ? Math.min(1, responses.length / survey.expectedRespondents)
          : null;

      const snapshot: CulturePulseSnapshot = {
        surveyId,
        status: effectiveStatus,
        openAt: survey.openAt,
        closeAt: survey.closeAt,
        cultureIndex: index.cultureIndex,
        level: index.level,
        totalResponses: index.totalResponses,
        expectedRespondents: expectedRespondentsOut,
        participationRate,
        punitiveCulturedFlagged: index.punitiveCulturedFlagged,
        byQuestion: index.byQuestion,
        topConcerns: sortedAsc.slice(0, 5),
        topStrengths: sortedDesc.slice(0, 5),
        hasResponded,
      };

      return res.json({ snapshot });
    } catch (err) {
      logger.error?.('culturePulse.snapshot.error', err);
      captureRouteError(err, 'culturePulse.snapshot');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/culture-pulse/survey ─────────────────────────────

const culturePulseScheduleSchema = z
  .object({
    surveyId: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-zA-Z0-9_-]+$/),
    openAt: z.string().min(10),
    closeAt: z.string().min(10),
    title: z.string().min(1).max(200).optional(),
    expectedRespondents: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.openAt < v.closeAt, {
    message: 'closeAt must be after openAt',
    path: ['closeAt'],
  });

router.post(
  '/:projectId/culture-pulse/survey',
  verifyAuth,
  validate(culturePulseScheduleSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof culturePulseScheduleSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!callerCanScheduleSurvey(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(CULTURE_PULSE_SCHEDULE_ROLES),
      });
    }
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/culture_pulse`,
        )
        .doc(body.surveyId);

      const existing = await docRef.get();
      if (existing.exists) {
        return res.status(409).json({ error: 'survey_already_exists' });
      }

      const now = new Date().toISOString();
      const status: 'open' | 'closed' =
        body.closeAt > now ? 'open' : 'closed';

      const payload: StoredPulseSurvey = {
        id: body.surveyId,
        status,
        openAt: body.openAt,
        closeAt: body.closeAt,
        title: body.title,
        expectedRespondents: body.expectedRespondents,
        createdAt: now,
        createdBy: callerUid,
      };

      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await docRef.set(cleaned, { merge: false });
      // CLAUDE.md #3: scheduling a culture-pulse wave is a state-changing write.
      await auditServerEvent(
        req,
        'culturePulse.scheduleSurvey',
        'culturePulse',
        { projectId, surveyId: body.surveyId, status },
        { projectId },
      );
      return res.status(201).json({ ok: true, survey: payload });
    } catch (err) {
      logger.error?.('culturePulse.schedule.error', err);
      captureRouteError(err, 'culturePulse.schedule');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/culture-pulse/survey/:id/respond ─────────────────

const culturePulseResponseSchema = z.object({
  workerRole: z.string().min(1).max(120),
  area: z.string().min(1).max(120),
  answers: z.object({
    felt_safe_today: z.number().int().min(1).max(5),
    manager_listens: z.number().int().min(1).max(5),
    free_to_stop: z.number().int().min(1).max(5),
    reported_incident_safely: z.number().int().min(1).max(5),
    has_resources_to_be_safe: z.number().int().min(1).max(5),
  }),
});

router.post(
  '/:projectId/culture-pulse/survey/:id/respond',
  verifyAuth,
  validate(culturePulseResponseSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id: surveyId } = req.params;
    const body = req.body as z.infer<typeof culturePulseResponseSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const surveyRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/culture_pulse`,
        )
        .doc(surveyId);

      const surveySnap = await surveyRef.get();
      if (!surveySnap.exists) {
        return res.status(404).json({ error: 'survey_not_found' });
      }
      const survey = surveySnap.data() as Omit<StoredPulseSurvey, 'id'>;
      const now = new Date().toISOString();
      if (survey.status === 'closed' || now > survey.closeAt) {
        return res.status(409).json({ error: 'survey_closed' });
      }
      if (now < survey.openAt) {
        return res.status(409).json({ error: 'survey_not_open' });
      }

      const responderHash = pulseResponderHash(callerUid, surveyId);
      const responseRef = surveyRef
        .collection('responses')
        .doc(responderHash);

      const existing = await responseRef.get();
      if (existing.exists) {
        return res.status(409).json({ error: 'already_responded' });
      }

      const responsePayload: StoredPulseResponse = {
        responderHash,
        workerRole: body.workerRole,
        area: body.area,
        answers: body.answers,
        submittedAt: now,
      };
      await responseRef.set(responsePayload);
      // CLAUDE.md #3: submitting a culture-pulse response is a state-changing
      // write. Details stay anonymity-safe (no answers, no raw responder uid) —
      // the response doc itself never persists `responderUid` (Ley Karín 21.643
      // / Ley 19.628); only `projectId` + `surveyId` identify the affected wave.
      await auditServerEvent(
        req,
        'culturePulse.respondSurvey',
        'culturePulse',
        { projectId, surveyId },
        { projectId },
      );
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('culturePulse.respond.error', err);
      captureRouteError(err, 'culturePulse.respond');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/culture-pulse/history ─────────────────────────────

interface CulturePulseHistoryPoint {
  surveyId: string;
  closeAt: string | null;
  openAt: string;
  cultureIndex: number;
  totalResponses: number;
  level: 'low' | 'fair' | 'good' | 'strong';
}

router.get(
  '/:projectId/culture-pulse/history',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { computePulseIndex } = await import(
        '../../services/culturePulse/safetyCulturePulse.js'
      );

      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/culture_pulse`,
      );

      const safeRead = async <T,>(
        fn: () => Promise<T>,
        fallback: T,
      ): Promise<T> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.('culturePulse.history.read_failed', err);
          return fallback;
        }
      };

      const fetchHistoryOrdered = async (): Promise<
        admin.firestore.QueryDocumentSnapshot[]
      > => {
        try {
          const snap = await baseRef
            .orderBy('openAt', 'desc')
            .limit(6)
            .get();
          return snap.docs;
        } catch (err) {
          if (!isMissingFirestoreIndexError(err)) {
            logger.warn?.('culturePulse.history.read_failed', err);
            return [];
          }
          logger.warn?.(
            'culturePulse.history.missing_index_fallback',
            err,
          );
          try {
            const snap = await baseRef.get();
            const docs = snap.docs;
            docs.sort((a, b) => {
              const av = String(a.get('openAt') ?? '');
              const bv = String(b.get('openAt') ?? '');
              return bv.localeCompare(av);
            });
            return docs.slice(0, 6);
          } catch (innerErr) {
            logger.warn?.(
              'culturePulse.history.unordered_fallback_failed',
              innerErr,
            );
            return [];
          }
        }
      };

      const surveyDocs = await fetchHistoryOrdered();
      const points: CulturePulseHistoryPoint[] = [];
      for (const surveyDoc of surveyDocs) {
        const survey = surveyDoc.data() as Omit<StoredPulseSurvey, 'id'>;
        const responsesSnap = await safeRead<
          admin.firestore.QuerySnapshot | null
        >(() => surveyDoc.ref.collection('responses').get(), null);
        const responses =
          responsesSnap?.docs.map(
            (d) => d.data() as StoredPulseResponse,
          ) ?? [];
        const insufficient =
          responses.length < PULSE_ANONYMITY_THRESHOLD;
        const idx = computePulseIndex(responses);
        points.push({
          surveyId: surveyDoc.id,
          openAt: survey.openAt,
          closeAt: survey.closeAt ?? null,
          cultureIndex: insufficient ? 0 : idx.cultureIndex,
          totalResponses: responses.length,
          level: insufficient ? 'low' : idx.level,
        });
      }

      points.sort((a, b) => a.openAt.localeCompare(b.openAt));
      return res.json({ history: points });
    } catch (err) {
      logger.error?.('culturePulse.history.error', err);
      captureRouteError(err, 'culturePulse.history');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;

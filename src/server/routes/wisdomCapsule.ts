// SPDX-License-Identifier: MIT
// Sprint 15 — Wisdom Capsule daily endpoint.
// Sprint 16 — Gemini summary integration + Firestore cache + ack endpoint.
//
// GET  /api/wisdom-capsule/today?projectId=...&date=YYYY-MM-DD
// POST /api/wisdom-capsule/ack   { projectId, date }
//
// Reads:
//   1. Hallazgos del día anterior del project.
//   2. Alertas predictivas atendidas en las últimas 24h.
// Returns a 30-60s summary anonymized at the cuadrilla level (never
// individual uids). Calls Gemini (gemini-1.5-flash) when GEMINI_API_KEY
// is set; falls back to a deterministic local summary if absent OR if
// the LLM call fails OR exceeds a 3s timeout.
//
// Cache: Firestore wisdom_capsules/{projectId}_{date}. First reader
// triggers Gemini + caches; subsequent reads in the same day are served
// from cache so we never hit the LLM twice for the same context.
//
// Side-effect: tras generar la cápsula, emite un nodo
// `safety-learning` al pipeline Zettelkasten via Admin SDK (mismo
// schema que /api/zettelkasten/nodes pero escribiendo directamente
// porque ya estamos server-side y autenticados).

import { Router } from 'express';
import admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

const router = Router();

interface CapsulePayload {
  title: string;
  body: string;
  durationSeconds: number;
  sourceNodes: string[];
  xpReward: number;
}

// ------------------------------ pure helpers ------------------------------

/**
 * Build a deterministic local summary that never names individuals. Used
 * as a fallback when Gemini is not configured AND as a safety net when
 * the LLM call fails or times out.
 */
export function buildLocalSummary(args: {
  date: string;
  hallazgosCount: number;
  alertasAtendidas: number;
  crewNames: string[];
}): CapsulePayload {
  const { date, hallazgosCount, alertasAtendidas, crewNames } = args;
  const cuadrillas = crewNames.length > 0 ? crewNames.join(', ') : 'el equipo';
  const partes: string[] = [];
  if (alertasAtendidas > 0) {
    partes.push(
      `Ayer ${cuadrillas} respondió a ${alertasAtendidas} alerta${alertasAtendidas === 1 ? '' : 's'} predictiva${alertasAtendidas === 1 ? '' : 's'}, evitando que el riesgo se materializara.`
    );
  }
  if (hallazgosCount > 0) {
    partes.push(
      `Se registraron ${hallazgosCount} hallazgo${hallazgosCount === 1 ? '' : 's'} de seguridad — material para la cápsula de hoy.`
    );
  }
  if (partes.length === 0) {
    partes.push('Día tranquilo en obra. Aprovechemos para reforzar la postura biomecánica antes de empezar.');
  }
  return {
    title: `Cápsula de Sabiduría — ${date}`,
    body: partes.join(' '),
    durationSeconds: Math.max(30, Math.min(60, partes.join(' ').length / 12)),
    sourceNodes: [],
    xpReward: 5,
  };
}

/**
 * Sprint 16 — Gemini-first summary. 3s timeout, graceful fallback to the
 * deterministic local summary. Never throws to caller.
 *
 * Intentionally Gemini (not Anthropic) — see ADR D1: productive AI
 * runtime is @google/genai.
 */
export async function summarizeWithGemini(args: {
  date: string;
  hallazgosCount: number;
  alertasAtendidas: number;
  crewNames: string[];
  prevDayFindings: Array<{ id: string; title?: string; description?: string }>;
}): Promise<CapsulePayload> {
  const fallback = buildLocalSummary(args);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback;

  const crewLabel = args.crewNames.length > 0 ? args.crewNames.join(', ') : 'el equipo';
  const prompt = [
    'Eres un asesor de prevención de riesgos en construcción. Resume en 30-60s de lectura',
    `los hallazgos del día anterior para la cuadrilla ${crewLabel}.`,
    'Anonimiza individuos: nombra solo la cuadrilla o el rol, nunca nombres propios.',
    'Tono asesor amistoso, en español de Chile, 80-120 palabras.',
    '',
    `Fecha: ${args.date}`,
    `Hallazgos: ${JSON.stringify(args.prevDayFindings).slice(0, 4000)}`,
    `Alertas predictivas atendidas: ${args.alertasAtendidas}`,
  ].join('\n');

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await Promise.race([
      ai.models.generateContent({ model: 'gemini-1.5-flash', contents: prompt }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    const text =
      (result as any)?.text ??
      (result as any)?.response?.text?.() ??
      (result as any)?.candidates?.[0]?.content?.parts?.[0]?.text ??
      null;
    if (typeof text !== 'string' || text.trim().length === 0) return fallback;
    return {
      title: fallback.title,
      body: text.trim(),
      durationSeconds: Math.max(30, Math.min(60, text.length / 12)),
      sourceNodes: fallback.sourceNodes,
      xpReward: 5,
    };
  } catch {
    return fallback;
  }
}

/**
 * Sprint 16 — emit a `safety-learning` Zettelkasten node from the wisdom
 * capsule we just summarized. Idempotent via deterministic id
 * (projectId + date). Best-effort: never blocks the response.
 */
async function emitSafetyLearningNode(args: {
  db: FirebaseFirestore.Firestore;
  projectId: string;
  date: string;
  capsule: CapsulePayload;
  sourceFindings: string[];
  callerUid: string;
}): Promise<void> {
  const id = `safety-learning_${args.projectId}_${args.date}`;
  await args.db.collection('zettelkasten_nodes').doc(id).set(
    {
      title: args.capsule.title,
      description: args.capsule.body.slice(0, 4000),
      type: 'safety-learning',
      severity: 'info',
      metadata: {
        projectId: args.projectId,
        date: args.date,
        durationSeconds: args.capsule.durationSeconds,
      },
      connections: [],
      references: args.sourceFindings,
      projectId: args.projectId,
      createdBy: args.callerUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      idempotencyKey: id,
    },
    { merge: true }
  );
}

// ------------------------------ routes ------------------------------

// ------------------------------ Sprint 17a: stats / engagement ------------------------------

/**
 * Pure aggregator: takes the wisdom_capsules docs for a given project +
 * date range and the totalMembers count, returns the per-day ack-rate
 * series + the top-engaged crew label.
 *
 * Extracted as a pure function so the cache + Firestore wiring can
 * remain trivially testable (see wisdomCapsule.test.ts).
 */
export interface CapsuleStatsRow {
  date: string;
  ackedCount: number;
  totalMembers: number;
  ackRate: number;
}

export interface CapsuleStatsResult {
  byDate: CapsuleStatsRow[];
  topCrew: string | null;
}

export function aggregateCapsuleStats(
  capsules: Array<{ date: string; ackedBy?: string[] }>,
  totalMembers: number,
  crewMembership: Array<{ crewName: string; uids: string[] }>
): CapsuleStatsResult {
  const byDate: CapsuleStatsRow[] = capsules
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => {
      const ackedCount = Array.isArray(c.ackedBy) ? c.ackedBy.length : 0;
      const ackRate = totalMembers > 0 ? ackedCount / totalMembers : 0;
      return { date: c.date, ackedCount, totalMembers, ackRate };
    });

  // Top crew = the crew whose members account for the most acks across
  // the whole window. Ties broken by alphabetical crew name for
  // determinism in tests.
  const ackUidCounts = new Map<string, number>();
  for (const cap of capsules) {
    for (const uid of cap.ackedBy ?? []) {
      ackUidCounts.set(uid, (ackUidCounts.get(uid) ?? 0) + 1);
    }
  }
  let topCrew: string | null = null;
  let topScore = -1;
  for (const { crewName, uids } of crewMembership.slice().sort((a, b) =>
    a.crewName.localeCompare(b.crewName)
  )) {
    const score = uids.reduce((acc, uid) => acc + (ackUidCounts.get(uid) ?? 0), 0);
    if (score > topScore) {
      topScore = score;
      topCrew = crewName;
    }
  }
  if (topScore <= 0) topCrew = null;
  return { byDate, topCrew };
}

// In-memory TTL cache (1h) keyed on `${projectId}|${dateFrom}|${dateTo}`.
// Process-local — fine for the engagement dashboard since it is bound by
// the Cloud Run instance lifetime and the data is not authoritative
// (Firestore remains the source of truth).
const STATS_CACHE_TTL_MS = 60 * 60 * 1000;
const statsCache = new Map<string, { at: number; value: CapsuleStatsResult }>();

export function _clearCapsuleStatsCacheForTests() {
  statsCache.clear();
}

router.get('/wisdom-capsule/stats', verifyAuth, async (req, res) => {
  const uid = req.user!.uid;
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return res.status(400).json({ error: 'dateFrom/dateTo must be YYYY-MM-DD' });
  }
  if (dateFrom > dateTo) {
    return res.status(400).json({ error: 'dateFrom must be <= dateTo' });
  }
  try {
    const db = admin.firestore();
    await assertProjectMember(uid, projectId, db);

    const cacheKey = `${projectId}|${dateFrom}|${dateTo}`;
    const hit = statsCache.get(cacheKey);
    if (hit && Date.now() - hit.at < STATS_CACHE_TTL_MS) {
      return res.json({ success: true, ...hit.value, cached: true });
    }

    const [capsulesSnap, crewsSnap, projectSnap] = await Promise.all([
      db
        .collection('wisdom_capsules')
        .where('projectId', '==', projectId)
        .where('date', '>=', dateFrom)
        .where('date', '<=', dateTo)
        .limit(400)
        .get()
        .catch(() => ({ docs: [] as any[] })),
      db.collection('crews').where('projectId', '==', projectId).limit(50).get().catch(() => ({ docs: [] as any[] })),
      db.collection('projects').doc(projectId).get().catch(() => ({ exists: false, data: () => ({}) } as any)),
    ]);

    const capsules = (capsulesSnap as any).docs.map((d: any) => {
      const data = d.data();
      return { date: String(data.date ?? ''), ackedBy: Array.isArray(data.ackedBy) ? data.ackedBy : [] };
    });
    const crewMembership = (crewsSnap as any).docs.map((d: any) => {
      const data = d.data();
      return {
        crewName: String(data.name ?? d.id),
        uids: Array.isArray(data.memberUids) ? data.memberUids : [],
      };
    });
    const projData = (projectSnap as any).exists ? (projectSnap as any).data() : {};
    const totalMembers = Array.isArray(projData?.members) ? projData.members.length : 0;

    const result = aggregateCapsuleStats(capsules, totalMembers, crewMembership);
    statsCache.set(cacheKey, { at: Date.now(), value: result });
    return res.json({ success: true, ...result, cached: false });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

router.get('/wisdom-capsule/today', verifyAuth, async (req, res) => {
  const uid = req.user!.uid;
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
  const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const db = admin.firestore();
    await assertProjectMember(uid, projectId, db);

    // 1) Cache lookup.
    const cacheKey = `${projectId}_${date}`;
    const cacheRef = db.collection('wisdom_capsules').doc(cacheKey);
    const cached = await cacheRef.get();
    if (cached.exists) {
      const c = cached.data() as { capsule: CapsulePayload };
      if (c?.capsule?.body) {
        return res.json({ success: true, capsule: c.capsule, cached: true });
      }
    }

    // 2) Compute fresh capsule.
    const yesterday = new Date(date);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yISO = yesterday.toISOString().slice(0, 10);

    const [hallazgosSnap, crewsSnap, processesSnap] = await Promise.all([
      db.collection('hallazgos')
        .where('projectId', '==', projectId)
        .where('date', '==', yISO)
        .limit(50)
        .get()
        .catch(() => ({ size: 0, docs: [] as any[] })),
      db.collection('crews').where('projectId', '==', projectId).limit(20).get().catch(() => ({ docs: [] as any[] })),
      db.collection('processes').where('projectId', '==', projectId).limit(50).get().catch(() => ({ docs: [] as any[] })),
    ]);

    const crewNames = (crewsSnap as any).docs.map((d: any) => d.data().name).filter(Boolean) as string[];
    const alertasAtendidas = (processesSnap as any).docs.reduce(
      (acc: number, d: any) => acc + (d.data().alertsResponded ?? 0),
      0
    );
    const hallazgoDocs = ((hallazgosSnap as any).docs ?? []).map((d: any) => ({
      id: d.id,
      title: d.data()?.title,
      description: d.data()?.description,
    }));
    const sourceNodes = hallazgoDocs.map((h: any) => h.id);

    const capsule = await summarizeWithGemini({
      date,
      hallazgosCount: (hallazgosSnap as any).size ?? sourceNodes.length,
      alertasAtendidas,
      crewNames,
      prevDayFindings: hallazgoDocs,
    });
    capsule.sourceNodes = sourceNodes;

    // 3) Persist cache + emit safety-learning node (best-effort).
    await cacheRef.set(
      {
        projectId,
        date,
        capsule,
        ackedBy: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    try {
      await emitSafetyLearningNode({
        db,
        projectId,
        date,
        capsule,
        sourceFindings: sourceNodes,
        callerUid: uid,
      });
    } catch {
      // Never block the user-facing response on an internal node emission failure.
    }

    return res.json({ success: true, capsule, cached: false });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

/**
 * Sprint 16 — POST /api/wisdom-capsule/ack
 *   body: { projectId, date }
 *
 * Marks the capsule as acknowledged by the calling uid and awards the
 * `wisdom_capsule_completed` XP (5 points, see XP_AMOUNTS). Idempotent:
 * the same uid acking the same capsule twice yields exactly one XP
 * award (we use `arrayUnion` + a transaction guard).
 */
router.post('/wisdom-capsule/ack', verifyAuth, async (req, res) => {
  const uid = req.user!.uid;
  const { projectId, date } = req.body ?? {};
  if (typeof projectId !== 'string' || !projectId) {
    return res.status(400).json({ error: 'projectId required' });
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  try {
    const db = admin.firestore();
    await assertProjectMember(uid, projectId, db);
    const ref = db.collection('wisdom_capsules').doc(`${projectId}_${date}`);
    let awarded = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = (snap.exists ? snap.data() : {}) as { ackedBy?: string[] };
      const acks = Array.isArray(data.ackedBy) ? data.ackedBy : [];
      if (acks.includes(uid)) {
        awarded = false;
        return;
      }
      tx.set(
        ref,
        {
          projectId,
          date,
          ackedBy: [...acks, uid],
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      awarded = true;
    });
    await auditServerEvent(req, 'wisdomCapsule.ack', 'wisdomCapsule', { projectId, date, awarded }, { projectId });
    return res.json({ success: true, xpAwarded: awarded ? 5 : 0, reason: 'wisdom_capsule_completed' });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

export default router;

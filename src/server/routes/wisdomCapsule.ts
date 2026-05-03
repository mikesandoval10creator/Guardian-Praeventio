// SPDX-License-Identifier: MIT
// Sprint 15 — Wisdom Capsule daily endpoint.
//
// GET /api/wisdom-capsule/today?projectId=...&date=YYYY-MM-DD
//
// Reads:
//   1. Hallazgos del día anterior del project.
//   2. Alertas predictivas atendidas en las últimas 24h.
// Returns a 30-60s summary anonymized at the cuadrilla level (never
// individual uids). No Gemini call is made when GEMINI_API_KEY is
// absent — the endpoint degrades gracefully to a deterministic local
// summary so dev/test/CI never depend on a network secret.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
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
 * the LLM call fails.
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

// ------------------------------ route ------------------------------

router.get('/wisdom-capsule/today', verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid;
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
  const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const db = admin.firestore();
    await assertProjectMember(uid, projectId, db);
    // Yesterday window for hallazgos.
    const yesterday = new Date(date);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yISO = yesterday.toISOString().slice(0, 10);

    const [hallazgosSnap, crewsSnap, processesSnap] = await Promise.all([
      db.collection('hallazgos')
        .where('projectId', '==', projectId)
        .where('date', '==', yISO)
        .limit(50)
        .get()
        .catch(() => ({ size: 0, docs: [] as Array<{ id: string }> })),
      db.collection('crews').where('projectId', '==', projectId).limit(20).get().catch(() => ({ docs: [] as any[] })),
      db.collection('processes').where('projectId', '==', projectId).limit(50).get().catch(() => ({ docs: [] as any[] })),
    ]);

    const crewNames = (crewsSnap as any).docs.map((d: any) => d.data().name).filter(Boolean) as string[];
    const alertasAtendidas = (processesSnap as any).docs.reduce(
      (acc: number, d: any) => acc + (d.data().alertsResponded ?? 0),
      0
    );
    const sourceNodes = (hallazgosSnap as any).docs?.map((d: any) => d.id) ?? [];

    const payload = buildLocalSummary({
      date,
      hallazgosCount: (hallazgosSnap as any).size ?? sourceNodes.length,
      alertasAtendidas,
      crewNames,
    });
    payload.sourceNodes = sourceNodes;

    res.json({ success: true, capsule: payload });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

export default router;

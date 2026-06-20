// Praeventio Guard — Fase F.9 Data Quality (pre-IA gap detector).
//
// Endpoint dedicado para `/api/sprint-k/:projectId/data-quality`.
// Migrado del monolito `sprintK.ts` (2026-05-18).
//
// Lee colecciones canónicas del proyecto (workers, projects, EPP
// assignments, documents, incidents, machines, trainings) y corre el
// scanner determinístico `scanAll()`. Devuelve un `DataQualityReport`
// con score 0-100 + breakdown por dominio + top gaps para el panel
// `<DataQualityCard>`.
//
// El scanner no requiere proyecto context — es puramente data-driven.
// Pero scopeamos los reads por projectId para que cada faena vea solo
// sus propios gaps.
//
// Codex P2 fixes preservados (PR #309 rounds 2-4):
//   - workers: nested `projects/{id}/workers`
//   - documents/incidents/assets/training: top-level filtrados por projectId
//   - assets → mapear `name`/`nextMaintenance` a `code`/`nextMaintenanceAt`
//   - trainings: union 3 fuentes (top-level + 2 nested) con first-wins dedupe
//   - incidents: normalizar `summary`→`description` y `rootCause` (string|object)→
//     `rootCauseCategory` para que el scanner no marque false gaps.

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

async function resolveTenantId(
  _callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
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

router.get('/:projectId/data-quality', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { scanAll, pickTopGaps } = await import(
      '../../services/dataQuality/incompletenessScanner.js'
    );

    const db = admin.firestore();

    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`dataQuality.read.${label}.failed`, err);
        return [];
      }
    };

    const projectRef = db.collection('projects').doc(projectId);
    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    const [
      workers,
      epps,
      documents,
      incidents,
      machines,
      trainings,
      thisProject,
    ] = await Promise.all([
      safeRead('workers', async () =>
        (await projectRef.collection('workers').get()).docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })),
      ),
      safeRead('epps', async () =>
        (await projectRef.collection('epp_assignments').get()).docs.map(
          (d) => ({ id: d.id, ...d.data() }),
        ),
      ),
      safeRead('documents', async () =>
        (await byProject('project_documents').get()).docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })),
      ),
      safeRead('incidents', async () => {
        const snap = await byProject('incidents').get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            ...data,
            description: data.description ?? data.summary,
            rootCauseCategory:
              data.rootCauseCategory ??
              (typeof data.rootCause === 'string'
                ? data.rootCause
                : (data.rootCause as { primaryCauseKind?: string } | undefined)
                    ?.primaryCauseKind),
          };
        });
      }),
      safeRead('machines', async () => {
        const snap = await byProject('assets').get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            ...data,
            code: data.code ?? data.name,
            nextMaintenanceAt: data.nextMaintenanceAt ?? data.nextMaintenance,
          };
        });
      }),
      safeRead('trainings', async () => {
        const [topSnap, nestedSnap, assignSnap] = await Promise.all([
          byProject('training').get(),
          projectRef.collection('trainings').get(),
          projectRef.collection('training_assignments').get(),
        ]);
        const map = new Map<string, Record<string, unknown>>();
        for (const d of topSnap.docs) {
          map.set(d.id, { id: d.id, ...d.data() });
        }
        for (const d of nestedSnap.docs) {
          if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
        }
        for (const d of assignSnap.docs) {
          if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
        }
        return Array.from(map.values());
      }),
      safeRead('project', async () => {
        const snap = await projectRef.get();
        return snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
      }),
    ]);

    const report = scanAll({
      workers: workers as any,
      projects: thisProject as any,
      eppAssignments: epps as any,
      documents: documents as any,
      incidents: incidents as any,
      machines: machines as any,
      trainings: trainings as any,
    });

    const topGaps = pickTopGaps(report, 10);

    return res.json({ report, topGaps });
  } catch (err) {
    logger.error?.('dataQuality.error', err);
    captureRouteError(err, 'dataQuality');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// GET /:projectId/document-hygiene
//
// Salud documental REAL para `<DocumentHygienePanel>` y `<DocConfidenceCard>`.
//
// Deriva `DocumentRecord[]` (firmas SI/NO, accesos 90d, firmas de lectura,
// referencia normativa, vínculo operacional) a partir de TRES colecciones
// canónicas — sin fabricar campos:
//   1. projects/{pid}/documents        — metadata del documento
//   2. projects/{pid}/read_receipts    — acuses DS44/RIOHS (documentId__workerUid)
//   3. nodes (where projectId)         — nodos DOCUMENT vinculados a operación
//
// El motor determinístico `documentHygieneEngine` corre client-side sobre
// estos records (igual que `incompletenessScanner` arriba); aquí solo
// cableamos la LECTURA real. Empty-state honesto: si no hay documentos,
// devuelve `{ documents: [] }` y el panel muestra "0 problemas".
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/document-hygiene', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const projectRef = db.collection('projects').doc(projectId);

    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`documentHygiene.read.${label}.failed`, err);
        return [];
      }
    };

    const [docs, receipts, docNodes] = await Promise.all([
      safeRead('documents', async () =>
        (await projectRef.collection('documents').get()).docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        })),
      ),
      safeRead('read_receipts', async () =>
        (await projectRef.collection('read_receipts').get()).docs.map(
          (d) => d.data() as Record<string, unknown>,
        ),
      ),
      safeRead('nodes', async () => {
        const snap = await db
          .collection('nodes')
          .where('projectId', '==', projectId)
          .limit(2000)
          .get();
        return snap.docs
          .map((d) => d.data() as Record<string, unknown>)
          .filter((n) => n.type === 'document' || n.type === 'Documento');
      }),
    ]);

    // Index read receipts by documentId for real counts.
    const NINETY_DAYS_MS = 90 * 86_400_000;
    const nowMs = Date.now();
    const receiptCountByDoc = new Map<string, number>();
    const recentAccessByDoc = new Map<string, number>();
    for (const r of receipts) {
      const documentId = typeof r.documentId === 'string' ? r.documentId : null;
      if (!documentId) continue;
      receiptCountByDoc.set(
        documentId,
        (receiptCountByDoc.get(documentId) ?? 0) + 1,
      );
      const acked =
        typeof r.acknowledgedAt === 'string' ? Date.parse(r.acknowledgedAt) : NaN;
      if (!Number.isNaN(acked) && nowMs - acked <= NINETY_DAYS_MS) {
        recentAccessByDoc.set(
          documentId,
          (recentAccessByDoc.get(documentId) ?? 0) + 1,
        );
      }
    }

    // Index operational links: a DOCUMENT node whose metadata.documentId points
    // at a real document means that document is wired into the risk graph.
    const linkedDocIds = new Set<string>();
    for (const n of docNodes) {
      const meta = (n.metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.documentId === 'string') linkedDocIds.add(meta.documentId);
    }

    const NORM_CATEGORIES = new Set(['legal', 'sst', 'normativa', 'norma']);

    const documents = docs.map((d) => {
      const category = (
        typeof d.category === 'string' ? d.category : ''
      ).toLowerCase();
      const tags = Array.isArray(d.tags) ? (d.tags as unknown[]) : [];
      const referencesNorm =
        NORM_CATEGORIES.has(category) ||
        tags.some(
          (tg) =>
            typeof tg === 'string' &&
            /legal|norma|sst|nch|ds\s?\d|iso/i.test(tg),
        );
      const readReceiptCount = receiptCountByDoc.get(d.id) ?? 0;
      const accessCount90d = recentAccessByDoc.get(d.id) ?? 0;
      const updatedAt =
        typeof d.updatedAt === 'string'
          ? d.updatedAt
          : typeof d.createdAt === 'string'
            ? d.createdAt
            : new Date(0).toISOString();
      return {
        id: d.id,
        title: typeof d.name === 'string' ? d.name : d.id,
        kind:
          typeof d.type === 'string'
            ? d.type
            : typeof d.category === 'string'
              ? d.category
              : 'document',
        version: typeof d.version === 'string' ? d.version : '1.0',
        approvedByUid:
          typeof d.approvedByUid === 'string' ? d.approvedByUid : undefined,
        approvedAt: typeof d.approvedAt === 'string' ? d.approvedAt : undefined,
        updatedAt,
        // A document is considered to have a valid signature only when at
        // least one worker has formally acknowledged reading it (DS44 acuse).
        hasValidSignature: readReceiptCount > 0,
        accessCount90d,
        readReceiptCount,
        referencesNorm,
        isLinkedToOperations: linkedDocIds.has(d.id),
      };
    });

    return res.json({ documents });
  } catch (err) {
    logger.error?.('documentHygiene.error', err);
    captureRouteError(err, 'documentHygiene');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;

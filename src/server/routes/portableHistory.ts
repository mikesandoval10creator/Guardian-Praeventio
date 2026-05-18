// Praeventio Guard — F.18 Historial Profesional Portátil del Trabajador.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/workers/:workerUid/portable-history*`.
// Migrado del monolito `sprintK.ts` (2026-05-17) — Sprint K reformulation
// (docs/SPRINT_K_REFORMULATED.md).
//
// Ley 19.628 (Chile) — datos personales del trabajador. El consent vive
// con el worker (no con la cuadrilla) y se respeta en cada lectura.
//
// 3 endpoints:
//   GET  /:projectId/workers/:workerUid/portable-history          → snapshot bundle
//   POST /:projectId/workers/:workerUid/portable-history/consent  → actualiza flags
//   GET  /:projectId/workers/:workerUid/portable-history/export   → blob descarga

import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────

export interface PortableHistoryConsent {
  allowsPortableExport: boolean;
  includesIncidents: boolean;
  updatedAt: string;
  updatedByUid: string;
}

export interface PortableHistoryBundle {
  schemaVersion: '1.0.0';
  generatedAt: string;
  workerUid: string;
  consent: PortableHistoryConsent;
  identity: {
    fullName: string;
    rut: string;
    email?: string | null;
  };
  trainings: Record<string, unknown>[];
  eppDeliveries: Record<string, unknown>[];
  aptitudes: Record<string, unknown>[];
  criticalRoles: Record<string, unknown>[];
  signatures: Record<string, unknown>[];
  incidents: Record<string, unknown>[];
  disclaimer: string;
}

export const PORTABLE_HISTORY_DISCLAIMER =
  'Este documento es un resumen profesional generado por Praeventio Guard ' +
  'según la Ley 19.628 (Chile). Los datos son responsabilidad del empleador ' +
  'que los registra. El trabajador autorizó su exportación mediante consent ' +
  'explícito. No constituye un certificado oficial; cada registro mantiene ' +
  'su trazabilidad criptográfica (checksum SHA-256).';

// ── Guard helpers ─────────────────────────────────────────────────────

async function resolveTenantId(
  callerUid: string,
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

function isOwnerOrAdmin(callerUid: string, workerUid: string, isAdmin: boolean): boolean {
  return isAdmin || callerUid === workerUid;
}

// ── Bundle builder ────────────────────────────────────────────────────

async function buildPortableHistoryBundle(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string,
  workerUid: string,
): Promise<PortableHistoryBundle | null> {
  const base = `tenants/${tenantId}/projects/${projectId}`;

  const workerSnap = await db.collection(`${base}/workers`).doc(workerUid).get();
  if (!workerSnap.exists) return null;
  const worker = workerSnap.data() as Record<string, unknown>;

  // Consent doc (separate so changes don't trigger worker writes).
  const consentSnap = await db
    .collection(`${base}/workers/${workerUid}/portable_history`)
    .doc('consent')
    .get();
  const consentData = consentSnap.exists
    ? (consentSnap.data() as Partial<PortableHistoryConsent>)
    : {};
  const consent: PortableHistoryConsent = {
    allowsPortableExport: consentData.allowsPortableExport === true,
    includesIncidents: consentData.includesIncidents === true,
    updatedAt: typeof consentData.updatedAt === 'string' ? consentData.updatedAt : new Date().toISOString(),
    updatedByUid: typeof consentData.updatedByUid === 'string' ? consentData.updatedByUid : workerUid,
  };

  // Read worker sub-collections in parallel (each is best-effort).
  const safeReadDocs = async (col: string): Promise<Record<string, unknown>[]> => {
    try {
      const snap = await db
        .collection(`${base}/workers/${workerUid}/${col}`)
        .limit(500)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    } catch (err) {
      logger.warn?.(`sprintK.portableHistory.read.${col}.failed`, err);
      return [];
    }
  };

  const [trainings, eppDeliveries, aptitudes, criticalRoles, signatures, incidents] =
    await Promise.all([
      safeReadDocs('trainings'),
      safeReadDocs('epp_deliveries'),
      safeReadDocs('aptitudes'),
      safeReadDocs('critical_roles'),
      safeReadDocs('signatures'),
      consent.includesIncidents ? safeReadDocs('incidents') : Promise.resolve([]),
    ]);

  const fullName = typeof worker.name === 'string' ? worker.name : '';
  const rut = typeof worker.rut === 'string' ? worker.rut : '';
  const email = typeof worker.email === 'string' ? worker.email : null;

  const identity: PortableHistoryBundle['identity'] = consent.allowsPortableExport
    ? { fullName, rut, email }
    : { fullName: '[REDACTED]', rut: '[REDACTED]', email: null };

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    workerUid,
    consent,
    identity,
    trainings,
    eppDeliveries,
    aptitudes,
    criticalRoles,
    signatures,
    incidents,
    disclaimer: PORTABLE_HISTORY_DISCLAIMER,
  };
}

function bundleToCanonicalJson(bundle: PortableHistoryBundle): string {
  return JSON.stringify(bundle, null, 2);
}

// ── Endpoint 1: GET bundle ────────────────────────────────────────────

router.get(
  '/:projectId/workers/:workerUid/portable-history',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const isAdmin = Boolean((req.user as { admin?: boolean }).admin);
    const { projectId, workerUid } = req.params;
    if (!projectId || !workerUid) return res.status(400).json({ error: 'invalid_params' });
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!isOwnerOrAdmin(callerUid, workerUid, isAdmin)) {
      return res.status(403).json({ error: 'forbidden_not_owner_or_admin' });
    }
    try {
      const db = admin.firestore();
      const bundle = await buildPortableHistoryBundle(db, g.tenantId, projectId, workerUid);
      if (!bundle) return res.status(404).json({ error: 'worker_not_found' });
      return res.json({ bundle });
    } catch (err) {
      logger.error?.('sprintK.portableHistory.get.error', err);
      captureRouteError(err, 'sprintK.portableHistory.get');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── Endpoint 2: POST consent ──────────────────────────────────────────

const consentSchema = z.object({
  allowsPortableExport: z.boolean(),
  includesIncidents: z.boolean(),
});

router.post(
  '/:projectId/workers/:workerUid/portable-history/consent',
  verifyAuth,
  validate(consentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const isAdmin = Boolean((req.user as { admin?: boolean }).admin);
    const { projectId, workerUid } = req.params;
    if (!projectId || !workerUid) return res.status(400).json({ error: 'invalid_params' });
    const body = req.body as z.infer<typeof consentSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!isOwnerOrAdmin(callerUid, workerUid, isAdmin)) {
      return res.status(403).json({ error: 'forbidden_not_owner_or_admin' });
    }
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const consent: PortableHistoryConsent = {
        allowsPortableExport: body.allowsPortableExport,
        includesIncidents: body.includesIncidents,
        updatedAt: now,
        updatedByUid: callerUid,
      };
      await db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/workers/${workerUid}/portable_history`,
        )
        .doc('consent')
        .set(consent, { merge: true });
      return res.json({ ok: true, consent });
    } catch (err) {
      logger.error?.('sprintK.portableHistory.consent.error', err);
      captureRouteError(err, 'sprintK.portableHistory.consent');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── Endpoint 3: GET export ────────────────────────────────────────────

router.get(
  '/:projectId/workers/:workerUid/portable-history/export',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const isAdmin = Boolean((req.user as { admin?: boolean }).admin);
    const { projectId, workerUid } = req.params;
    if (!projectId || !workerUid) return res.status(400).json({ error: 'invalid_params' });
    const format = typeof req.query.format === 'string' ? req.query.format : 'json';
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!isOwnerOrAdmin(callerUid, workerUid, isAdmin)) {
      return res.status(403).json({ error: 'forbidden_not_owner_or_admin' });
    }
    try {
      const db = admin.firestore();
      const bundle = await buildPortableHistoryBundle(db, g.tenantId, projectId, workerUid);
      if (!bundle) return res.status(404).json({ error: 'worker_not_found' });
      // Hard gate: Ley 19.628 art. 4° — consent explícito para finalidad
      // de disposición externa.
      if (!bundle.consent.allowsPortableExport) {
        return res.status(403).json({ error: 'consent_required_for_export' });
      }
      const canonical = bundleToCanonicalJson(bundle);
      const checksum = createHash('sha256').update(canonical).digest('hex');

      // PDF format (optional — pdfkit may not be installed).
      if (format === 'pdf') {
        try {
          const pdfkitMod = (await import('pdfkit').catch(() => null)) as
            | { default: new (opts?: { size?: string; margin?: number }) => unknown }
            | null;
          if (!pdfkitMod) {
            return res.status(503).json({
              error: 'pdf_unavailable',
              detail: 'pdfkit_not_installed',
            });
          }
          const PDFDocument = pdfkitMod.default;
          const doc = new PDFDocument({ size: 'A4', margin: 50 }) as unknown as {
            on: (ev: string, cb: (chunk?: Buffer) => void) => void;
            end: () => void;
            fontSize: (n: number) => unknown;
            text: (s: string, opts?: Record<string, unknown>) => unknown;
            moveDown: (n?: number) => unknown;
          };
          const chunks: Buffer[] = [];
          doc.on('data', (chunk?: Buffer) => {
            if (chunk) chunks.push(chunk);
          });
          const finished = new Promise<Buffer>((resolve, reject) => {
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', (err?: Buffer) => reject(err));
          });
          doc.fontSize(18);
          doc.text('Historial Profesional Portátil', { align: 'center' });
          doc.moveDown(0.5);
          doc.fontSize(9);
          doc.text(bundle.disclaimer, { align: 'justify' });
          doc.moveDown(1);
          doc.fontSize(11);
          doc.text(`Trabajador: ${bundle.identity.fullName}`);
          doc.text(`RUT: ${bundle.identity.rut}`);
          if (bundle.identity.email) doc.text(`Email: ${bundle.identity.email}`);
          doc.text(`Generado: ${bundle.generatedAt}`);
          doc.text(`Checksum SHA-256: ${checksum}`);
          doc.moveDown(0.5);
          doc.text(`Capacitaciones: ${bundle.trainings.length}`);
          doc.text(`Entregas de EPP: ${bundle.eppDeliveries.length}`);
          doc.text(`Aptitudes médicas: ${bundle.aptitudes.length}`);
          doc.text(`Roles críticos: ${bundle.criticalRoles.length}`);
          doc.text(`Firmas DDR/ODI/RIOHS: ${bundle.signatures.length}`);
          doc.text(`Incidentes: ${bundle.consent.includesIncidents ? bundle.incidents.length : 'REDACTED'}`);
          doc.end();
          const pdfBuf = await finished;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="portable-history-${workerUid}.pdf"`);
          res.setHeader('X-Portable-History-Checksum', checksum);
          return res.status(200).send(pdfBuf);
        } catch (pdfErr) {
          logger.warn?.('sprintK.portableHistory.export.pdf_failed', pdfErr);
          return res.status(503).json({ error: 'pdf_unavailable', detail: 'pdf_generation_failed' });
        }
      }

      // JSON (default).
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="portable-history-${workerUid}.json"`);
      res.setHeader('X-Portable-History-Checksum', checksum);
      return res.status(200).send(canonical);
    } catch (err) {
      logger.error?.('sprintK.portableHistory.export.error', err);
      captureRouteError(err, 'sprintK.portableHistory.export');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;

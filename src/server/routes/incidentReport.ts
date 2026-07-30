// Praeventio Guard — incident official report (Ley 19.628 + SUSESO legal exposure).
//
// Hardened reconstruction endpoint:
//   • POST /api/sprint-k/:projectId/incidents/:incidentId/report
//
// Title, content and metadata are reconstructed server-side from the
// canonical incident document. The caller never gets to inject brand-
// damaging text into a PDF that carries the Praeventio name and the
// "Válido como registro interno conforme a directrices Minsal" footer.
//
// The legacy client-content path lives in `./reports.ts` (POST
// /api/reports/draft) and is explicitly marked BORRADOR — it cannot
// claim to be a SUSESO report.
//
// Spec: ticket 39baa66d-73fe-8113-92d3-f77c21e69724 (P0 legal).

import { Router } from 'express';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';

const router = Router();

const SEVERITY_LABEL: Record<string, string> = {
  low: 'LEVE',
  medium: 'MEDIO',
  high: 'ALTO',
  critical: 'CRÍTICO',
};

function pdfEscape(s: string): string {
  // PDFKit text() handles escaping internally. We just need to ensure
  // we never let the raw body control the brand/footer strings.
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

interface CanonicalIncident {
  id: string;
  projectId: string;
  occurredAt: string;
  reportedAt: string;
  severity: string;
  summary: string;
  description?: string;
  locationLabel?: string;
  reportedByUid: string;
}

async function resolveTenantId(
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  return null;
}

async function loadCanonicalIncident(
  incidentId: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<CanonicalIncident | null> {
  const snap = await db.collection('incidents').doc(incidentId).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  if (typeof d.projectId !== 'string' || d.projectId !== projectId) return null;
  const occurredAt =
    typeof d.occurredAt === 'string'
      ? d.occurredAt
      : typeof d.createdAt === 'string'
        ? d.createdAt
        : null;
  const reportedAt =
    typeof d.reportedAt === 'string' ? d.reportedAt : occurredAt;
  if (!occurredAt || !reportedAt) return null;
  const sev = String(d.severity ?? 'medium');
  let locationLabel: string | undefined;
  if (d.location && typeof d.location === 'object') {
    const loc = d.location as { site?: unknown; area?: unknown; address?: unknown };
    const parts = [loc.site, loc.area, loc.address]
      .filter((x) => typeof x === 'string' && x.length > 0)
      .map((x) => String(x));
    if (parts.length > 0) locationLabel = parts.join(' · ');
  } else if (typeof d.location === 'string' && d.location.length > 0) {
    locationLabel = d.location;
  }
  return {
    id: snap.id,
    projectId,
    occurredAt,
    reportedAt,
    severity: SEVERITY_LABEL[sev] ?? sev.toUpperCase(),
    summary: String(d.summary ?? d.description ?? snap.id),
    description: typeof d.description === 'string' ? d.description : undefined,
    locationLabel,
    reportedByUid: String(d.reportedByUid ?? d.userId ?? 'unknown'),
  };
}

function canonicalJson(incident: CanonicalIncident): string {
  // Deterministic JSON for the SHA-256 signature (sort keys, no spaces).
  return JSON.stringify(incident, Object.keys(incident).sort());
}

function buildOfficialPdfText(incident: CanonicalIncident, sha256: string): string {
  // Plain-text representation rendered by PDFKit. The brand/footer
  // strings here are server-controlled and NEVER accept client input.
  const lines: string[] = [
    'Praeventio Guard — Reporte Oficial de Incidente',
    '',
    `Doc ID: ${incident.id}`,
    `Proyecto: ${incident.projectId}`,
    `Severidad: ${incident.severity}`,
    `Ocurrido: ${incident.occurredAt}`,
    `Reportado: ${incident.reportedAt}`,
    `Reportado por (uid): ${incident.reportedByUid}`,
  ];
  if (incident.locationLabel) lines.push(`Ubicación: ${incident.locationLabel}`);
  lines.push('', 'Resumen autoritativo:');
  lines.push(incident.summary);
  if (incident.description && incident.description !== incident.summary) {
    lines.push('', 'Descripción autoritativa:');
    lines.push(incident.description);
  }
  lines.push('', `Signature (SHA-256 canonical JSON): ${sha256}`);
  lines.push('');
  lines.push(
    'Documento reconstruido server-side desde datos autoritativos. Válido como registro interno conforme a directrices Minsal.',
  );
  return lines.map(pdfEscape).join('\n');
}

router.post(
  '/:projectId/incidents/:incidentId/report',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, incidentId } = req.params;
    if (!projectId || !incidentId) {
      return res.status(400).json({ error: 'invalid_params' });
    }
    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }
    let incident: CanonicalIncident | null = null;
    let sha256 = '';
    try {
      const db = admin.firestore();
      const tenantId = await resolveTenantId(projectId, db);
      if (!tenantId) return res.status(404).json({ error: 'tenant_not_found' });
      const loaded = await loadCanonicalIncident(incidentId, projectId, db);
      if (!loaded) {
        return res.status(404).json({ error: 'incident_not_found' });
      }
      incident = loaded;
      sha256 = crypto
        .createHash('sha256')
        .update(canonicalJson(loaded))
        .digest('hex');

      const PDFDocument = (await import('pdfkit')).default;
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `Reporte Oficial Incidente ${incident.id}`,
          Author: 'Praeventio Guard',
        },
      });
      const buffers: Buffer[] = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuf = Buffer.concat(buffers);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="Reporte_Oficial_${incident!.id}.pdf"`,
        );
        res.setHeader('X-Report-Sha256', sha256);
        res.setHeader('X-Report-Incident-Id', incident!.id);
        res.setHeader('X-Praeventio-Doc-Tier', 'official');
        res.status(200).send(pdfBuf);
        auditServerEvent(req, 'reports.official_generated', 'reports', {
          incidentId: incident!.id,
          projectId,
          bytes: pdfBuf.length,
          sha256,
        }).catch(() => undefined);
      });
      doc.text(buildOfficialPdfText(incident!, sha256));
      doc.end();
      return undefined;
    } catch (err) {
      logger.error?.('sprintK.incidentReport.error', err);
      captureRouteError(err, 'sprintK.incidentReport');
      if (!res.headersSent) {
        return res.status(500).json({ error: 'internal_error' });
      }
      return undefined;
    }
  },
);

export default router;

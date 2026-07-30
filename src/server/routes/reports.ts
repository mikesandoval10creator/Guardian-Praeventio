// Praeventio Guard — Round 19 R2 Phase 4 split.
//
// PDF generation endpoints. After the P0 fabrication fix (ticket
// 39baa66d-73fe-8113-92d3-f77c21e69724) the public contract changed:
//   • POST /api/reports/draft — ad-hoc PDFs marked BORRADOR. They DO
//     NOT carry the SUSESO / Minsal official claim and DO NOT bear the
//     `Reporte_SUSESO_*` filename. Used for supervisor notes and
//     other client-authored artefacts that are NOT legal records.
//   • POST /api/sprint-k/:projectId/incidents/:incidentId/report —
//     the official reconstruction. Title/content/metadata come from
//     the canonical incident, the PDF is SHA-256 signed and carries
//     the official footer. See ./incidentReport.ts.
//
// The legacy POST /api/reports/generate-pdf path now behaves like
// /draft and is kept as a deprecated alias for clients that still
// reference it (e.g. Emergency.tsx). It is NEVER a SUSESO report.
//
// Body limit: the per-route 2MB JSON parser is mounted in server.ts.

import { Router } from 'express';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';

function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}

const router = Router();

// Schema for both /draft and the legacy /generate-pdf endpoint.
// `content` is large (full narrative), so we cap at 64kB; the per-route
// body parser in server.ts allows up to 2MB to tolerate bulky payloads.
const draftSchema = z.object({
  type: z.enum(['general', 'incident', 'safety', 'compliance', 'inspection', 'training']).default('general'),
  title: z.string().min(1).max(256),
  description: z.string().max(8192).optional(),
  content: z.string().max(65536).optional(),
  projectId: z.string().min(1).max(128).optional(),
});

async function renderDraftPdf(
  req: import('express').Request,
  res: import('express').Response,
  body: z.infer<typeof draftSchema>,
): Promise<void> {
  const { title, content, type = 'general' } = body;
  try {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: title || 'Borrador',
        Author: 'Praeventio Guard',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      const safeName = `Borrador_${Date.now()}.pdf`;
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeName}"`,
      );
      res.setHeader('X-Praeventio-Doc-Tier', 'draft');
      res.setHeader('Content-Length', pdfData.length.toString());
      res.end(pdfData);
      auditServerEvent(req, 'reports.draft_generated', 'reports', {
        type,
        bytes: pdfData.length,
      }).then((ok: boolean) => {
        if (!ok) {
          sentryCapture(new Error('audit_write_failed'), {
            endpoint: 'POST /api/reports/draft',
            tags: { audit_event: 'reports.draft_generated' },
          });
        }
      });
    });

    // Header — explicitly BORRADOR (NOT an official Praeventio record).
    doc.rect(0, 0, doc.page.width, 80).fill('#f59e0b'); // amber
    doc.fill('#000000').fontSize(20).font('Helvetica-Bold').text('BORRADOR', 50, 25);
    doc.fontSize(9).font('Helvetica').text('NO ES REPORTE OFICIAL. NO VÁLIDO COMO REGISTRO ANTE SUSESO / MINSAL.', 50, 55);

    doc.moveDown(3);
    doc.fillColor('#000000').fontSize(16).font('Helvetica-Bold').text(title || 'Borrador', { align: 'center' });
    doc.moveDown(1);

    const lines = content ? content.split('\n') : ['Sin contenido registrado.'];
    doc.fillColor('#000000').fontSize(11).font('Helvetica');
    lines.forEach((line: string) => {
      if (line.startsWith('# ')) {
        doc.moveDown().font('Helvetica-Bold').fontSize(14).text(line.replace('# ', '')).font('Helvetica').fontSize(11);
      } else if (line.startsWith('## ')) {
        doc.moveDown().font('Helvetica-Bold').fontSize(12).text(line.replace('## ', '')).font('Helvetica').fontSize(11);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        doc.text(`  • ${line.substring(2)}`, { indent: 10 });
      } else if (line.trim() === '') {
        doc.moveDown(0.5);
      } else {
        doc.text(line, { align: 'justify' });
      }
    });

    doc.moveDown(2);
    doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text(
      `Tipo: ${type.toUpperCase()} · Generado: ${new Date().toISOString()} · Tier: BORRADOR`,
      { align: 'right' },
    );

    doc.end();
  } catch (error) {
    logger.error('report_draft_pdf_generation_failed', error);
    sentryCapture(error, { endpoint: '/api/reports/draft', tags: { method: 'POST', type: type ?? 'general' } });
    res.status(500).json({ error: 'internal_error' });
  }
}

// New canonical path.
router.post('/reports/draft', verifyAuth, validate(draftSchema), async (req, res) => {
  await renderDraftPdf(req, res, req.body);
});

// Legacy alias — same behavior. Kept so clients (e.g. Emergency.tsx)
// continue to work without claiming official status.
router.post('/reports/generate-pdf', verifyAuth, validate(draftSchema), async (req, res) => {
  await renderDraftPdf(req, res, req.body);
});

export default router;

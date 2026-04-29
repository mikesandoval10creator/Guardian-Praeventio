// Praeventio Guard — Round 19 R2 Phase 4 split.
//
// PDF report generation extracted from server.ts:
//   • POST /api/reports/generate-pdf — server-side PDFKit pipeline.
//     Renders an A4 occupational-safety report (header band, metadata box,
//     pseudo-markdown body, footer with page numbers + Minsal disclaimer)
//     and streams the resulting Buffer back as `application/pdf`.
//
// Body limit: this endpoint legitimately needs >64kb payloads (the report
// `content` block is the entire incident narrative + AI-generated summary).
// The per-route `largeBodyJson` opt-in lives in server.ts as a
// `req.path === '/api/reports/generate-pdf'` short-circuit BEFORE the global
// JSON parser — that wiring stays in server.ts because moving it would
// require restructuring how the body parser is mounted globally.
//
// Mounted via `app.use('/api', reportsRouter)`. The route declares the full
// `/reports/generate-pdf` suffix so the on-the-wire path remains
// /api/reports/generate-pdf byte-for-byte.
//
// Audit trail (Round 17 R1): emits `reports.pdf_generated` AFTER the buffer
// is concatenated. Wrapped in try/catch — observability MUST NOT taint the
// already-sent response.

import { Router } from 'express';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { auditServerEvent } from '../middleware/auditLog.js';

const router = Router();

router.post('/reports/generate-pdf', verifyAuth, async (req, res) => {
  const { incidentId, title, content, type = 'general', metadata = {} } = req.body;

  try {
    const PDFDocument = (await import('pdfkit')).default;

    // Create a document with styling and margins appropriate for legal/occupational reports
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: title || 'Reporte de Seguridad',
        Author: 'Praeventio Guard AI',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);

      // We could optionally save this buffer to Firebase Storage here before sending it down

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=Reporte_SUSESO_${incidentId || Date.now()}.pdf`,
      );
      res.setHeader('Content-Length', pdfData.length.toString());
      res.end(pdfData);
      // Round 17 R1 — emit audit row on successful generation. Wrapped so an
      // audit-write failure can't taint a response we already sent.
      try {
        void auditServerEvent(req, 'reports.pdf_generated', 'reports', {
          type,
          incidentId: incidentId ?? null,
          bytes: pdfData.length,
        });
      } catch {
        /* observability never breaks request path */
      }
    });

    // --- PDF Construction ---

    // 1. Header (Logo/Brand Placeholder)
    doc.rect(0, 0, doc.page.width, 100).fill('#0f172a'); // Slate 900 background header
    doc.fill('#ffffff').fontSize(24).font('Helvetica-Bold').text('Praeventio Guard', 50, 35);
    doc
      .fontSize(10)
      .font('Helvetica')
      .text('Sistema Integrado de Gestión de Riesgos', 50, 65);
    doc.text(`Doc ID: ${incidentId || `REQ-${Date.now()}`}`, 400, 35, { align: 'right' });
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-CL')}`, 400, 50, { align: 'right' });
    doc.text(`Tipo: ${type.toUpperCase()}`, 400, 65, { align: 'right' });

    doc.moveDown(5); // Move below header

    // 2. Title Section
    doc
      .fillColor('#000000')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(title || 'Documento Oficial de Seguridad Ocupacional', { align: 'center' });
    doc.moveDown(1);

    // 3. Divider Line
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e2e8f0');
    doc.moveDown(1);

    // 4. Metadata Box (If any, e.g., location, severity, supervisor)
    if (Object.keys(metadata).length > 0) {
      doc.rect(50, doc.y, 495, Object.keys(metadata).length * 20 + 10).fill('#f8fafc');
      doc.fillColor('#334155').fontSize(10).font('Helvetica');
      let currentY = doc.y + 5;
      for (const [key, value] of Object.entries(metadata)) {
        doc
          .font('Helvetica-Bold')
          .text(`${key.toUpperCase()}: `, 60, currentY, { continued: true })
          .font('Helvetica')
          .text(String(value));
        currentY += 20;
      }
      doc.y = currentY + 15;
    }

    // 5. Main Content (Markdown roughly converted or plain text)
    doc.fillColor('#1e293b').fontSize(11).font('Helvetica');

    // Simple pseudo-markdown parsing for the PDF
    const lines = content ? content.split('\n') : ['Sin contenido registrado.'];
    lines.forEach((line: string) => {
      if (line.startsWith('# ')) {
        doc
          .moveDown()
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(line.replace('# ', ''))
          .font('Helvetica')
          .fontSize(11);
      } else if (line.startsWith('## ')) {
        doc
          .moveDown()
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(line.replace('## ', ''))
          .font('Helvetica')
          .fontSize(11);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        doc.text(`  • ${line.substring(2)}`, { indent: 10 });
      } else if (line.trim() === '') {
        doc.moveDown(0.5);
      } else {
        doc.text(line, { align: 'justify' });
      }
    });

    // 6. Footer (Page numbers and legal disclaimer)
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.rect(0, doc.page.height - 50, doc.page.width, 50).fill('#f1f5f9');
      doc
        .fillColor('#94a3b8')
        .fontSize(8)
        .font('Helvetica')
        .text(
          'Documento generado por Praeventio AI. Válido como registro interno conforme a directrices Minsal.',
          50,
          doc.page.height - 35,
        );
      doc.text(`Página ${i + 1} de ${totalPages}`, 450, doc.page.height - 35, { align: 'right' });
    }

    doc.end();
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Internal server error during PDF generation' });
  }
});

export default router;

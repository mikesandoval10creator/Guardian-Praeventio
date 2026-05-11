// Praeventio Guard — Sprint 39 Fase F.1: Modo Auditoría Express.
//
// Cierra: Documento usuario "Recomendaciones nuevas §1"
//         Plan integral Fase F.1
//
// Cuando llega SEREMI / DT / mutualidad / cliente mandante a fiscalizar,
// la empresa pierde 1-2 días buscando evidencia. Este builder consolida
// en 30 segundos:
//
//   - Documentos vigentes (contratos, ODI, RIOHS, procedimientos)
//   - Matriz IPER (riesgos identificados)
//   - Capacitaciones (vigentes + vencidas)
//   - EPP entregado por trabajador
//   - Trabajadores activos con docs vigentes
//   - Protocolos aplicables (derivados de legalRuleEngine)
//   - Evidencias fotográficas (urls signed)
//   - Audit logs últimos 30 días
//   - Cumplimiento (semáforo F.2) actual
//
// Diseño:
//   - Builder PURO: recibe los datos consolidados + devuelve un manifest
//     que el caller usa para construir el ZIP final.
//   - El upload a Storage + signed URL son responsabilidad del caller
//     (Cloud Function que tiene el Admin SDK).
//   - El PDF índice se genera con pdfkit (ya en deps).

import PDFDocument from 'pdfkit';
import type { ComplianceTrafficLightResult } from '../compliance/trafficLightEngine.js';
import type { LegalRequirement } from '../legal/legalRuleEngine.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ExpressBundleInput {
  projectId: string;
  projectName: string;
  generatedBy: { uid: string; fullName: string; role: string };
  generatedAt: Date;
  data: {
    documents: BundleDoc[];
    iperMatrix: BundleIper[];
    trainings: BundleTraining[];
    eppAssignments: BundleEpp[];
    activeWorkers: BundleWorker[];
    applicableProtocols: LegalRequirement[];
    photoEvidences: BundlePhoto[];
    recentAuditLogs: BundleAuditLog[];
    complianceSnapshot: ComplianceTrafficLightResult;
  };
}

export interface BundleDoc {
  id: string;
  type: string;
  title: string;
  status: 'vigente' | 'vencido' | 'pendiente_firma';
  storageUrl?: string;
}
export interface BundleIper {
  id: string;
  risk: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation?: string;
}
export interface BundleTraining {
  id: string;
  course: string;
  workerName: string;
  workerRut: string;
  validUntil?: string;
  status: 'vigente' | 'vencido';
}
export interface BundleEpp {
  workerName: string;
  workerRut: string;
  items: Array<{ label: string; receivedAt: string; expiresAt?: string }>;
}
export interface BundleWorker {
  uid: string;
  fullName: string;
  rut: string;
  role: string;
  startDate?: string;
}
export interface BundlePhoto {
  id: string;
  caption: string;
  storageUrl: string;
  takenAt: string;
}
export interface BundleAuditLog {
  action: string;
  timestamp: string;
  userId: string | null;
  details?: Record<string, unknown>;
}

export interface ExpressBundleManifest {
  /** Generated at instant. */
  generatedAt: string;
  /** Snapshot del semáforo en el momento del bundle. */
  complianceSnapshot: ComplianceTrafficLightResult;
  /** Index PDF buffer — caller lo agrega al ZIP. */
  indexPdf: Buffer;
  /** Sections con counts para que la UI muestre antes del download. */
  summary: BundleSummary;
}

export interface BundleSummary {
  documentsCount: number;
  iperItems: number;
  trainings: { vigentes: number; vencidos: number };
  eppAssignments: number;
  activeWorkers: number;
  applicableProtocols: number;
  photoEvidences: number;
  recentAuditLogs: number;
  fileCount: number;
}

// ────────────────────────────────────────────────────────────────────────
// Builder
// ────────────────────────────────────────────────────────────────────────

export async function buildExpressBundleManifest(
  input: ExpressBundleInput,
): Promise<ExpressBundleManifest> {
  const summary = computeSummary(input);
  const indexPdf = await renderIndexPdf(input, summary);
  return {
    generatedAt: input.generatedAt.toISOString(),
    complianceSnapshot: input.data.complianceSnapshot,
    indexPdf,
    summary,
  };
}

function computeSummary(input: ExpressBundleInput): BundleSummary {
  const { data } = input;
  const vigentes = data.trainings.filter((t) => t.status === 'vigente').length;
  const vencidos = data.trainings.filter((t) => t.status === 'vencido').length;
  return {
    documentsCount: data.documents.length,
    iperItems: data.iperMatrix.length,
    trainings: { vigentes, vencidos },
    eppAssignments: data.eppAssignments.length,
    activeWorkers: data.activeWorkers.length,
    applicableProtocols: data.applicableProtocols.length,
    photoEvidences: data.photoEvidences.length,
    recentAuditLogs: data.recentAuditLogs.length,
    fileCount:
      data.documents.length +
      data.photoEvidences.length +
      1 /* index */,
  };
}

async function renderIndexPdf(
  input: ExpressBundleInput,
  summary: BundleSummary,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(18).text('CARPETA DE FISCALIZACIÓN', { align: 'center' });
      doc.moveDown(0.2);
      doc.fontSize(12).text(input.projectName, { align: 'center' });
      doc
        .fontSize(9)
        .text(`Generado: ${input.generatedAt.toISOString()}`, { align: 'center' });
      doc
        .fontSize(9)
        .text(
          `Por: ${input.generatedBy.fullName} (${input.generatedBy.role})`,
          { align: 'center' },
        );
      doc.moveDown(0.8);

      // Compliance snapshot
      doc.fontSize(12).fillColor('#003366').text('Estado de Cumplimiento', { underline: true });
      doc.fillColor('black').fontSize(10);
      doc.text(`Overall: ${input.data.complianceSnapshot.overall.toUpperCase()}`, { indent: 10 });
      doc.text(`Score: ${input.data.complianceSnapshot.score}/100`, { indent: 10 });
      doc.moveDown(0.3);
      for (const cat of input.data.complianceSnapshot.byCategory) {
        doc.fontSize(9).text(
          `${cat.category.toUpperCase().padEnd(22)} ${cat.light.toUpperCase()} — ${cat.summary}`,
          { indent: 10 },
        );
      }
      doc.moveDown(0.8);

      // Counts summary
      section(doc, 'Resumen del Paquete');
      kv(doc, 'Documentos vigentes', summary.documentsCount);
      kv(doc, 'Ítems en matriz IPER', summary.iperItems);
      kv(doc, 'Capacitaciones (vigentes / vencidas)',
        `${summary.trainings.vigentes} / ${summary.trainings.vencidos}`);
      kv(doc, 'EPP entregados (registros)', summary.eppAssignments);
      kv(doc, 'Trabajadores activos', summary.activeWorkers);
      kv(doc, 'Protocolos aplicables (legales)', summary.applicableProtocols);
      kv(doc, 'Evidencias fotográficas', summary.photoEvidences);
      kv(doc, 'Audit logs últimos 30d', summary.recentAuditLogs);
      kv(doc, 'Total archivos en ZIP', summary.fileCount);
      doc.moveDown(0.8);

      // Protocolos aplicables (citas normativas)
      section(doc, 'Normativa Aplicable');
      if (input.data.applicableProtocols.length === 0) {
        doc.fontSize(9).text('Sin obligaciones específicas detectadas.', { indent: 10 });
      } else {
        for (const p of input.data.applicableProtocols) {
          doc
            .fontSize(9)
            .fillColor(p.urgency === 'critical' ? '#aa0000' : 'black')
            .text(`• ${p.legalCitation}: ${p.recommendation}`, { indent: 10 })
            .fillColor('black');
        }
      }
      doc.moveDown(0.5);

      // Disclaimer
      doc
        .fontSize(7)
        .fillColor('#555555')
        .text(
          'Documento generado por Praeventio Guard. Cada archivo del ZIP ' +
            'mantiene su hash SHA-256 en `manifest.json` para cadena de ' +
            'custodia. Praeventio no representa a la empresa ante el ' +
            'fiscalizador — la empresa entrega y firma este paquete.',
          { align: 'center' },
        )
        .fillColor('black');

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function section(doc: PDFKit.PDFDocument, title: string): void {
  doc.fontSize(11).fillColor('#003366').text(title, { underline: true });
  doc.fillColor('black').fontSize(9);
}

function kv(doc: PDFKit.PDFDocument, label: string, value: string | number): void {
  doc.fontSize(9).text(`${label}: ${value}`, { indent: 10 });
}

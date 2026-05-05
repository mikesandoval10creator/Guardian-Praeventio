// Praeventio Guard — Sprint 31 Bucket MM.
//
// Data Protection Impact Assessment (DPIA / EIPD / RIPD) PDF generator.
// Marco normativo:
//   - GDPR art.35 — DPIA mandatory for high-risk processing.
//   - LGPD art.38 — Relatório de Impacto à Proteção de Dados Pessoais.
//   - Ley 21.719 (CL) — Evaluación de Impacto en Protección de Datos.
//   - CPRA § 1798.185(a)(15) — risk assessments.
//
// Tier gating: this template is only offered to tier Titanio + when the
// active regime declares `dpiaRequired: true`. The route layer enforces
// the gating; this module is a pure renderer.
//
// Visual style mirrors `aptitudeCertificate.ts` and `susesoCertificate.ts`
// (petroleum band + teal accent + labelize blocks + autotable).

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const W = 210;
const H = 297;
const M = 18;

export interface DpiaDataFlow {
  /** "Identidad → Firebase Auth" */
  name: string;
  dataCategories: string[];
  legalBasis: string;
  recipients: string[];
  internationalTransfer: boolean;
  retention: string;
}

export interface DpiaMitigation {
  /** Risk being mitigated. */
  risk: string;
  /** Severity 1-5. */
  severity: number;
  /** Likelihood 1-5. */
  likelihood: number;
  /** Concrete control applied (e.g. "KMS envelope encryption"). */
  control: string;
  /** Residual risk after the control: 'low' | 'medium' | 'high'. */
  residual: 'low' | 'medium' | 'high';
}

export interface DpiaInput {
  tenantId: string;
  tenantName?: string;
  /** Active privacy regimes (e.g. ['GDPR-EU', 'LGPD-BR']). */
  regimes: string[];
  /** Author / DPO that signs off. */
  preparedBy: { fullName: string; role: string; email?: string };
  /** Data flows captured from RAT. */
  dataFlows: DpiaDataFlow[];
  /** Risk → mitigation entries. */
  mitigations: DpiaMitigation[];
  /** ISO timestamp of preparation. */
  preparedAt: string;
}

const RESIDUAL_COLORS: Record<DpiaMitigation['residual'], [number, number, number]> = {
  low: [77, 182, 172],
  medium: [251, 191, 36],
  high: [239, 68, 68],
};

const RESIDUAL_LABELS: Record<DpiaMitigation['residual'], string> = {
  low: 'BAJO',
  medium: 'MEDIO',
  high: 'ALTO',
};

/**
 * Build the DPIA PDF and return raw bytes. Caller decides what to do
 * with them (download, hash for signing, stash in storage). Idempotent
 * given identical input.
 */
export function generateDpiaPdf(input: DpiaInput): Uint8Array {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  drawHeader(doc, input);
  drawTitle(doc, input);
  let y = drawScopeBlock(doc, input);
  y = drawDataFlowsBlock(doc, input, y);
  y = drawRiskMatrixBlock(doc, input, y);
  drawSignatureBlock(doc, input, y);
  drawFooter(doc, input);

  const ab = doc.output('arraybuffer');
  return new Uint8Array(ab);
}

function drawHeader(doc: jsPDF, _input: DpiaInput): void {
  doc.setFillColor(6, 31, 45);
  doc.rect(0, 0, W, 32, 'F');
  doc.setFillColor(77, 182, 172);
  doc.rect(0, 32, W, 1.2, 'F');

  doc.setFillColor(77, 182, 172);
  doc.roundedRect(M, 8, 16, 16, 3, 3, 'F');
  doc.setTextColor(6, 31, 45);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('P', M + 8, 19, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('GUARDIAN PRAEVENTIO', M + 22, 16);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(212, 175, 55);
  doc.text('SISTEMA DE PREVENCIÓN DE RIESGOS LABORALES', M + 22, 21);
  doc.setTextColor(255, 255, 255);
  doc.text('DPIA / EIPD  ·  GDPR art.35 · LGPD art.38 · Ley 21.719', M + 22, 25);
}

function drawTitle(doc: jsPDF, input: DpiaInput): void {
  doc.setTextColor(6, 31, 45);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('EVALUACIÓN DE IMPACTO EN PROTECCIÓN DE DATOS', W / 2, 46, {
    align: 'center',
  });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`Tenant: ${input.tenantName ?? input.tenantId}`, M, 53);
  doc.text(
    `Emitido: ${new Date(input.preparedAt).toLocaleString('es-CL')}`,
    W - M,
    53,
    { align: 'right' },
  );
}

function sectionBox(
  doc: jsPDF,
  title: string,
  y: number,
  height: number,
): void {
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, W - M * 2, height, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(title, M + 4, y + 6);
}

function labelize(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
): void {
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.text(label, x, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(9);
  doc.text(value || '—', x, y + 4);
}

function drawScopeBlock(doc: jsPDF, input: DpiaInput): number {
  const y = 60;
  sectionBox(doc, 'ALCANCE Y RÉGIMEN APLICABLE', y, 26);
  labelize(doc, 'TENANT', input.tenantName ?? input.tenantId, M + 4, y + 13);
  labelize(
    doc,
    'REGÍMENES APLICABLES',
    input.regimes.join(' · ') || '—',
    M + 110,
    y + 13,
  );
  return y + 26 + 4;
}

function drawDataFlowsBlock(doc: jsPDF, input: DpiaInput, y: number): number {
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('FLUJOS DE DATOS', M, y + 4);
  autoTable(doc, {
    startY: y + 6,
    head: [['Flujo', 'Categorías', 'Base legal', 'Retención', 'Transf.']],
    body: input.dataFlows.map((f) => [
      f.name,
      f.dataCategories.join(', '),
      f.legalBasis,
      f.retention,
      f.internationalTransfer ? 'Sí' : 'No',
    ]),
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [6, 31, 45], textColor: [255, 255, 255] },
    margin: { left: M, right: M },
  });
  return y + 12 + input.dataFlows.length * 8 + 6;
}

function drawRiskMatrixBlock(doc: jsPDF, input: DpiaInput, yIn: number): number {
  const y = Math.min(yIn, H - 80);
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('MATRIZ DE RIESGO Y MITIGACIÓN', M, y + 4);
  autoTable(doc, {
    startY: y + 6,
    head: [['Riesgo', 'Sev.', 'Prob.', 'Control', 'Residual']],
    body: input.mitigations.map((m) => [
      m.risk,
      String(m.severity),
      String(m.likelihood),
      m.control,
      RESIDUAL_LABELS[m.residual],
    ]),
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [6, 31, 45], textColor: [255, 255, 255] },
    margin: { left: M, right: M },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const m = input.mitigations[data.row.index];
        if (m) {
          const [r, g, b] = RESIDUAL_COLORS[m.residual];
          data.cell.styles.fillColor = [r, g, b];
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });
  return y + 12 + input.mitigations.length * 8 + 6;
}

function drawSignatureBlock(doc: jsPDF, input: DpiaInput, yIn: number): void {
  const y = Math.max(yIn, H - 50);
  doc.setDrawColor(180, 180, 180);
  doc.line(M, y, W - M, y);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('PREPARADO POR', M, y + 6);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(input.preparedBy.fullName, M, y + 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(input.preparedBy.role, M, y + 17);
  if (input.preparedBy.email) {
    doc.text(input.preparedBy.email, M, y + 22);
  }
}

function drawFooter(doc: jsPDF, input: DpiaInput): void {
  doc.setFillColor(6, 31, 45);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text(
    `Tenant ${input.tenantId}  ·  DPIA conforme a regímenes ${input.regimes.join(', ')}`,
    W / 2,
    H - 6,
    { align: 'center' },
  );
  doc.setTextColor(212, 175, 55);
  doc.setFontSize(6);
  doc.text(
    'Documento confidencial — solo para autoridades de control y DPO',
    W / 2,
    H - 2,
    { align: 'center' },
  );
}

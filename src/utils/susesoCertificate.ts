// Praeventio Guard — Sprint 28 Bucket B6.
//
// PDF generator for SUSESO DIAT (DS 101) and DIEP (DS 110) declarations.
// Marco normativo:
//  - Ley 16.744 art. 76 — obligación de declaración del accidente.
//  - DS 101/1968 MINSEGPRES — Reglamento DIAT.
//  - DS 110/1968 MINSEGPRES — Calificación enfermedad profesional.
//  - Ley 19.799 — firma electrónica simple (Ley de Documentos Electrónicos).
//
// Visual style mirrors `aptitudeCertificate.ts` and `ds109Certificate.ts`
// (dark header band + teal accent + labelize blocks + autotable). The
// goal is that ALL certificates Praeventio emits look like one family.
//
// Output contract: `generateSusesoPdf` returns the binary PDF bytes
// (Uint8Array) so the caller — typically `susesoService.createSusesoForm` —
// can hash them, compute a payload digest for the signature, and store
// or stream them. We do NOT call `doc.save()` here; that's the UI's job
// via `downloadSusesoPdf`.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { configureDeterministicPdf, formatChileDateTime } from './deterministicPdf.js';
import type {
  SusesoForm,
  SusesoFormKind,
  SusesoMutualidad,
  SusesoIncidentClassification,
} from '../services/suseso/types.js';

const W = 210;
const H = 297;
const M = 18;

const KIND_LABELS: Record<SusesoFormKind, string> = {
  DIAT: 'DECLARACIÓN INDIVIDUAL DE ACCIDENTE DEL TRABAJO',
  DIEP: 'DECLARACIÓN INDIVIDUAL DE ENFERMEDAD PROFESIONAL',
};

const KIND_NORMATIVA: Record<SusesoFormKind, string> = {
  DIAT: 'DS 101 / Ley 16.744 art. 76',
  DIEP: 'DS 110 / Ley 16.744 art. 7',
};

const MUTUALIDAD_LABELS: Record<SusesoMutualidad, string> = {
  achs: 'ACHS — Asociación Chilena de Seguridad',
  mutual_seguridad: 'Mutual de Seguridad CChC',
  ist: 'IST — Instituto de Seguridad del Trabajo',
  isl: 'ISL — Instituto de Seguridad Laboral',
};

const CLASSIFICATION_LABELS: Record<SusesoIncidentClassification, string> = {
  accidente_trabajo: 'Accidente del trabajo',
  enfermedad_profesional: 'Enfermedad profesional',
  accidente_trayecto: 'Accidente de trayecto',
};

/**
 * Optional rendering options. The QR data URL must be passed in by the
 * caller (we keep this generator dep-free of `qrcode` so the same code
 * works in browser + node test environments).
 */
export interface SusesoPdfOptions {
  /** Logo data-URL or omitted to fall back to the "P" placeholder. */
  qrCodeDataUrl?: string;
}

/**
 * Build the PDF and return raw bytes. The caller decides whether to
 * download (browser), pipe (server), or hash for signing.
 *
 * Important: the bytes returned here are the SIGNABLE BODY. If a
 * signature is later applied via `attachSignaturePage`, that adds an
 * additional page AFTER the body — and the verifier must strip it
 * before reproducing the SHA-256 digest.
 */
export function generateSusesoPdf(
  form: SusesoForm,
  options: SusesoPdfOptions = {},
): Uint8Array {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  configureDeterministicPdf(doc, form.folio, form.createdAt);
  drawHeader(doc, form.kind);
  drawTitle(doc, form);
  let y = drawWorkerBlock(doc, form);
  y = drawCompanyBlock(doc, form, y);
  y = drawIncidentBlock(doc, form, y);
  y = drawTipificationBlock(doc, form, y);
  y = drawWitnessesBlock(doc, form, y);
  drawSignatureBlock(doc, form, y, options.qrCodeDataUrl);
  drawFooter(doc, form);

  // jsPDF's `output('arraybuffer')` returns an ArrayBuffer; wrap in
  // Uint8Array for downstream `crypto.subtle.digest` and Buffer interop.
  const ab = doc.output('arraybuffer');
  return new Uint8Array(ab);
}

/**
 * Browser-only convenience wrapper. Kept separate from `generateSusesoPdf`
 * so the byte-returning core stays node-friendly.
 */
export function downloadSusesoPdf(
  form: SusesoForm,
  options: SusesoPdfOptions = {},
): void {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  drawHeader(doc, form.kind);
  drawTitle(doc, form);
  let y = drawWorkerBlock(doc, form);
  y = drawCompanyBlock(doc, form, y);
  y = drawIncidentBlock(doc, form, y);
  y = drawTipificationBlock(doc, form, y);
  y = drawWitnessesBlock(doc, form, y);
  drawSignatureBlock(doc, form, y, options.qrCodeDataUrl);
  drawFooter(doc, form);
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_');
  doc.save(`${form.kind}_${form.folio}_${safe(form.workerFullName)}.pdf`);
}

// ─── Drawing helpers ────────────────────────────────────────────────────────

function drawHeader(doc: jsPDF, kind: SusesoFormKind): void {
  // Petroleum band
  doc.setFillColor(6, 31, 45);
  doc.rect(0, 0, W, 32, 'F');
  // Teal accent
  doc.setFillColor(77, 182, 172);
  doc.rect(0, 32, W, 1.2, 'F');

  // Logo placeholder
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
  doc.text(`SUSESO  ·  ${KIND_NORMATIVA[kind]}`, M + 22, 25);
}

function drawTitle(doc: jsPDF, form: SusesoForm): void {
  doc.setTextColor(6, 31, 45);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(KIND_LABELS[form.kind], W / 2, 46, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`Folio: ${form.folio}`, M, 53);
  doc.text(`Emitido: ${formatChileDateTime(form.createdAt)}`, W - M, 53, {
    align: 'right',
  });
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

function drawWorkerBlock(doc: jsPDF, form: SusesoForm): number {
  const y = 60;
  sectionBox(doc, 'IDENTIFICACIÓN DEL TRABAJADOR', y, 26);
  labelize(doc, 'NOMBRE COMPLETO', form.workerFullName, M + 4, y + 13);
  labelize(doc, 'RUT', form.workerRut, M + 110, y + 13);
  return y + 26 + 4;
}

function drawCompanyBlock(doc: jsPDF, form: SusesoForm, y: number): number {
  sectionBox(doc, 'IDENTIFICACIÓN DEL EMPLEADOR', y, 32);
  labelize(doc, 'RAZÓN SOCIAL', form.companyName, M + 4, y + 13);
  labelize(doc, 'RUT EMPRESA', form.companyRut, M + 110, y + 13);
  labelize(doc, 'ORGANISMO ADMINISTRADOR', MUTUALIDAD_LABELS[form.mutualidad], M + 4, y + 24);
  return y + 32 + 4;
}

function drawIncidentBlock(doc: jsPDF, form: SusesoForm, y: number): number {
  const descLines = doc.splitTextToSize(form.incidentDescription || '—', W - M * 2 - 8);
  const height = 30 + Math.max(0, descLines.length - 1) * 4;
  sectionBox(doc, 'HECHOS DEL INCIDENTE', y, height);
  labelize(doc, 'FECHA Y HORA', formatChileDateTime(form.incidentDate), M + 4, y + 13);
  labelize(doc, 'LUGAR', form.incidentLocation, M + 110, y + 13);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.text('DESCRIPCIÓN', M + 4, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(8);
  doc.text(descLines, M + 4, y + 26);
  return y + height + 4;
}

function drawTipificationBlock(doc: jsPDF, form: SusesoForm, y: number): number {
  sectionBox(doc, 'TIPIFICACIÓN', y, 30);
  labelize(
    doc,
    'CLASIFICACIÓN',
    CLASSIFICATION_LABELS[form.incidentClassification],
    M + 4,
    y + 13,
  );
  const causalLabel = form.kind === 'DIAT' ? 'CAUSAL DS 101' : 'CAUSAL DS 110';
  const causalValue =
    (form.kind === 'DIAT' ? form.ds101Causal : form.ds110Causal) ?? '—';
  labelize(doc, causalLabel, causalValue, M + 110, y + 13);
  labelize(
    doc,
    'PARTES DEL CUERPO AFECTADAS',
    (form.bodyPartsAffected || []).join(', ') || '—',
    M + 4,
    y + 22,
  );
  return y + 30 + 4;
}

function drawWitnessesBlock(doc: jsPDF, form: SusesoForm, y: number): number {
  if (!form.witnesses || form.witnesses.length === 0) {
    return y;
  }
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('TESTIGOS', M, y + 4);
  autoTable(doc, {
    startY: y + 6,
    head: [['Nombre', 'RUT']],
    body: form.witnesses.map((w) => [w.fullName || '—', w.rut || '—']),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [6, 31, 45], textColor: [255, 255, 255] },
    margin: { left: M, right: M },
  });
  // Best-effort cursor advance — autoTable doesn't expose y directly
  // across versions, so we estimate by row count.
  return y + 12 + form.witnesses.length * 6 + 4;
}

function drawSignatureBlock(
  doc: jsPDF,
  form: SusesoForm,
  yIn: number,
  qrCodeDataUrl: string | undefined,
): void {
  const y = Math.max(yIn, H - 65);
  doc.setDrawColor(180, 180, 180);
  doc.line(M, y, W - M, y);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('REPORTADO POR', M, y + 6);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(form.reportedBy.fullName, M, y + 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`RUT: ${form.reportedBy.rut}`, M, y + 17);

  // Signature column
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('FIRMA ELECTRÓNICA', W / 2 + 5, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(8);
  if (form.signature) {
    doc.text(`Algoritmo: ${form.signature.algorithm}`, W / 2 + 5, y + 12);
    doc.text(`Firmado: ${formatChileDateTime(form.signature.signedAt)}`, W / 2 + 5, y + 17);
    doc.text(`Hash: ${form.signature.payloadHashHex.slice(0, 24)}…`, W / 2 + 5, y + 22);
  } else {
    doc.setTextColor(180, 70, 70);
    doc.text('PENDIENTE DE FIRMA', W / 2 + 5, y + 12);
  }

  // QR code (folio verification)
  if (qrCodeDataUrl) {
    try {
      doc.addImage(qrCodeDataUrl, 'PNG', W - M - 28, y + 4, 24, 24);
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(6);
      doc.text('Verificación de folio', W - M - 16, y + 32, { align: 'center' });
    } catch {
      /* QR rendering is best-effort; never fail the PDF for it. */
    }
  }
}

function drawFooter(doc: jsPDF, form: SusesoForm): void {
  doc.setFillColor(6, 31, 45);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text(
    `Folio ${form.folio}  ·  Documento ${form.kind} conforme a Ley 16.744`,
    W / 2,
    H - 6,
    { align: 'center' },
  );
  doc.setTextColor(212, 175, 55);
  doc.setFontSize(6);
  doc.text(
    'Verificable en /api/suseso/verify/{folio}  ·  Firma electrónica simple Ley 19.799',
    W / 2,
    H - 2,
    { align: 'center' },
  );
}

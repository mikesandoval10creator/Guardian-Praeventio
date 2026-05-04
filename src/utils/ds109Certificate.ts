// Praeventio Guard — DS 109 (Calificación de Enfermedad Profesional) PDF generator.
//
// Marco normativo:
//  - Ley N° 16.744 (1968) art. 7 — define enfermedad profesional.
//  - DS N° 109/1968 MINSEGPRES — Reglamento para la calificación y evaluación
//    de los accidentes del trabajo y enfermedades profesionales (lista de
//    enfermedades + agentes etiológicos del Anexo).
//
// Patrón de PDF copiado de `aptitudeCertificate.ts` (header oscuro + acento
// teal + bloques de datos + autotable) para mantener consistencia visual con
// el resto de los certificados generados por el sistema.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface Ds109OccupationalHistoryEntry {
  yearFrom: number;
  yearTo: number;
  employer: string;
  jobTitle: string;
  /** Agentes de riesgo expuestos en ese período (ej: ['Sílice', 'Ruido', 'Plomo']). */
  riskAgents: string[];
}

export type Ds109Origin = 'laboral' | 'comun' | 'mixto' | 'pendiente';

export interface Ds109Input {
  // Identificación trabajador
  workerName: string;
  workerRut: string;
  workerBirthDate: string;
  workerGender: 'M' | 'F' | 'X';
  workerAddress: string;

  // Datos laborales
  employerName: string;
  employerRut: string;
  jobTitle: string;
  hireDate: string;
  workplaceAddress: string;

  // Anamnesis ocupacional (historia laboral relevante)
  occupationalHistory: Ds109OccupationalHistoryEntry[];

  // Evaluación clínica
  diagnosis: string;
  /** CIE-10 code, ej: 'J62.8' (silicosis). Opcional. */
  cieCode?: string;
  symptomsOnsetDate: string;
  /** Hallazgos clínicos relevantes. Multi-línea. */
  clinicalFindings: string;

  // Calificación
  origin: Ds109Origin;
  /** Agente causal identificado, ej: "Exposición a sílice cristalina (cuarzo)". */
  causalAgent: string;
  /** Razonamiento del médico evaluador (evidencia clínica + ocupacional). */
  evidenceBasis: string;
  /** Porcentaje atribuible al trabajo. Solo se muestra si origin === 'mixto'. */
  attributablePercent?: number;

  // Médico evaluador
  evaluatorName: string;
  evaluatorRut: string;
  /** N° registro Superintendencia de Salud. */
  evaluatorRegistration: string;
  evaluationDate: string;
  /**
   * Cita normativa. Si se omite, se usa el default:
   * "Ley 16.744 art. 7 + DS 109/1968 MINSEGPRES".
   */
  citation?: string;
}

const ORIGIN_LABELS: Record<Ds109Origin, string> = {
  laboral: 'ORIGEN LABORAL',
  comun: 'ORIGEN COMÚN',
  mixto: 'ORIGEN MIXTO',
  pendiente: 'CALIFICACIÓN PENDIENTE',
};

const ORIGIN_COLORS: Record<Ds109Origin, [number, number, number]> = {
  laboral: [239, 68, 68],     // rojo: claramente laboral
  comun: [77, 182, 172],      // teal: común (no laboral)
  mixto: [251, 191, 36],      // ámbar: mixto
  pendiente: [120, 120, 120], // gris: pendiente
};

const GENDER_LABELS: Record<Ds109Input['workerGender'], string> = {
  M: 'Masculino',
  F: 'Femenino',
  X: 'No binario / Otro',
};

const DEFAULT_CITATION = 'Ley 16.744 art. 7 + DS 109/1968 MINSEGPRES';

const W = 210;
const H = 297;
const M = 18;

function drawHeader(doc: jsPDF, pageNumber: number, totalPages: number): void {
  // Header bar
  doc.setFillColor(6, 31, 45);
  doc.rect(0, 0, W, 32, 'F');
  doc.setFillColor(77, 182, 172);
  doc.rect(0, 32, W, 1.2, 'F');

  // Logo + brand
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
  doc.text('CALIFICACIÓN DE ENFERMEDAD PROFESIONAL · DS 109/1968', M + 22, 21);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text('Ley 16.744 · DS 109 · MINSEGPRES · Superintendencia de Seguridad Social', M + 22, 25);

  // Page indicator
  doc.setFontSize(7);
  doc.setTextColor(212, 175, 55);
  doc.text(`Página ${pageNumber} / ${totalPages}`, W - M, 16, { align: 'right' });
}

function drawFooter(doc: jsPDF): void {
  doc.setFillColor(6, 31, 45);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text(
    `Documento generado por Guardian Praeventio  ·  ${new Date().toLocaleString('es-CL')}`,
    W / 2,
    H - 6,
    { align: 'center' },
  );
  doc.setTextColor(212, 175, 55);
  doc.setFontSize(6);
  doc.text(
    'Documento conforme Ley 16.744 art. 7 y DS 109/1968. Sujeto a revisión COMPIN / Mutualidad.',
    W / 2,
    H - 2,
    { align: 'center' },
  );
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

/**
 * Build the DS 109 PDF and return the jsPDF instance (does NOT save).
 *
 * Caller decides whether to download (`downloadDs109Pdf`) or pipe the
 * blob elsewhere (e.g. attach to an email, upload to Firestore Storage).
 */
export function generateDs109Pdf(input: Ds109Input): jsPDF {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const citation = input.citation && input.citation.trim().length > 0
    ? input.citation
    : DEFAULT_CITATION;

  // Determine total page count up-front.
  // Pages 1, 2 (anamnesis), 3, 4, 5 = 5 base pages.
  // If anamnesis spills (>10 entries) we add an overflow page handled by autotable.
  const totalPages = 5;

  // ─────────────────────────── PAGE 1 ───────────────────────────
  // Identificación trabajador + datos laborales
  drawHeader(doc, 1, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('IDENTIFICACIÓN Y DATOS LABORALES', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Formulario de calificación de enfermedad profesional', W / 2, 54, { align: 'center' });

  // Worker box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 62, W - M * 2, 60, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL TRABAJADOR', M + 4, 68);

  labelize(doc, 'NOMBRE COMPLETO', input.workerName, M + 4, 75);
  labelize(doc, 'RUT', input.workerRut, M + 4, 87);
  labelize(doc, 'FECHA DE NACIMIENTO', input.workerBirthDate, M + 4, 99);
  labelize(doc, 'GÉNERO', GENDER_LABELS[input.workerGender], M + 75, 75);
  labelize(doc, 'DOMICILIO', input.workerAddress, M + 75, 87);

  // Employer box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 130, W - M * 2, 60, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('EMPLEADOR ACTUAL', M + 4, 136);

  labelize(doc, 'RAZÓN SOCIAL', input.employerName, M + 4, 143);
  labelize(doc, 'RUT EMPLEADOR', input.employerRut, M + 4, 155);
  labelize(doc, 'FECHA INGRESO', input.hireDate, M + 4, 167);
  labelize(doc, 'CARGO ACTUAL', input.jobTitle, M + 75, 143);
  labelize(doc, 'DIRECCIÓN LUGAR DE TRABAJO', input.workplaceAddress, M + 75, 155);

  drawFooter(doc);

  // ─────────────────────────── PAGE 2 ───────────────────────────
  // Anamnesis ocupacional
  doc.addPage();
  drawHeader(doc, 2, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('ANAMNESIS OCUPACIONAL', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(
    'Historia laboral relevante con agentes de riesgo expuestos (DS 109 art. 19)',
    W / 2,
    54,
    { align: 'center' },
  );

  if (input.occupationalHistory.length > 0) {
    autoTable(doc, {
      startY: 62,
      head: [['Período', 'Empleador', 'Cargo', 'Agentes de riesgo']],
      body: input.occupationalHistory.map(h => [
        `${h.yearFrom} – ${h.yearTo}`,
        h.employer,
        h.jobTitle,
        h.riskAgents.join(', ') || '—',
      ]),
      headStyles: { fillColor: [6, 31, 45], textColor: [255, 255, 255], fontSize: 9 },
      bodyStyles: { fontSize: 8, textColor: [20, 20, 20] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: M, right: M },
      styles: { cellPadding: 2.5 },
    });
  } else {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text('Sin antecedentes ocupacionales registrados.', W / 2, 90, { align: 'center' });
  }

  drawFooter(doc);

  // ─────────────────────────── PAGE 3 ───────────────────────────
  // Evaluación clínica
  doc.addPage();
  drawHeader(doc, 3, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('EVALUACIÓN CLÍNICA', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Diagnóstico, clasificación CIE-10 y hallazgos clínicos', W / 2, 54, { align: 'center' });

  // Diagnóstico box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 62, W - M * 2, 38, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('DIAGNÓSTICO', M + 4, 68);

  labelize(doc, 'DIAGNÓSTICO PRINCIPAL', input.diagnosis, M + 4, 75);
  if (input.cieCode) {
    labelize(doc, 'CÓDIGO CIE-10', input.cieCode, M + 4, 87);
  }
  labelize(doc, 'INICIO DE SÍNTOMAS', input.symptomsOnsetDate, M + 75, 87);

  // Hallazgos clínicos
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('HALLAZGOS CLÍNICOS RELEVANTES', M, 110);

  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(252, 252, 252);
  doc.roundedRect(M, 113, W - M * 2, H - 113 - 25, 2, 2, 'FD');

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const findingsLines = doc.splitTextToSize(
    input.clinicalFindings || 'Sin hallazgos registrados.',
    W - M * 2 - 8,
  );
  doc.text(findingsLines, M + 4, 120);

  drawFooter(doc);

  // ─────────────────────────── PAGE 4 ───────────────────────────
  // Calificación
  doc.addPage();
  drawHeader(doc, 4, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('CALIFICACIÓN DE ORIGEN', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(citation, W / 2, 54, { align: 'center' });

  // Gran banner con el origin
  const [r, g, b] = ORIGIN_COLORS[input.origin];
  doc.setFillColor(r, g, b);
  doc.roundedRect(M, 62, W - M * 2, 32, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('DICTAMEN DE CALIFICACIÓN', W / 2, 71, { align: 'center' });
  doc.setFontSize(20);
  doc.text(ORIGIN_LABELS[input.origin], W / 2, 84, { align: 'center' });

  // Agente causal
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('AGENTE CAUSAL IDENTIFICADO', M, 108);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  const causalLines = doc.splitTextToSize(input.causalAgent || '—', W - M * 2);
  doc.text(causalLines, M, 115);

  let y = 115 + causalLines.length * 5 + 8;

  // % atribuible (solo si mixto)
  if (input.origin === 'mixto' && typeof input.attributablePercent === 'number') {
    doc.setFillColor(251, 191, 36, 0.1 as unknown as number);
    doc.setDrawColor(251, 191, 36);
    doc.roundedRect(M, y, W - M * 2, 14, 2, 2, 'FD');
    doc.setTextColor(146, 64, 14);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('PORCENTAJE ATRIBUIBLE AL TRABAJO', M + 4, y + 6);
    doc.setFontSize(14);
    doc.text(`${input.attributablePercent}%`, W - M - 4, y + 9, { align: 'right' });
    y += 20;
  }

  // Evidence basis
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('FUNDAMENTACIÓN MÉDICA', M, y);
  y += 3;

  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(252, 252, 252);
  const evidenceBoxBottom = H - 25;
  doc.roundedRect(M, y, W - M * 2, evidenceBoxBottom - y, 2, 2, 'FD');

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const evidenceLines = doc.splitTextToSize(
    input.evidenceBasis || 'Sin fundamentación registrada.',
    W - M * 2 - 8,
  );
  doc.text(evidenceLines, M + 4, y + 7);

  drawFooter(doc);

  // ─────────────────────────── PAGE 5 ───────────────────────────
  // Firma médico evaluador
  doc.addPage();
  drawHeader(doc, 5, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('MÉDICO EVALUADOR', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Profesional responsable de la calificación', W / 2, 54, { align: 'center' });

  // Datos del evaluador
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 62, W - M * 2, 50, 2, 2, 'FD');

  labelize(doc, 'NOMBRE DEL MÉDICO', input.evaluatorName, M + 4, 70);
  labelize(doc, 'RUT MÉDICO', input.evaluatorRut, M + 4, 84);
  labelize(doc, 'N° REG. SUPERINTENDENCIA SALUD', input.evaluatorRegistration, M + 4, 98);
  labelize(doc, 'FECHA DE EVALUACIÓN', input.evaluationDate, M + 110, 70);

  // Firma + sello
  const signY = 150;
  doc.setDrawColor(180, 180, 180);
  doc.line(M + 10, signY, M + 80, signY);
  doc.line(W - M - 80, signY, W - M - 10, signY);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('FIRMA MÉDICO EVALUADOR', M + 45, signY + 6, { align: 'center' });
  doc.text('SELLO PROFESIONAL', W - M - 45, signY + 6, { align: 'center' });

  // Cita normativa final
  doc.setDrawColor(77, 182, 172);
  doc.setLineWidth(0.5);
  doc.line(M, signY + 30, W - M, signY + 30);

  doc.setTextColor(80, 80, 80);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('FUNDAMENTO NORMATIVO', M, signY + 38);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const citationLines = doc.splitTextToSize(citation, W - M * 2);
  doc.text(citationLines, M, signY + 44);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.text(
    'Este documento debe ser revisado por COMPIN o Mutualidad de Empleadores correspondiente.',
    M,
    signY + 56,
  );
  doc.text(
    'Resolución final de calificación queda sujeta a procedimiento de la Ley 16.744.',
    M,
    signY + 60,
  );

  drawFooter(doc);

  return doc;
}

/**
 * Convenience wrapper: build the PDF and trigger a browser download with a
 * deterministic filename. Returns nothing — caller is the UI button.
 */
export function downloadDs109Pdf(input: Ds109Input, filename?: string): void {
  const pdf = generateDs109Pdf(input);
  const safeName = (input.workerName || 'sin_nombre').replace(/[^a-zA-Z0-9]+/g, '_');
  const safeDate = (input.evaluationDate || new Date().toISOString().slice(0, 10))
    .replace(/[^0-9]/g, '-');
  const fname = filename ?? `DS109_${safeName}_${safeDate}.pdf`;
  pdf.save(fname);
}

/**
 * Hash a Chilean RUT (or any PII string) for audit logging. Uses Web Crypto
 * SHA-256 when available; falls back to a non-cryptographic FNV-1a digest if
 * SubtleCrypto is missing (e.g. during SSR-style tests). Result is always a
 * hex string — never expose the raw RUT in audit_logs to keep PII out of the
 * server-side log table.
 */
export async function hashRut(rut: string): Promise<string> {
  const cleaned = (rut || '').replace(/[\s.\-]/g, '').toUpperCase();
  if (!cleaned) return '';

  // Prefer Web Crypto when available (browser + modern Node).
  const subtle =
    typeof globalThis !== 'undefined' &&
    (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    try {
      const data = new TextEncoder().encode(cleaned);
      const buf = await subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // fall through to FNV
    }
  }

  // FNV-1a 32-bit fallback. NOT cryptographic — only used when SubtleCrypto
  // is unavailable. Still better than emitting the raw RUT.
  let h = 0x811c9dc5;
  for (let i = 0; i < cleaned.length; i++) {
    h ^= cleaned.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `fnv1a_${h.toString(16).padStart(8, '0')}`;
}

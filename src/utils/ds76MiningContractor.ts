// Praeventio Guard — DS 76 (Empresa principal contratista en faenas mineras)
// PDF generator.
//
// Marco normativo:
//  - DS N° 76/2007 MINTRAB — Reglamento para la aplicación del art. 66 bis de
//    la Ley N° 16.744. Establece obligaciones de la empresa principal en
//    materia de SST cuando contrata empresas contratistas o subcontratistas
//    para faenas (especialmente mineras), incluyendo la coordinación de
//    actividades preventivas.
//  - SERNAGEOMIN — Servicio Nacional de Geología y Minería (código de faena).
//  - ISO 45001 — Sistema de gestión de SST acreditado.
//
// Patrón de PDF copiado de `ds109Certificate.ts` y `ds67Notification.ts`.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface Ds76ContractorWorker {
  name: string;
  rut: string;
  jobTitle: string;
}

export type Ds76CriticalProcedure =
  | 'trabajo_altura'
  | 'espacios_confinados'
  | 'electrico'
  | 'caliente'
  | 'tronadura'
  | 'izaje'
  | 'manejo_explosivos'
  | 'sustancias_peligrosas';

export const DS76_PROCEDURE_LABELS: Record<Ds76CriticalProcedure, string> = {
  trabajo_altura: 'Trabajo en altura',
  espacios_confinados: 'Espacios confinados',
  electrico: 'Trabajo eléctrico',
  caliente: 'Trabajo en caliente',
  tronadura: 'Tronaduras',
  izaje: 'Izaje de cargas',
  manejo_explosivos: 'Manejo de explosivos',
  sustancias_peligrosas: 'Sustancias peligrosas',
};

export interface Ds76TrainingRecord {
  /** Curso (ej: "Minería subterránea segura — D.S. 132"). */
  courseName: string;
  /** Horas pedagógicas. */
  hours: number;
  /** Fecha de la última edición del curso para esta cuadrilla (ISO yyyy-mm-dd). */
  lastDeliveryDate: string;
}

export type Ds76SgsstStandard = 'iso45001' | 'ohsas18001' | 'inn2393' | 'ninguno';

export const DS76_STANDARD_LABELS: Record<Ds76SgsstStandard, string> = {
  iso45001: 'ISO 45001:2018',
  ohsas18001: 'OHSAS 18001 (legacy)',
  inn2393: 'NCh-INN 2393:2003',
  ninguno: 'Sin acreditación',
};

export interface Ds76Input {
  // Faena
  /** Nombre de la faena minera. */
  worksiteName: string;
  /** Ubicación (región, comuna, coordenadas si aplica). */
  worksiteLocation: string;
  /** Código SERNAGEOMIN. */
  sernageominCode: string;

  // Empresa principal (mandante)
  principalCompanyName: string;
  principalCompanyRut: string;

  // Contratista
  contractorCompanyName: string;
  contractorCompanyRut: string;
  /** Nombre del contrato + n° / código interno. */
  contractName: string;
  contractStartDate: string;
  contractEndDate: string;

  // Personal
  workers: Ds76ContractorWorker[];

  // SGSST
  sgsstStandard: Ds76SgsstStandard;
  /** Identificador externo del certificado de acreditación, si lo hay. */
  sgsstCertificateNumber?: string;
  sgsstCertificateExpiry?: string;

  // Procedimientos críticos aplicables
  criticalProcedures: Ds76CriticalProcedure[];

  // Capacitaciones obligatorias
  trainings: Ds76TrainingRecord[];

  // Firmas
  contractorRepresentativeName: string;
  contractorRepresentativeRut: string;
  /** Auditor de la mutualidad / organismo administrador. */
  mutualAuditorName: string;
  mutualAuditorRut: string;
  reportDate: string;

  /**
   * Cita normativa. Default:
   * "Ley 16.744 art. 66 bis + DS 76/2007 MINTRAB + Reglamento Seguridad Minera".
   */
  citation?: string;
}

const DEFAULT_CITATION =
  'Ley 16.744 art. 66 bis + DS 76/2007 MINTRAB + Reglamento Seguridad Minera';

const W = 210;
const H = 297;
const M = 18;

function drawHeader(doc: jsPDF, pageNumber: number, totalPages: number): void {
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
  doc.text('CONTRATISTA MINERO · DS 76/2007', M + 22, 21);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text('Ley 16.744 art. 66 bis · SERNAGEOMIN · Mutualidad de Empleadores', M + 22, 25);

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
    'Acreditación contratista en faena minera — DS 76/2007 art. 4. Sujeto a auditoría mutualidad.',
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

export function generateDs76Pdf(input: Ds76Input): jsPDF {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const citation = input.citation && input.citation.trim().length > 0
    ? input.citation
    : DEFAULT_CITATION;
  const totalPages = 4;

  // ─── PAGE 1 — Faena + Empresas ───
  drawHeader(doc, 1, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('FAENA Y EMPRESAS INVOLUCRADAS', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Identificación del sitio + mandante + contratista', W / 2, 54, { align: 'center' });

  // Faena box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 62, W - M * 2, 38, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('FAENA MINERA', M + 4, 68);

  labelize(doc, 'NOMBRE DE LA FAENA', input.worksiteName, M + 4, 75);
  labelize(doc, 'CÓDIGO SERNAGEOMIN', input.sernageominCode, M + 4, 87);
  labelize(doc, 'UBICACIÓN', input.worksiteLocation, M + 75, 75);

  // Mandante box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 108, W - M * 2, 32, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('EMPRESA PRINCIPAL (MANDANTE)', M + 4, 114);
  labelize(doc, 'RAZÓN SOCIAL', input.principalCompanyName, M + 4, 121);
  labelize(doc, 'RUT', input.principalCompanyRut, M + 4, 133);

  // Contratista box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 148, W - M * 2, 60, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('EMPRESA CONTRATISTA', M + 4, 154);
  labelize(doc, 'RAZÓN SOCIAL', input.contractorCompanyName, M + 4, 161);
  labelize(doc, 'RUT CONTRATISTA', input.contractorCompanyRut, M + 4, 173);
  labelize(doc, 'CONTRATO', input.contractName, M + 4, 185);
  labelize(doc, 'INICIO', input.contractStartDate, M + 110, 173);
  labelize(doc, 'TÉRMINO', input.contractEndDate, M + 110, 185);

  drawFooter(doc);

  // ─── PAGE 2 — Personal contratista ───
  doc.addPage();
  drawHeader(doc, 2, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('NÓMINA PERSONAL CONTRATISTA', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Trabajadores acreditados en la faena (DS 76 art. 5)', W / 2, 54, { align: 'center' });

  if (input.workers.length > 0) {
    autoTable(doc, {
      startY: 62,
      head: [['Nombre', 'RUT', 'Cargo']],
      body: input.workers.map(w => [w.name, w.rut, w.jobTitle]),
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
    doc.text('Sin nómina cargada.', W / 2, 90, { align: 'center' });
  }

  drawFooter(doc);

  // ─── PAGE 3 — SGSST + Procedimientos críticos + Capacitaciones ───
  doc.addPage();
  drawHeader(doc, 3, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SGSST · PROCEDIMIENTOS · CAPACITACIÓN', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(citation, W / 2, 54, { align: 'center' });

  // SGSST banner
  doc.setFillColor(77, 182, 172);
  doc.roundedRect(M, 62, W - M * 2, 26, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('SISTEMA DE GESTIÓN SST ACREDITADO', W / 2, 71, { align: 'center' });
  doc.setFontSize(14);
  doc.text(DS76_STANDARD_LABELS[input.sgsstStandard], W / 2, 82, { align: 'center' });

  if (input.sgsstCertificateNumber) {
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Certificado N° ${input.sgsstCertificateNumber}` +
        (input.sgsstCertificateExpiry ? ` · Vence: ${input.sgsstCertificateExpiry}` : ''),
      W / 2,
      94,
      { align: 'center' },
    );
  }

  // Procedimientos críticos
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('PROCEDIMIENTOS CRÍTICOS APLICABLES', M, 106);

  const procRows = input.criticalProcedures.length > 0
    ? input.criticalProcedures.map(p => [DS76_PROCEDURE_LABELS[p]])
    : [['Sin procedimientos críticos declarados.']];
  autoTable(doc, {
    startY: 110,
    head: [['Procedimiento']],
    body: procRows,
    headStyles: { fillColor: [6, 31, 45], textColor: [255, 255, 255], fontSize: 9 },
    bodyStyles: { fontSize: 8, textColor: [20, 20, 20] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: M, right: M },
    styles: { cellPadding: 2.5 },
  });

  // Capacitaciones — start after procedures table
  const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 140;
  const capY = lastY + 8;
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('CAPACITACIONES OBLIGATORIAS MINERAS', M, capY);

  if (input.trainings.length > 0) {
    autoTable(doc, {
      startY: capY + 2,
      head: [['Curso', 'Horas', 'Última entrega']],
      body: input.trainings.map(t => [t.courseName, String(t.hours), t.lastDeliveryDate]),
      headStyles: { fillColor: [6, 31, 45], textColor: [255, 255, 255], fontSize: 9 },
      bodyStyles: { fontSize: 8, textColor: [20, 20, 20] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: M, right: M },
      styles: { cellPadding: 2.5 },
    });
  } else {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text('Sin capacitaciones registradas.', M, capY + 8);
  }

  drawFooter(doc);

  // ─── PAGE 4 — Firmas ───
  doc.addPage();
  drawHeader(doc, 4, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('FIRMAS Y AUDITORÍA', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Representante contratista + auditor mutualidad', W / 2, 54, { align: 'center' });

  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 62, W - M * 2, 50, 2, 2, 'FD');
  labelize(doc, 'REPRESENTANTE LEGAL CONTRATISTA', input.contractorRepresentativeName, M + 4, 70);
  labelize(doc, 'RUT REPRESENTANTE', input.contractorRepresentativeRut, M + 4, 84);
  labelize(doc, 'AUDITOR MUTUALIDAD', input.mutualAuditorName, M + 110, 70);
  labelize(doc, 'RUT AUDITOR', input.mutualAuditorRut, M + 110, 84);
  labelize(doc, 'FECHA REPORTE', input.reportDate, M + 4, 100);

  const signY = 150;
  doc.setDrawColor(180, 180, 180);
  doc.line(M + 10, signY, M + 80, signY);
  doc.line(W - M - 80, signY, W - M - 10, signY);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('FIRMA REPRESENTANTE LEGAL', M + 45, signY + 6, { align: 'center' });
  doc.text('FIRMA AUDITOR MUTUALIDAD', W - M - 45, signY + 6, { align: 'center' });

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
    'Este documento debe ser entregado a la mutualidad y archivado en faena por 5 años.',
    M,
    signY + 56,
  );

  drawFooter(doc);

  return doc;
}

export function downloadDs76Pdf(input: Ds76Input, filename?: string): void {
  const pdf = generateDs76Pdf(input);
  const safeName = (input.contractorCompanyName || 'sin_contratista').replace(/[^a-zA-Z0-9]+/g, '_');
  const safeDate = (input.reportDate || new Date().toISOString().slice(0, 10))
    .replace(/[^0-9]/g, '-');
  const fname = filename ?? `DS76_${safeName}_${safeDate}.pdf`;
  pdf.save(fname);
}

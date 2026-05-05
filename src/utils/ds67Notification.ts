// Praeventio Guard — DS 67 (Notificación a la Mutual de Seguridad) PDF generator.
//
// Marco normativo:
//  - DS N° 67/1999 MINTRAB — Reglamento para la aplicación de los artículos
//    15 y 16 de la Ley N° 16.744. Define cómo se notifica un accidente del
//    trabajo a la Mutualidad de Empleadores (organismo administrador).
//  - Ley N° 16.744 art. 76 — obligación del empleador de denunciar accidentes
//    inmediatamente al organismo administrador.
//
// Patrón de PDF copiado de `ds109Certificate.ts` para mantener consistencia
// visual con el resto de los certificados (header oscuro + acento teal + bloques
// de datos + autotable). NO reimplementa estilos: refleja exactamente la misma
// pauta gráfica.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export type Ds67Severity = 'leve' | 'grave' | 'fatal';

export interface Ds67Witness {
  name: string;
  rut: string;
  contact?: string;
}

export interface Ds67Input {
  // Datos trabajador
  workerName: string;
  workerRut: string;
  workerBirthDate: string;
  workerJobTitle: string;
  workerSeniorityYears: number;

  // Empleador
  employerName: string;
  employerRut: string;
  employerAddress: string;
  /** Mutual asociada (ACHS, IST, Mutual CChC, ISL, etc). */
  mutualName: string;

  // Accidente
  accidentDate: string;
  accidentTime: string;
  /** Lugar específico (ej: "Faena Norte, sector chancado, plataforma 3"). */
  accidentLocation: string;
  /** Descripción narrativa del accidente. */
  accidentDescription: string;
  /** Tipo de accidente (caída, golpe, atrapamiento, etc.). */
  accidentType: string;
  /** Código CIE-10 de la lesión, ej: 'S52.5' (fractura radio distal). */
  cieCode?: string;

  // Lesión
  /** Parte del cuerpo afectada (ej: "Mano derecha — dedo índice"). */
  bodyPart: string;
  /** Gravedad clasificada según DS 67. */
  severity: Ds67Severity;
  /** Días de incapacidad estimada (0 si no hay incapacidad). */
  estimatedDisabilityDays: number;

  // Testigos
  witnesses: Ds67Witness[];

  // Acciones inmediatas
  /** Acciones inmediatas tomadas (primeros auxilios, traslado, evacuación). */
  immediateActions: string;

  // Médico tratante
  attendingDoctorName: string;
  attendingDoctorRut: string;
  attendingDoctorRegistration: string;
  reportDate: string;

  /**
   * Cita normativa. Si se omite, se usa el default:
   * "Ley 16.744 art. 76 + DS 67/1999 MINTRAB".
   */
  citation?: string;
}

const SEVERITY_LABELS: Record<Ds67Severity, string> = {
  leve: 'LEVE',
  grave: 'GRAVE',
  fatal: 'FATAL',
};

const SEVERITY_COLORS: Record<Ds67Severity, [number, number, number]> = {
  leve: [77, 182, 172],   // teal: leve
  grave: [251, 191, 36],  // ámbar: grave
  fatal: [239, 68, 68],   // rojo: fatal
};

const DEFAULT_CITATION = 'Ley 16.744 art. 76 + DS 67/1999 MINTRAB';

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
  doc.text('NOTIFICACIÓN ACCIDENTE TRABAJO · DS 67/1999', M + 22, 21);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text('Ley 16.744 art. 76 · DS 67 · MINTRAB · Mutualidad de Empleadores', M + 22, 25);

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
    'Notificación obligatoria conforme Ley 16.744 art. 76 y DS 67/1999. Plazo: 24 horas.',
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
 * Build the DS 67 PDF and return the jsPDF instance (does NOT save).
 */
export function generateDs67Pdf(input: Ds67Input): jsPDF {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const citation = input.citation && input.citation.trim().length > 0
    ? input.citation
    : DEFAULT_CITATION;
  const totalPages = 4;

  // ─── PAGE 1 — Trabajador + Empleador ───
  drawHeader(doc, 1, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('IDENTIFICACIÓN TRABAJADOR Y EMPLEADOR', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Notificación de accidente a la Mutualidad de Empleadores', W / 2, 54, { align: 'center' });

  // Worker box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 62, W - M * 2, 60, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL TRABAJADOR ACCIDENTADO', M + 4, 68);

  labelize(doc, 'NOMBRE COMPLETO', input.workerName, M + 4, 75);
  labelize(doc, 'RUT', input.workerRut, M + 4, 87);
  labelize(doc, 'FECHA DE NACIMIENTO', input.workerBirthDate, M + 4, 99);
  labelize(doc, 'CARGO / OFICIO', input.workerJobTitle, M + 75, 75);
  labelize(doc, 'ANTIGÜEDAD (AÑOS)', String(input.workerSeniorityYears ?? 0), M + 75, 87);

  // Employer box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 130, W - M * 2, 60, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('EMPLEADOR Y MUTUAL ASOCIADA', M + 4, 136);

  labelize(doc, 'RAZÓN SOCIAL', input.employerName, M + 4, 143);
  labelize(doc, 'RUT EMPLEADOR', input.employerRut, M + 4, 155);
  labelize(doc, 'MUTUAL DE SEGURIDAD', input.mutualName, M + 4, 167);
  labelize(doc, 'DIRECCIÓN', input.employerAddress, M + 75, 143);

  drawFooter(doc);

  // ─── PAGE 2 — Datos del accidente ───
  doc.addPage();
  drawHeader(doc, 2, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL ACCIDENTE', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Circunstancias del evento (DS 67 art. 12)', W / 2, 54, { align: 'center' });

  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 62, W - M * 2, 50, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('CUÁNDO Y DÓNDE', M + 4, 68);

  labelize(doc, 'FECHA DEL ACCIDENTE', input.accidentDate, M + 4, 75);
  labelize(doc, 'HORA', input.accidentTime, M + 4, 87);
  labelize(doc, 'LUGAR ESPECÍFICO', input.accidentLocation, M + 75, 75);
  labelize(doc, 'TIPO DE ACCIDENTE', input.accidentType, M + 75, 87);
  if (input.cieCode) {
    labelize(doc, 'CÓDIGO CIE-10', input.cieCode, M + 4, 99);
  }

  // Description box
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('DESCRIPCIÓN NARRATIVA DEL ACCIDENTE', M, 122);

  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(252, 252, 252);
  doc.roundedRect(M, 125, W - M * 2, H - 125 - 25, 2, 2, 'FD');

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const descLines = doc.splitTextToSize(
    input.accidentDescription || 'Sin descripción registrada.',
    W - M * 2 - 8,
  );
  doc.text(descLines, M + 4, 132);

  drawFooter(doc);

  // ─── PAGE 3 — Lesión + Testigos ───
  doc.addPage();
  drawHeader(doc, 3, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('LESIÓN Y TESTIGOS', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(citation, W / 2, 54, { align: 'center' });

  // Severity banner
  const [r, g, b] = SEVERITY_COLORS[input.severity];
  doc.setFillColor(r, g, b);
  doc.roundedRect(M, 62, W - M * 2, 28, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('CLASIFICACIÓN DE GRAVEDAD', W / 2, 71, { align: 'center' });
  doc.setFontSize(18);
  doc.text(`ACCIDENTE ${SEVERITY_LABELS[input.severity]}`, W / 2, 83, { align: 'center' });

  // Lesión data
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 96, W - M * 2, 32, 2, 2, 'FD');
  labelize(doc, 'PARTE DEL CUERPO AFECTADA', input.bodyPart, M + 4, 104);
  labelize(doc, 'DÍAS DE INCAPACIDAD ESTIMADA', String(input.estimatedDisabilityDays ?? 0), M + 4, 118);
  labelize(doc, 'GRAVEDAD', SEVERITY_LABELS[input.severity], M + 110, 104);

  // Witnesses
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('TESTIGOS PRESENCIALES', M, 138);

  if (input.witnesses.length > 0) {
    autoTable(doc, {
      startY: 142,
      head: [['Nombre', 'RUT', 'Contacto']],
      body: input.witnesses.map(w => [w.name, w.rut, w.contact || '—']),
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
    doc.text('Sin testigos registrados.', W / 2, 155, { align: 'center' });
  }

  drawFooter(doc);

  // ─── PAGE 4 — Acciones + Médico tratante ───
  doc.addPage();
  drawHeader(doc, 4, totalPages);

  doc.setTextColor(6, 31, 45);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('ACCIONES INMEDIATAS Y MÉDICO TRATANTE', W / 2, 48, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Respuesta inmediata + responsable médico', W / 2, 54, { align: 'center' });

  // Immediate actions
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('ACCIONES INMEDIATAS TOMADAS', M, 64);

  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(252, 252, 252);
  doc.roundedRect(M, 67, W - M * 2, 48, 2, 2, 'FD');

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const actionLines = doc.splitTextToSize(
    input.immediateActions || 'Sin acciones registradas.',
    W - M * 2 - 8,
  );
  doc.text(actionLines, M + 4, 75);

  // Doctor
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 122, W - M * 2, 50, 2, 2, 'FD');
  labelize(doc, 'NOMBRE DEL MÉDICO TRATANTE', input.attendingDoctorName, M + 4, 130);
  labelize(doc, 'RUT MÉDICO', input.attendingDoctorRut, M + 4, 144);
  labelize(doc, 'N° REG. SUPERINTENDENCIA SALUD', input.attendingDoctorRegistration, M + 4, 158);
  labelize(doc, 'FECHA DEL REPORTE', input.reportDate, M + 110, 130);

  // Signature
  const signY = 198;
  doc.setDrawColor(180, 180, 180);
  doc.line(M + 10, signY, M + 80, signY);
  doc.line(W - M - 80, signY, W - M - 10, signY);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('FIRMA MÉDICO TRATANTE', M + 45, signY + 6, { align: 'center' });
  doc.text('FIRMA REPRESENTANTE EMPLEADOR', W - M - 45, signY + 6, { align: 'center' });

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
    'Plazo legal de notificación a la Mutualidad: 24 horas desde el accidente.',
    M,
    signY + 56,
  );

  drawFooter(doc);

  return doc;
}

/**
 * Build the PDF and trigger a browser download with a deterministic filename.
 */
export function downloadDs67Pdf(input: Ds67Input, filename?: string): void {
  const pdf = generateDs67Pdf(input);
  const safeName = (input.workerName || 'sin_nombre').replace(/[^a-zA-Z0-9]+/g, '_');
  const safeDate = (input.accidentDate || new Date().toISOString().slice(0, 10))
    .replace(/[^0-9]/g, '-');
  const fname = filename ?? `DS67_${safeName}_${safeDate}.pdf`;
  pdf.save(fname);
}

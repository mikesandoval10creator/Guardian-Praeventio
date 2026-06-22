import { jsPDF } from 'jspdf';

export interface AptitudeData {
  workerName: string;
  workerRut: string;
  workerAge?: number;
  workerOccupation: string;
  projectName: string;
  examType: 'pre_empleo' | 'periodico' | 'reintegro' | 'egreso' | 'otro';
  examDate: string;
  result: 'apto' | 'apto_con_restricciones' | 'no_apto';
  restrictions?: string[];
  validUntil?: string;
  doctorName: string;
  doctorRut: string;
  doctorRegistry: string;
  observations?: string;
}

const EXAM_LABELS: Record<AptitudeData['examType'], string> = {
  pre_empleo: 'PRE-EMPLEO',
  periodico: 'PERIÓDICO',
  reintegro: 'REINTEGRO LABORAL',
  egreso: 'EGRESO',
  otro: 'OTRO',
};

const RESULT_LABELS: Record<AptitudeData['result'], string> = {
  apto: 'APTO',
  apto_con_restricciones: 'APTO CON RESTRICCIONES',
  no_apto: 'NO APTO',
};

const RESULT_COLORS: Record<AptitudeData['result'], [number, number, number]> = {
  apto: [77, 182, 172],
  apto_con_restricciones: [251, 191, 36],
  no_apto: [239, 68, 68],
};

export function generateAptitudeCertificate(data: AptitudeData): void {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const W = 210;
  const H = 297;
  const M = 18;

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
  doc.text('SISTEMA DE PREVENCIÓN DE RIESGOS LABORALES', M + 22, 21);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text('Ley 16.744  ·  DS 109  ·  DS 594  ·  MINSAL', M + 22, 25);

  // Title
  doc.setTextColor(6, 31, 45);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('CERTIFICADO DE APTITUD MÉDICA OCUPACIONAL', W / 2, 48, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`EXAMEN ${EXAM_LABELS[data.examType]}  ·  Conforme DS 109 Reglamento Ley 16.744`, W / 2, 54, { align: 'center' });

  // Worker box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 62, W - M * 2, 38, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL TRABAJADOR', M + 4, 68);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(9);
  const labelize = (label: string, value: string, x: number, y: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9);
    doc.text(value || '—', x, y + 4);
  };

  labelize('NOMBRE COMPLETO', data.workerName, M + 4, 75);
  labelize('RUT', data.workerRut, M + 4, 87);
  labelize('OCUPACIÓN', data.workerOccupation, M + 75, 75);
  labelize('EDAD', data.workerAge ? `${data.workerAge} años` : '—', M + 75, 87);
  labelize('PROYECTO / EMPRESA', data.projectName, M + 130, 75);
  labelize('FECHA EXAMEN', data.examDate, M + 130, 87);

  // Result block (large)
  const [r, g, b] = RESULT_COLORS[data.result];
  doc.setFillColor(r, g, b);
  doc.roundedRect(M, 110, W - M * 2, 28, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('RESULTADO DICTAMEN MÉDICO', W / 2, 119, { align: 'center' });
  doc.setFontSize(20);
  doc.text(RESULT_LABELS[data.result], W / 2, 130, { align: 'center' });

  // Restrictions
  let y = 152;
  if (data.restrictions && data.restrictions.length > 0) {
    doc.setTextColor(251, 191, 36);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('RESTRICCIONES LABORALES', M, y);
    y += 5;
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    data.restrictions.forEach(r => {
      doc.text(`•  ${r}`, M + 2, y);
      y += 5;
    });
    y += 3;
  }

  // Observations
  if (data.observations) {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('OBSERVACIONES', M, y);
    y += 5;
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(data.observations, W - M * 2);
    doc.text(lines, M, y);
    y += lines.length * 5 + 3;
  }

  if (data.validUntil) {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.text(`Vigencia hasta: `, M, y);
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.text(data.validUntil, M + 25, y);
    y += 8;
  }

  // Doctor signature block
  const signY = Math.max(y + 10, H - 70);
  doc.setDrawColor(180, 180, 180);
  doc.line(M, signY, W - M, signY);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('MÉDICO RESPONSABLE', M, signY + 6);
  doc.text('REGISTRO PROFESIONAL', W / 2 + 5, signY + 6);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(data.doctorName, M, signY + 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`RUT: ${data.doctorRut}`, M, signY + 17);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(data.doctorRegistry, W / 2 + 5, signY + 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Reg. Superintendencia de Salud', W / 2 + 5, signY + 17);

  // Footer
  doc.setFillColor(6, 31, 45);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text(`Documento generado por Guardian Praeventio  ·  ${new Date().toLocaleString('es-CL')}`, W / 2, H - 6, { align: 'center' });
  doc.setTextColor(212, 175, 55);
  doc.setFontSize(6);
  doc.text('Este certificado es válido conforme a la Ley 16.744 y su Reglamento (DS 109).', W / 2, H - 2, { align: 'center' });

  const fname = `Aptitud_${data.workerName.replace(/\s+/g, '_')}_${data.examDate.replace(/\//g, '-')}.pdf`;
  doc.save(fname);
}

/**
 * Server-side variant: produces the same PDF as `generateAptitudeCertificate`
 * but returns the raw bytes (Uint8Array) + filename instead of triggering a
 * browser download. Safe to call from Node.js (no `document` access needed —
 * jsPDF does not require a DOM to produce bytes when output('arraybuffer') is
 * used instead of save()).
 *
 * Used by the `CL/aptitude_cert` compliance emit adapter.
 */
export function generateAptitudeCertificateBytes(data: AptitudeData): {
  bytes: Uint8Array;
  filename: string;
} {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const W = 210;
  const H = 297;
  const M = 18;

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
  doc.text('SISTEMA DE PREVENCIÓN DE RIESGOS LABORALES', M + 22, 21);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text('Ley 16.744  ·  DS 109  ·  DS 594  ·  MINSAL', M + 22, 25);

  // Title
  doc.setTextColor(6, 31, 45);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('CERTIFICADO DE APTITUD MÉDICA OCUPACIONAL', W / 2, 48, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`EXAMEN ${EXAM_LABELS[data.examType]}  ·  Conforme DS 109 Reglamento Ley 16.744`, W / 2, 54, { align: 'center' });

  // Worker box
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, 62, W - M * 2, 38, 2, 2, 'FD');
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL TRABAJADOR', M + 4, 68);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(9);
  const labelize = (label: string, value: string, x: number, y: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9);
    doc.text(value || '—', x, y + 4);
  };

  labelize('NOMBRE COMPLETO', data.workerName, M + 4, 75);
  labelize('RUT', data.workerRut, M + 4, 87);
  labelize('OCUPACIÓN', data.workerOccupation, M + 75, 75);
  labelize('EDAD', data.workerAge ? `${data.workerAge} años` : '—', M + 75, 87);
  labelize('PROYECTO / EMPRESA', data.projectName, M + 130, 75);
  labelize('FECHA EXAMEN', data.examDate, M + 130, 87);

  // Result block (large)
  const [r, g, b] = RESULT_COLORS[data.result];
  doc.setFillColor(r, g, b);
  doc.roundedRect(M, 110, W - M * 2, 28, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('RESULTADO DICTAMEN MÉDICO', W / 2, 119, { align: 'center' });
  doc.setFontSize(20);
  doc.text(RESULT_LABELS[data.result], W / 2, 130, { align: 'center' });

  // Restrictions
  let y = 152;
  if (data.restrictions && data.restrictions.length > 0) {
    doc.setTextColor(251, 191, 36);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('RESTRICCIONES LABORALES', M, y);
    y += 5;
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    data.restrictions.forEach(restriction => {
      doc.text(`•  ${restriction}`, M + 2, y);
      y += 5;
    });
    y += 3;
  }

  // Observations
  if (data.observations) {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('OBSERVACIONES', M, y);
    y += 5;
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(data.observations, W - M * 2);
    doc.text(lines, M, y);
    y += lines.length * 5 + 3;
  }

  if (data.validUntil) {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.text(`Vigencia hasta: `, M, y);
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.text(data.validUntil, M + 25, y);
    y += 8;
  }

  // Doctor signature block
  const signY = Math.max(y + 10, H - 70);
  doc.setDrawColor(180, 180, 180);
  doc.line(M, signY, W - M, signY);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('MÉDICO RESPONSABLE', M, signY + 6);
  doc.text('REGISTRO PROFESIONAL', W / 2 + 5, signY + 6);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(data.doctorName, M, signY + 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`RUT: ${data.doctorRut}`, M, signY + 17);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(data.doctorRegistry, W / 2 + 5, signY + 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Reg. Superintendencia de Salud', W / 2 + 5, signY + 17);

  // Footer
  doc.setFillColor(6, 31, 45);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text(`Documento generado por Guardian Praeventio  ·  ${new Date().toLocaleString('es-CL')}`, W / 2, H - 6, { align: 'center' });
  doc.setTextColor(212, 175, 55);
  doc.setFontSize(6);
  doc.text('Este certificado es válido conforme a la Ley 16.744 y su Reglamento (DS 109).', W / 2, H - 2, { align: 'center' });

  const arrayBuffer = doc.output('arraybuffer');
  const bytes = new Uint8Array(arrayBuffer);
  const filename = `Aptitud_${data.workerName.replace(/\s+/g, '_')}_${data.examDate.replace(/\//g, '-')}.pdf`;
  return { bytes, filename };
}

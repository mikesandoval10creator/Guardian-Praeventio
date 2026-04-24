import { jsPDF } from 'jspdf';

export function generateTrainingCertificate(
  trainingTitle: string,
  participantName: string,
  projectName: string,
  completedAt: string,
  score?: number
): void {
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const W = 297;
  const H = 210;

  // Background
  doc.setFillColor(24, 24, 27); // zinc-950
  doc.rect(0, 0, W, H, 'F');

  // Green accent border
  doc.setDrawColor(88, 214, 109);
  doc.setLineWidth(1.5);
  doc.rect(10, 10, W - 20, H - 20, 'S');
  doc.setLineWidth(0.3);
  doc.rect(13, 13, W - 26, H - 26, 'S');

  // Corner accents
  const accentSize = 8;
  doc.setLineWidth(2);
  [[10, 10], [W - 10, 10], [10, H - 10], [W - 10, H - 10]].forEach(([x, y]) => {
    doc.line(x, y, x + (x < W / 2 ? accentSize : -accentSize), y);
    doc.line(x, y, x, y + (y < H / 2 ? accentSize : -accentSize));
  });

  // Logo area
  doc.setFillColor(88, 214, 109);
  doc.roundedRect(W / 2 - 12, 22, 24, 24, 4, 4, 'F');
  doc.setTextColor(24, 24, 27);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('GP', W / 2, 37, { align: 'center' });

  // Header
  doc.setTextColor(88, 214, 109);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('GUARDIAN PRAEVENTIO', W / 2, 54, { align: 'center' });

  // Certificate title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('CERTIFICADO DE CAPACITACIÓN', W / 2, 72, { align: 'center' });

  // Separator
  doc.setDrawColor(88, 214, 109);
  doc.setLineWidth(0.5);
  doc.line(W / 2 - 60, 76, W / 2 + 60, 76);

  // "Se certifica que"
  doc.setTextColor(161, 161, 170); // zinc-400
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Se certifica que', W / 2, 88, { align: 'center' });

  // Participant name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.text(participantName, W / 2, 103, { align: 'center' });

  // Underline for name
  const nameWidth = doc.getTextWidth(participantName);
  doc.setDrawColor(88, 214, 109);
  doc.setLineWidth(0.5);
  doc.line(W / 2 - nameWidth / 2, 106, W / 2 + nameWidth / 2, 106);

  // "ha completado satisfactoriamente"
  doc.setTextColor(161, 161, 170);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('ha completado satisfactoriamente el curso', W / 2, 116, { align: 'center' });

  // Training title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(trainingTitle, 180);
  doc.text(titleLines, W / 2, 127, { align: 'center' });

  // Footer info
  const footerY = H - 28;
  doc.setLineWidth(0.2);
  doc.setDrawColor(63, 63, 70); // zinc-700
  doc.line(30, footerY - 4, W - 30, footerY - 4);

  const dateFormatted = new Date(completedAt).toLocaleDateString('es-CL', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  doc.setTextColor(113, 113, 122); // zinc-500
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Proyecto: ${projectName}`, 30, footerY + 2);
  doc.text(`Fecha: ${dateFormatted}`, W / 2, footerY + 2, { align: 'center' });
  if (score !== undefined) {
    doc.text(`Puntaje: ${Math.round(score)}%`, W - 30, footerY + 2, { align: 'right' });
  }
  doc.text(`Cumplimiento DS 54 · DS 40 · Ley 16.744`, W / 2, footerY + 9, { align: 'center' });

  const fileName = `Certificado_${trainingTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${participantName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  doc.save(fileName);
}

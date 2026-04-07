import React, { useState } from 'react';
import { FileText, Wand2, Download, Loader2, CheckCircle2, AlertCircle, WifiOff, Cloud } from 'lucide-react';
import { generateSafetyReport } from '../../services/geminiService';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useProject } from '../../contexts/ProjectContext';
import { NodeType } from '../../types';
import { jsPDF } from 'jspdf';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function ReportGenerator() {
  const [reportType, setReportType] = useState<'PTS' | 'PE' | 'AST'>('PTS');
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  const handleGenerate = async () => {
    if (!context.trim() || !isOnline) return;
    setLoading(true);
    try {
      const result = await generateSafetyReport(reportType, context);
      setReport(result);

      // Save to Zettelkasten
      await addNode({
        type: NodeType.DOCUMENT,
        title: `${reportType}: Generado por IA`,
        description: result,
        tags: ['IA', reportType, 'Seguridad'],
        metadata: {
          type: reportType,
          generatedAt: new Date().toISOString()
        },
        projectId: selectedProject?.id,
        connections: []
      });
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setLoading(false);
    }
  };

  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [savedToCloud, setSavedToCloud] = useState(false);

  const handleSaveToCloud = async () => {
    if (!report || !selectedProject) return;
    setIsSavingToCloud(true);
    
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      
      // --- Header (Industrial Style) ---
      doc.setFillColor(24, 24, 27); // Zinc 900
      doc.rect(0, 0, pageWidth, 40, 'F');
      
      // Accent line
      doc.setFillColor(16, 185, 129); // Emerald 500
      doc.rect(0, 40, pageWidth, 2, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('PRAEVENTIO GUARD', margin, 22);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(161, 161, 170); // Zinc 400
      doc.text('SISTEMA DE GESTIÓN DE SEGURIDAD Y SALUD EN EL TRABAJO', margin, 32);

      // Document Info Box
      doc.setFillColor(244, 244, 245); // Zinc 100
      doc.rect(margin, 50, contentWidth, 30, 'F');
      doc.setDrawColor(212, 212, 216); // Zinc 300
      doc.rect(margin, 50, contentWidth, 30, 'S');

      doc.setTextColor(39, 39, 42); // Zinc 800
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(`TIPO DE DOCUMENTO: ${reportType}`, margin + 5, 60);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`PROYECTO: ${selectedProject?.name || 'N/A'}`, margin + 5, 70);
      doc.text(`FECHA DE EMISIÓN: ${new Date().toLocaleDateString('es-CL')}`, margin + 5, 76);

      // --- Content ---
      doc.setTextColor(39, 39, 42); // Zinc 800
      doc.setFontSize(11);
      
      // Simple markdown parsing for PDF
      const lines = report.split('\n');
      let yPos = 95;

      lines.forEach(line => {
        if (yPos > pageHeight - margin - 20) {
          doc.addPage();
          yPos = margin + 10;
        }

        if (line.startsWith('## ')) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(14);
          doc.setTextColor(24, 24, 27);
          doc.text(line.replace('## ', ''), margin, yPos);
          yPos += 8;
        } else if (line.startsWith('# ')) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(16);
          doc.setTextColor(16, 185, 129); // Emerald
          doc.text(line.replace('# ', ''), margin, yPos);
          yPos += 10;
        } else if (line.startsWith('**') && line.endsWith('**')) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(39, 39, 42);
          doc.text(line.replace(/\*\*/g, ''), margin, yPos);
          yPos += 6;
        } else if (line.startsWith('- ')) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(63, 63, 70);
          const splitText = doc.splitTextToSize(`• ${line.replace('- ', '')}`, contentWidth - 5);
          doc.text(splitText, margin + 5, yPos);
          yPos += (splitText.length * 5) + 2;
        } else if (line.trim() !== '') {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(63, 63, 70);
          // Remove bold markdown for regular text
          const cleanLine = line.replace(/\*\*/g, '');
          const splitText = doc.splitTextToSize(cleanLine, contentWidth);
          doc.text(splitText, margin, yPos);
          yPos += (splitText.length * 5) + 2;
        } else {
          yPos += 4; // Empty line spacing
        }
      });
      
      // --- Footer ---
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        
        // Footer line
        doc.setDrawColor(212, 212, 216);
        doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);

        doc.setFontSize(8);
        doc.setTextColor(113, 113, 122); // Zinc 500
        doc.setFont('helvetica', 'italic');
        doc.text(`Documento generado automáticamente por Praeventio Guard AI`, margin, pageHeight - 8);
        
        doc.setFont('helvetica', 'normal');
        doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin - 20, pageHeight - 8);
      }
      
      const pdfBlob = doc.output('blob');
      
      const { storage, ref, uploadBytes, getDownloadURL, collection, addDoc, db, handleFirestoreError, OperationType } = await import('../../services/firebase');
      const fileName = `Praeventio_${reportType}_${Date.now()}.pdf`;
      const storageRef = ref(storage, `ai_reports/${selectedProject.id}/${fileName}`);
      
      await uploadBytes(storageRef, pdfBlob);
      const downloadUrl = await getDownloadURL(storageRef);
      
      try {
        await addDoc(collection(db, `projects/${selectedProject.id}/documents`), {
          name: `${reportType} Generado por IA`,
          type: 'pdf',
          url: downloadUrl,
          projectId: selectedProject.id,
          category: 'SST',
          status: 'Vigente',
          version: '1.0',
          updatedAt: new Date().toISOString(),
          size: pdfBlob.size
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `projects/${selectedProject.id}/documents`);
      }

      setSavedToCloud(true);
      setTimeout(() => setSavedToCloud(false), 3000);
    } catch (error) {
      console.error("Error saving to cloud:", error);
      alert('Error al guardar en la nube.');
    } finally {
      setIsSavingToCloud(false);
    }
  };

  const handleDownloadPDF = () => {
    if (!report) return;
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    
    // --- Header (Industrial Style) ---
    doc.setFillColor(24, 24, 27); // Zinc 900
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    // Accent line
    doc.setFillColor(16, 185, 129); // Emerald 500
    doc.rect(0, 40, pageWidth, 2, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('PRAEVENTIO GUARD', margin, 22);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(161, 161, 170); // Zinc 400
    doc.text('SISTEMA DE GESTIÓN DE SEGURIDAD Y SALUD EN EL TRABAJO', margin, 32);

    // Document Info Box
    doc.setFillColor(244, 244, 245); // Zinc 100
    doc.rect(margin, 50, contentWidth, 30, 'F');
    doc.setDrawColor(212, 212, 216); // Zinc 300
    doc.rect(margin, 50, contentWidth, 30, 'S');

    doc.setTextColor(39, 39, 42); // Zinc 800
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`TIPO DE DOCUMENTO: ${reportType}`, margin + 5, 60);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`PROYECTO: ${selectedProject?.name || 'N/A'}`, margin + 5, 70);
    doc.text(`FECHA DE EMISIÓN: ${new Date().toLocaleDateString('es-CL')}`, margin + 5, 76);

    // --- Content ---
    doc.setTextColor(39, 39, 42); // Zinc 800
    doc.setFontSize(11);
    
    // Simple markdown parsing for PDF
    const lines = report.split('\n');
    let yPos = 95;

    lines.forEach(line => {
      if (yPos > pageHeight - margin - 20) {
        doc.addPage();
        yPos = margin + 10;
      }

      if (line.startsWith('## ')) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(24, 24, 27);
        doc.text(line.replace('## ', ''), margin, yPos);
        yPos += 8;
      } else if (line.startsWith('# ')) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(16, 185, 129); // Emerald
        doc.text(line.replace('# ', ''), margin, yPos);
        yPos += 10;
      } else if (line.startsWith('**') && line.endsWith('**')) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(39, 39, 42);
        doc.text(line.replace(/\*\*/g, ''), margin, yPos);
        yPos += 6;
      } else if (line.startsWith('- ')) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(63, 63, 70);
        const splitText = doc.splitTextToSize(`• ${line.replace('- ', '')}`, contentWidth - 5);
        doc.text(splitText, margin + 5, yPos);
        yPos += (splitText.length * 5) + 2;
      } else if (line.trim() !== '') {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(63, 63, 70);
        // Remove bold markdown for regular text
        const cleanLine = line.replace(/\*\*/g, '');
        const splitText = doc.splitTextToSize(cleanLine, contentWidth);
        doc.text(splitText, margin, yPos);
        yPos += (splitText.length * 5) + 2;
      } else {
        yPos += 4; // Empty line spacing
      }
    });
    
    // --- Footer ---
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      
      // Footer line
      doc.setDrawColor(212, 212, 216);
      doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);

      doc.setFontSize(8);
      doc.setTextColor(113, 113, 122); // Zinc 500
      doc.setFont('helvetica', 'italic');
      doc.text(`Documento generado automáticamente por Praeventio Guard AI`, margin, pageHeight - 8);
      
      doc.setFont('helvetica', 'normal');
      doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin - 20, pageHeight - 8);
    }
    
    doc.save(`Praeventio_${reportType}_${new Date().getTime()}.pdf`);
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white uppercase tracking-tight">Generador de Documentos IA</h3>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">PTS, PE y AST Automatizados</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Tipo de Documento</label>
            <div className="grid grid-cols-3 gap-2">
              {(['PTS', 'PE', 'AST'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setReportType(type)}
                  className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                    reportType === type
                      ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)]'
                      : 'bg-zinc-100 dark:bg-white/5 border-zinc-200 dark:border-white/5 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/10'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Contexto del Trabajo / Emergencia</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Describe la actividad, ubicación y equipos involucrados..."
              className="w-full h-48 p-4 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-2xl text-sm text-zinc-900 dark:text-white outline-none focus:border-blue-500 transition-colors resize-none"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !context.trim() || !isOnline}
            className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg ${
              !isOnline ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-900/20 disabled:opacity-50'
            }`}
          >
            {!isOnline ? (
              <>
                <WifiOff className="w-4 h-4" />
                Requiere Conexión
              </>
            ) : loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generando Documento...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Generar Borrador con IA
              </>
            )}
          </button>
        </div>

        <div className="bg-white dark:bg-black/40 rounded-3xl border border-zinc-200 dark:border-white/5 p-6 min-h-[400px] relative overflow-hidden">
          <AnimatePresence mode="wait">
            {report ? (
              <motion.div
                key="report"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="prose prose-invert prose-sm max-w-none"
              >
                <div className="flex justify-end gap-2 mb-4">
                  <button 
                    onClick={handleDownloadPDF}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    Descargar PDF
                  </button>
                  <button 
                    onClick={handleSaveToCloud}
                    disabled={isSavingToCloud || savedToCloud}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
                      savedToCloud 
                        ? 'bg-emerald-500/20 text-emerald-500' 
                        : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-500'
                    }`}
                  >
                    {isSavingToCloud ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : savedToCloud ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <Cloud className="w-3 h-3" />
                    )}
                    {savedToCloud ? 'Guardado' : 'Guardar en la Nube'}
                  </button>
                </div>
                <div className="markdown-body">
                  <ReactMarkdown>{report}</ReactMarkdown>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 space-y-4"
              >
                <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center text-zinc-700 border border-white/5">
                  <FileText className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Vista Previa del Documento</p>
                  <p className="text-[10px] text-zinc-600 mt-1">Completa el contexto y presiona generar para ver el borrador.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { generateEmergencyPlan } from '../../services/geminiService';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useProject } from '../../contexts/ProjectContext';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { FileText, Loader2, Zap, Shield, CheckCircle2, Save, Download, X, WifiOff, Cloud } from 'lucide-react';
import { Button } from '../shared/Card';
import ReactMarkdown from 'react-markdown';
import { jsPDF } from 'jspdf';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function EmergencyPlanGenerator() {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { nodes, environment } = useUniversalKnowledge();
  const { selectedProject } = useProject();
  const { addNode } = useRiskEngine();
  const isOnline = useOnlineStatus();

  const handleGenerate = async () => {
    if (!selectedProject || !isOnline) return;
    setLoading(true);
    setPlan(null);
    setSaved(false);
    try {
      const context = nodes
        .filter(n => n.projectId === selectedProject.id)
        .map(n => `- [${n.type}] ${n.title}: ${n.description}`)
        .join('\n');

      const envContext = environment ? `Clima actual: ${environment.weather.temp}°C, Viento: ${environment.weather.windSpeed}km/h. Sismos recientes: ${environment.earthquakes.length > 0 ? environment.earthquakes[0].Magnitud + ' en ' + environment.earthquakes[0].RefGeografica : 'Ninguno'}.` : 'Sin datos ambientales.';
      const fullContext = `${context}\n\nCONTEXTO AMBIENTAL ACTUAL:\n${envContext}`;

      const result = await generateEmergencyPlan(selectedProject.name, fullContext);
      setPlan(result);
    } catch (error) {
      console.error('Error generating emergency plan:', error);
    } finally {
      setLoading(false);
    }
  };

  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [savedToCloud, setSavedToCloud] = useState(false);

  const handleSaveToCloud = async () => {
    if (!plan || !selectedProject) return;
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
      doc.setFillColor(244, 63, 94); // Rose 500
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
      doc.text(`TIPO DE DOCUMENTO: PLAN DE EMERGENCIA (PE)`, margin + 5, 60);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`PROYECTO: ${selectedProject?.name || 'N/A'}`, margin + 5, 70);
      doc.text(`FECHA DE EMISIÓN: ${new Date().toLocaleDateString('es-CL')}`, margin + 5, 76);

      // --- Content ---
      doc.setTextColor(39, 39, 42); // Zinc 800
      doc.setFontSize(11);
      
      // Simple markdown parsing for PDF
      const lines = plan.split('\n');
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
          doc.setTextColor(244, 63, 94); // Rose
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
      const fileName = `Praeventio_PE_${Date.now()}.pdf`;
      const storageRef = ref(storage, `ai_reports/${selectedProject.id}/${fileName}`);
      
      await uploadBytes(storageRef, pdfBlob);
      const downloadUrl = await getDownloadURL(storageRef);
      
      try {
        await addDoc(collection(db, `projects/${selectedProject.id}/documents`), {
          name: `Plan de Emergencia Generado por IA`,
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
    if (!plan || !selectedProject) return;
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    
    // --- Header (Industrial Style) ---
    doc.setFillColor(24, 24, 27); // Zinc 900
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    // Accent line
    doc.setFillColor(244, 63, 94); // Rose 500
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
    doc.text(`TIPO DE DOCUMENTO: PLAN DE EMERGENCIA (PE)`, margin + 5, 60);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`PROYECTO: ${selectedProject?.name || 'N/A'}`, margin + 5, 70);
    doc.text(`FECHA DE EMISIÓN: ${new Date().toLocaleDateString('es-CL')}`, margin + 5, 76);

    // --- Content ---
    doc.setTextColor(39, 39, 42); // Zinc 800
    doc.setFontSize(11);
    
    // Simple markdown parsing for PDF
    const lines = plan.split('\n');
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
        doc.setTextColor(244, 63, 94); // Rose
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
    
    doc.save(`Praeventio_PE_${new Date().getTime()}.pdf`);
  };

  const handleSave = async () => {
    if (!plan || !selectedProject) return;
    setLoading(true);
    try {
      await addNode({
        type: NodeType.NORMATIVE,
        title: `Plan de Emergencia IA: ${selectedProject.name}`,
        description: plan,
        tags: ['PE', 'IA', 'Emergencia', selectedProject.name],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          generatedBy: 'El Guardián AI',
          type: 'Emergency Plan',
          timestamp: new Date().toISOString()
        }
      });
      setSaved(true);
    } catch (error) {
      console.error('Error saving emergency plan:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-500 border border-rose-500/20">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-tight">Generador de Planes de Emergencia</h3>
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Generación automática basada en la Red Neuronal</p>
          </div>
        </div>
        {!plan ? (
          <Button
            onClick={handleGenerate}
            disabled={loading || !selectedProject || !isOnline}
            className={`px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-50 ${
              !isOnline ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-rose-600 hover:bg-rose-700 text-white'
            }`}
          >
            {!isOnline ? <WifiOff className="w-4 h-4" /> : loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {!isOnline ? 'Requiere Conexión' : 'Generar Plan'}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              onClick={handleDownloadPDF}
              disabled={loading || !isOnline}
              title={!isOnline ? 'Requiere conexión a internet' : ''}
              className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all ${
                !isOnline ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed' : 'bg-zinc-800 hover:bg-zinc-700 text-white'
              }`}
            >
              <Download className="w-4 h-4" />
              PDF
            </Button>
            <Button
              onClick={handleSave}
              disabled={loading || saved || !isOnline}
              title={!isOnline ? 'Requiere conexión a internet' : ''}
              className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all ${
                !isOnline ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed' : saved ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-zinc-800 text-white hover:bg-zinc-700'
              }`}
            >
              {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Zettelkasten' : 'Zettelkasten'}
            </Button>
            <Button
              onClick={handleSaveToCloud}
              disabled={isSavingToCloud || savedToCloud || !isOnline}
              title={!isOnline ? 'Requiere conexión a internet' : ''}
              className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all ${
                !isOnline ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed' : savedToCloud ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'bg-zinc-800 text-white hover:bg-zinc-700'
              }`}
            >
              {isSavingToCloud ? <Loader2 className="w-4 h-4 animate-spin" /> : savedToCloud ? <CheckCircle2 className="w-4 h-4" /> : <Cloud className="w-4 h-4" />}
              {savedToCloud ? 'Nube' : 'Nube'}
            </Button>
            <Button
              onClick={() => setPlan(null)}
              variant="outline"
              className="p-2 rounded-xl border-white/10 text-zinc-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {!selectedProject && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3 text-amber-500">
          <AlertCircle className="w-5 h-5" />
          <p className="text-xs font-bold uppercase tracking-widest">Selecciona un proyecto para generar su plan de emergencia.</p>
        </div>
      )}

      {plan && (
        <div className="mt-6 p-8 bg-black/40 rounded-[32px] border border-white/5 max-h-[500px] overflow-y-auto custom-scrollbar">
          <div className="markdown-body prose prose-invert max-w-none">
            <ReactMarkdown>
              {plan}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </section>
  );
}

function AlertCircle(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

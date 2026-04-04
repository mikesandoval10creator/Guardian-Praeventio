import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Wand2, Loader2, Save, Download, CheckCircle2, AlertTriangle, Brain } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { RiskNode, NodeType } from '../types';
import { where, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage, ref, uploadBytes, getDownloadURL } from '../services/firebase';
import { generateEmergencyPlanJSON } from '../services/geminiService';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export function EmergencyGenerator() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { addNode } = useRiskEngine();
  const [scenario, setScenario] = useState('');
  const [description, setDescription] = useState('');
  const [normative, setNormative] = useState('DS 594 / Ley 16.744');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState<any>(null);
  const [selectedRiskId, setSelectedRiskId] = useState<string>('');

  const [isDownloading, setIsDownloading] = useState(false);
  const pdfRef = React.useRef<HTMLDivElement>(null);
  const isOnline = useOnlineStatus();

  // Fetch approved risks from Risk Network
  const { data: nodes } = useFirestoreCollection<RiskNode>(
    'nodes',
    selectedProject ? [where('projectId', '==', selectedProject.id)] : []
  );

  const approvedRisks = nodes.filter(node => 
    node.type === NodeType.RISK && 
    node.metadata?.status !== 'pending_approval'
  );

  const handleRiskSelection = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const riskId = e.target.value;
    setSelectedRiskId(riskId);
    
    if (riskId) {
      const risk = approvedRisks.find(r => r.id === riskId);
      if (risk) {
        setScenario(`Emergencia: ${risk.title}`);
        setDescription(`Plan de respuesta ante la materialización del riesgo: ${risk.description}`);
        setNormative(risk.metadata?.normativa || 'DS 594 / Ley 16.744');
      }
    } else {
      setScenario('');
      setDescription('');
      setNormative('DS 594 / Ley 16.744');
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scenario || !description || !isOnline) return;

    setIsGenerating(true);
    try {
      const data = await generateEmergencyPlanJSON(scenario, description, normative, selectedProject?.industry);
      if (data) {
        setGeneratedPlan(data);
      }
    } catch (error) {
      console.error('Error generating Emergency Plan:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedPlan || !selectedProject || !user || !pdfRef.current) return;
    
    setIsSaving(true);
    try {
      // 1. Generate PDF Blob
      const canvas = await html2canvas(pdfRef.current, {
        scale: 2,
        useCORS: true,
        logging: false
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      const pdfBlob = pdf.output('blob');

      // 2. Upload to Storage
      const timestamp = new Date().getTime();
      const fileName = `PE_${scenario.replace(/\s+/g, '_')}_${timestamp}.pdf`;
      const storageRef = ref(storage, `projects/${selectedProject.id}/documents/${fileName}`);
      await uploadBytes(storageRef, pdfBlob);
      const downloadUrl = await getDownloadURL(storageRef);

      // 3. Save document to Firestore
      const docRef = await addDoc(collection(db, `projects/${selectedProject.id}/documents`), {
        name: `Plan de Emergencia: ${scenario}`,
        category: 'Plan de Emergencia',
        status: 'Vigente',
        uploadDate: new Date().toISOString(),
        uploadedBy: user.displayName || user.email || 'Usuario',
        projectId: selectedProject.id,
        content: generatedPlan, // Storing the structured JSON
        url: downloadUrl, // Storing the PDF URL
        isGenerated: true,
        createdAt: serverTimestamp()
      });

      // 4. Add to Risk Network
      await addNode({
        type: NodeType.DOCUMENT,
        title: `Plan de Emergencia: ${scenario}`,
        description: generatedPlan.objetivo,
        tags: ['Emergencia', 'Plan', normative.split(' ')[0]],
        projectId: selectedProject.id,
        connections: selectedRiskId ? [selectedRiskId] : [], // Link to the risk if selected
        metadata: {
          documentId: docRef.id,
          category: 'Plan de Emergencia',
          status: 'Vigente',
          isGenerated: true,
          pdfUrl: downloadUrl
        }
      });

      // 5. Add to Emergency Protocols
      await addDoc(collection(db, `projects/${selectedProject.id}/emergency_protocols`), {
        title: `Plan de Emergencia: ${scenario}`,
        category: 'Generado por IA',
        lastReview: new Date().toISOString().split('T')[0],
        status: 'active',
        documentId: docRef.id,
        projectId: selectedProject.id,
        createdAt: serverTimestamp()
      });

      alert('Plan de Emergencia guardado exitosamente en Documentos, Protocolos y Red Neuronal');
    } catch (error) {
      console.error('Error saving Emergency Plan:', error);
      alert('Error al guardar el Plan de Emergencia');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!pdfRef.current || !generatedPlan) return;
    
    setIsDownloading(true);
    try {
      const canvas = await html2canvas(pdfRef.current, {
        scale: 2,
        useCORS: true,
        logging: false
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      
      pdf.save(`PE_${scenario.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      alert('Error al descargar el PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Generador de Planes de Emergencia</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Protocolos de Respuesta Asistidos por IA
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Form */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-tight mb-4 sm:mb-6 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500" />
              Datos del Escenario
            </h2>
            
            <form onSubmit={handleGenerate} className="space-y-4">
              {approvedRisks.length > 0 && (
                <div>
                  <label className="block text-[10px] font-black text-rose-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Brain className="w-3 h-3" />
                    Importar desde Red Neuronal
                  </label>
                  <select
                    value={selectedRiskId}
                    onChange={handleRiskSelection}
                    className="w-full bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-sm text-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
                  >
                    <option value="">-- Seleccionar Riesgo Aprobado --</option>
                    {approvedRisks.map(risk => (
                      <option key={risk.id} value={risk.id} className="bg-zinc-900 text-white">
                        {risk.title} ({risk.metadata?.criticidad || 'Media'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  Escenario de Emergencia
                </label>
                <input
                  type="text"
                  required
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
                  placeholder="Ej: Incendio en Bodega de Residuos"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  Descripción Detallada
                </label>
                <textarea
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all resize-none h-32"
                  placeholder="Describe el contexto, posibles causas y áreas afectadas..."
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  Normativa Aplicable
                </label>
                <input
                  type="text"
                  value={normative}
                  onChange={(e) => setNormative(e.target.value)}
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={isGenerating || !scenario || !description || !isOnline}
                className={`w-full px-6 py-4 rounded-xl font-black uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2 mt-4 ${
                  !isOnline ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : isGenerating ? 'bg-rose-500/50 text-white cursor-not-allowed' : 'bg-rose-500 hover:bg-rose-600 text-white'
                }`}
              >
                {!isOnline ? (
                  <>
                    <WifiOff className="w-4 h-4" />
                    Requiere Conexión
                  </>
                ) : isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generando Plan...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    Generar con IA
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Preview */}
        <div className="lg:col-span-2">
          {generatedPlan ? (
            <motion.div
              ref={pdfRef}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 text-zinc-900 shadow-2xl"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 sm:gap-0 mb-6 sm:mb-8 border-b border-zinc-200 pb-4 sm:pb-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tighter text-zinc-900 leading-tight">Plan de Emergencia</h2>
                  <p className="text-sm sm:text-base text-rose-600 font-bold mt-1">{scenario}</p>
                </div>
                <div className="flex gap-2 self-end sm:self-auto" data-html2canvas-ignore="true">
                  <button 
                    onClick={handleSave}
                    disabled={isSaving || !isOnline}
                    className="p-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-600 transition-colors disabled:opacity-50"
                    title="Guardar en Drive y Risk Network"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <Save className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>
                  <button 
                    onClick={handleDownloadPDF}
                    disabled={isDownloading || !isOnline}
                    className="p-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-600 transition-colors disabled:opacity-50"
                    title="Descargar PDF"
                  >
                    {isDownloading ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <Download className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-6 sm:space-y-8">
                <section>
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">1. Objetivo</h3>
                  <p className="text-sm sm:text-base text-zinc-700 leading-relaxed">{generatedPlan.objetivo}</p>
                </section>

                <section>
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">2. Alcance</h3>
                  <p className="text-sm sm:text-base text-zinc-700 leading-relaxed">{generatedPlan.alcance}</p>
                </section>

                {generatedPlan.marcoLegal && generatedPlan.marcoLegal.length > 0 && (
                  <section>
                    <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">3. Marco Legal y Normativo</h3>
                    <ul className="space-y-2">
                      {generatedPlan.marcoLegal.map((ley: string, i: number) => (
                        <li key={i} className="flex gap-2 sm:gap-3 text-sm sm:text-base text-zinc-700">
                          <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{ley}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {generatedPlan.evaluacionMatematica && (
                  <section>
                    <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">4. Evaluación Matemática del Riesgo</h3>
                    <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 text-sm sm:text-base text-zinc-700 leading-relaxed prose prose-zinc max-w-none prose-p:my-2 prose-headings:mb-3 prose-headings:mt-4">
                      <ReactMarkdown 
                        remarkPlugins={[remarkMath]} 
                        rehypePlugins={[rehypeKatex]}
                      >
                        {generatedPlan.evaluacionMatematica}
                      </ReactMarkdown>
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">5. Cadena de Mando y Comunicaciones</h3>
                  <ul className="space-y-2">
                    {generatedPlan.cadenaMando.map((item: string, i: number) => (
                      <li key={i} className="flex gap-2 sm:gap-3 text-sm sm:text-base text-zinc-700">
                        <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">6. Acciones Inmediatas</h3>
                  <ul className="space-y-2">
                    {generatedPlan.accionesInmediatas.map((item: string, i: number) => (
                      <li key={i} className="flex gap-2 sm:gap-3 text-sm sm:text-base text-zinc-700">
                        <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">7. Procedimiento de Evacuación</h3>
                  <ul className="space-y-2">
                    {generatedPlan.evacuacion.map((item: string, i: number) => (
                      <li key={i} className="flex gap-2 sm:gap-3 text-sm sm:text-base text-zinc-700">
                        <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-zinc-100 text-zinc-500 flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0 mt-0.5">
                          {i + 1}
                        </div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">8. Equipos de Emergencia Requeridos</h3>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {generatedPlan.equipos.map((equipo: string, i: number) => (
                      <span key={i} className="bg-rose-50 text-rose-700 px-2 sm:px-3 py-1 rounded-md sm:rounded-lg text-xs sm:text-sm font-medium border border-rose-100">
                        {equipo}
                      </span>
                    ))}
                  </div>
                </section>
              </div>
            </motion.div>
          ) : (
            <div className="h-full min-h-[400px] border-2 border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center text-zinc-500 p-8 text-center">
              <FileText className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg font-medium text-white mb-2">Vista Previa del Plan</p>
              <p className="text-sm max-w-md">
                Completa los datos del escenario o selecciona un riesgo de la Red Neuronal y haz clic en "Generar con IA" para crear un Plan de Emergencia detallado.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

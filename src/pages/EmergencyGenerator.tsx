import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { FileText, Wand2, Loader2, Save, Download, CheckCircle2, AlertTriangle, Brain } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { RiskNode, NodeType } from '../types';
import { where, collection, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { db, storage, ref, uploadBytes, getDownloadURL } from '../services/firebase';
import { generateEmergencyPlanJSON } from '../services/geminiService';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { logger } from '../utils/logger';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';
import { Tooltip } from '../components/shared/Tooltip';

export function EmergencyGenerator() {
  const { t } = useTranslation();
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
  const { toasts, show: showToast, dismiss } = useToast();

  // Tab state
  const [activeTab, setActiveTab] = useState<'resumen' | 'brigada' | 'procedimientos' | 'evacuacion' | 'normativas'>('resumen');

  // Brigada state
  const [brigadaAssignments, setBrigadaAssignments] = useState<Record<string, string>>({});
  const [brigadaInputs, setBrigadaInputs] = useState<Record<string, string>>({});
  const [brigadaSaving, setBrigadaSaving] = useState<Record<string, boolean>>({});
  const [activationStatus, setActivationStatus] = useState<string>('');

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
      logger.error('Error generating Emergency Plan:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedPlan || !selectedProject || !user || !pdfRef.current) return;
    
    setIsSaving(true);
    try {
      // 1. Generate PDF Blob
      // Dynamic import: jspdf + html2canvas are heavy and only needed on export.
      const { jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;
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

      showToast('Plan de Emergencia guardado exitosamente en Documentos, Protocolos y Red Neuronal', 'success');
    } catch (error) {
      logger.error('Error saving Emergency Plan:', error);
      showToast('Error al guardar el Plan de Emergencia', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!pdfRef.current || !generatedPlan) return;
    
    setIsDownloading(true);
    try {
      // Dynamic import: jspdf + html2canvas are heavy and only needed on export.
      const { jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;
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
      logger.error('Error downloading PDF:', error);
      showToast('Error al descargar el PDF', 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  const brigadeRoles = [
    { key: 'jefe', name: 'Jefe de Emergencia', description: 'Coordina la respuesta total ante la emergencia y autoriza la evacuación del recinto.' },
    { key: 'incendio', name: 'Brigada Contra Incendio', description: 'Opera extintores y equipos de supresión para evitar la propagación del fuego.' },
    { key: 'evacuacion', name: 'Brigada de Evacuación', description: 'Guía al personal hacia las zonas seguras siguiendo las rutas establecidas.' },
    { key: 'auxilios', name: 'Primeros Auxilios', description: 'Brinda atención inicial a lesionados hasta la llegada de servicios de emergencia.' },
  ];

  const handleBrigadaSave = async (roleKey: string) => {
    if (!selectedProject) return;
    const responsable = brigadaInputs[roleKey] ?? brigadaAssignments[roleKey] ?? '';
    setBrigadaSaving(prev => ({ ...prev, [roleKey]: true }));
    try {
      const brigadeRef = doc(db, 'projects', selectedProject.id, 'brigade_config', 'assignments');
      await updateDoc(brigadeRef, { [roleKey]: responsable }).catch(async () => {
        // Document may not exist yet — use setDoc-equivalent via addDoc on a named path isn't possible,
        // so we import setDoc dynamically only if updateDoc fails.
        const { setDoc } = await import('firebase/firestore');
        await setDoc(brigadeRef, { [roleKey]: responsable }, { merge: true });
      });
      setBrigadaAssignments(prev => ({ ...prev, [roleKey]: responsable }));
    } catch (error) {
      logger.error('Error saving brigade assignment:', error);
    } finally {
      setBrigadaSaving(prev => ({ ...prev, [roleKey]: false }));
    }
  };

  const handleActivateEmergency = async () => {
    if (!selectedProject || !user) return;
    try {
      await addDoc(collection(db, 'projects', selectedProject.id, 'emergency_events'), {
        type: 'manual_activation',
        triggeredBy: user.uid,
        timestamp: serverTimestamp(),
        status: 'active',
        brigadeNotified: true,
      });
      fetch('/api/emergency/notify-brigada', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject.id, type: 'manual_activation' }),
      }).catch(() => {});
      setActivationStatus('Brigada notificada');
      setTimeout(() => setActivationStatus(''), 4000);
    } catch (error) {
      logger.error('Error activating emergency:', error);
      setActivationStatus('Error al activar emergencia');
      setTimeout(() => setActivationStatus(''), 4000);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">{t('emergencyGenerator.title', 'Generador de Planes de Emergencia')}</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('emergencyGenerator.subtitle', 'Protocolos de Respuesta Asistidos por IA')}
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-zinc-900/50 border border-white/10 rounded-2xl p-1 overflow-x-auto">
        {(
          [
            { id: 'resumen', label: 'Resumen' },
            { id: 'brigada', label: 'Brigada' },
            { id: 'procedimientos', label: 'Procedimientos' },
            { id: 'evacuacion', label: 'Evacuación' },
            { id: 'normativas', label: 'Normativas' },
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap"
            style={
              activeTab === tab.id
                ? { backgroundColor: '#4db6ac', color: '#fff' }
                : { backgroundColor: 'transparent', color: '#71717a' }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Resumen Tab ── */}
      {activeTab === 'resumen' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Form */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-tight mb-4 sm:mb-6 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500" />
              {t('emergencyGenerator.scenarioData', 'Datos del Escenario')}
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
                  placeholder={t('emergencyGenerator.scenarioPlaceholder', 'Ej: Incendio en Bodega de Residuos')}
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  {t('emergencyGenerator.descLabel', 'Descripción Detallada')}
                </label>
                <textarea
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all resize-none h-32"
                  placeholder={t('emergencyGenerator.descPlaceholder', 'Describe el contexto, posibles causas y áreas afectadas...')}
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  {t('emergencyGenerator.normativeLabel', 'Normativa Aplicable')}
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
                  {/* Sprint 20 19th-wave (Bucket C): native title= → Tooltip primitive (WCAG 2.1 AA 1.4.13). aria-label provides SR semantic. */}
                  <Tooltip content="Guardar en Drive y Risk Network">
                    <button
                      onClick={handleSave}
                      disabled={isSaving || !isOnline}
                      aria-label="Guardar plan en Drive y Risk Network"
                      className="p-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-600 transition-colors disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />}
                    </button>
                  </Tooltip>
                  <Tooltip content="Descargar PDF">
                    <button
                      onClick={handleDownloadPDF}
                      disabled={isDownloading || !isOnline}
                      aria-label="Descargar plan como PDF"
                      className="p-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-600 transition-colors disabled:opacity-50"
                    >
                      {isDownloading ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />}
                    </button>
                  </Tooltip>
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
      )} {/* end Resumen tab */}

      {/* ── Brigada Tab ── */}
      {activeTab === 'brigada' && (
        <div className="space-y-6">
          {/* Role cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {brigadeRoles.map(role => (
              <div
                key={role.key}
                className="bg-zinc-900/50 border border-white/10 rounded-2xl p-5 space-y-4"
              >
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tight">{role.name}</h3>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{role.description}</p>
                </div>
                {brigadaAssignments[role.key] && (
                  <p className="text-xs text-[#4db6ac] font-semibold">
                    Asignado: {brigadaAssignments[role.key]}
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Asignar responsable"
                    value={brigadaInputs[role.key] ?? brigadaAssignments[role.key] ?? ''}
                    onChange={e =>
                      setBrigadaInputs(prev => ({ ...prev, [role.key]: e.target.value }))
                    }
                    className="flex-1 bg-zinc-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 transition-all"
                    style={{ '--tw-ring-color': '#4db6ac' } as React.CSSProperties}
                  />
                  <button
                    onClick={() => handleBrigadaSave(role.key)}
                    disabled={brigadaSaving[role.key]}
                    className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-white transition-all disabled:opacity-50"
                    style={{ backgroundColor: '#4db6ac' }}
                  >
                    {brigadaSaving[role.key] ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Activate Emergency */}
          <div className="flex flex-col items-start gap-3">
            <button
              onClick={handleActivateEmergency}
              disabled={!selectedProject || !user}
              className="px-6 py-4 rounded-xl font-black uppercase tracking-widest text-xs bg-rose-600 hover:bg-rose-700 text-white transition-all disabled:opacity-50 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4" />
              Activar Emergencia
            </button>
            {activationStatus && (
              <p className="text-sm font-semibold text-[#4db6ac]">{activationStatus}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Procedimientos Tab ── */}
      {activeTab === 'procedimientos' && (
        <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6 space-y-6">
          <h2 className="text-base font-black text-white uppercase tracking-tight">Procedimientos de Emergencia</h2>
          <ol className="space-y-5">
            {[
              { step: 1, title: 'Detección y Alerta', body: 'Identificar la emergencia (incendio, accidente, derrame u otro evento). Activar la alarma sonora o visual correspondiente e informar de inmediato al Jefe de Emergencia.' },
              { step: 2, title: 'Notificación y Activación de Brigadas', body: 'El Jefe de Emergencia evalúa la magnitud del evento y activa las brigadas necesarias: Contra Incendio, Evacuación y/o Primeros Auxilios. Se notifica a los servicios externos (bomberos, SAMU) si se requiere.' },
              { step: 3, title: 'Control y Contención', body: 'Cada brigada ejecuta su protocolo específico. Se despeja el área afectada, se cortan suministros de riesgo (gas, electricidad) y se aplican medidas de contención para evitar la propagación del daño.' },
              { step: 4, title: 'Evaluación y Retorno', body: 'Verificar que todo el personal esté en el punto de encuentro y contabilizar su presencia. Una vez que la autoridad competente declare el área segura, el Jefe de Emergencia autoriza el retorno ordenado a las instalaciones.' },
            ].map(item => (
              <li key={item.step} className="flex gap-4">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-black shrink-0"
                  style={{ backgroundColor: '#4db6ac' }}
                >
                  {item.step}
                </span>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tight mb-1">{item.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ── Evacuación Tab ── */}
      {activeTab === 'evacuacion' && (
        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-base font-black text-white uppercase tracking-tight">Rutas de Evacuación</h2>
            <ul className="space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3"><span className="text-[#4db6ac] font-bold shrink-0">→</span>Ruta A: Pasillo principal → Escalera de emergencia norte → Salida calle lateral</li>
              <li className="flex gap-3"><span className="text-[#4db6ac] font-bold shrink-0">→</span>Ruta B: Pasillo secundario → Escalera de emergencia sur → Salida patio trasero</li>
              <li className="flex gap-3"><span className="text-[#4db6ac] font-bold shrink-0">→</span>Ruta C (planta baja): Corredor central → Salida principal → Calle frontal</li>
              <li className="flex gap-3"><span className="text-[#4db6ac] font-bold shrink-0">→</span>Ruta D (pisos superiores): Escalera de emergencia este → Salida lateral este</li>
            </ul>
          </div>
          <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-base font-black text-white uppercase tracking-tight">Puntos de Encuentro</h2>
            <ul className="space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3"><span className="text-[#4db6ac] font-bold shrink-0">●</span>PE-1: Estacionamiento exterior norte — capacidad 80 personas</li>
              <li className="flex gap-3"><span className="text-[#4db6ac] font-bold shrink-0">●</span>PE-2: Plaza pública frente al edificio — capacidad 150 personas</li>
              <li className="flex gap-3"><span className="text-[#4db6ac] font-bold shrink-0">●</span>PE-3: Cancha deportiva sector sur — capacidad 200 personas (emergencias mayores)</li>
            </ul>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* ── Normativas Tab ── */}
      {activeTab === 'normativas' && (
        <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6 space-y-5">
          <h2 className="text-base font-black text-white uppercase tracking-tight">Marco Normativo Aplicable</h2>
          {[
            { code: 'Ley 16.744', title: 'Seguro Social contra Riesgos de Accidentes del Trabajo y Enfermedades Profesionales', desc: 'Establece las obligaciones del empleador en materia de prevención de riesgos, cobertura del seguro y las prestaciones ante accidentes laborales y enfermedades profesionales.' },
            { code: 'DS 594', title: 'Reglamento sobre Condiciones Sanitarias y Ambientales en los Lugares de Trabajo', desc: 'Regula las condiciones mínimas de higiene, seguridad, ventilación, temperatura y manejo de sustancias peligrosas en los centros de trabajo.' },
            { code: 'DS 44/2024', title: 'Reglamento sobre Prevención de Riesgos Profesionales', desc: 'Define las obligaciones del empleador de informar a los trabajadores sobre los riesgos de su actividad (Derecho a Saber) y las medidas de control establecidas.' },
            { code: 'DS 101', title: 'Reglamento para la Aplicación de la Ley 16.744', desc: 'Establece los procedimientos para la calificación y declaración de accidentes del trabajo y enfermedades profesionales, así como los organismos administradores.' },
          ].map(norm => (
            <div key={norm.code} className="border border-white/10 rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-3">
                <span
                  className="px-2 py-0.5 rounded-md text-xs font-black text-white"
                  style={{ backgroundColor: '#4db6ac' }}
                >
                  {norm.code}
                </span>
                <h3 className="text-sm font-bold text-white">{norm.title}</h3>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed pl-0">{norm.desc}</p>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

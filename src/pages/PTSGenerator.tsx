import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileText, Wand2, Loader2, Save, Download, CheckCircle2, AlertTriangle, Brain, ShieldAlert } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { ZettelkastenNode, NodeType } from '../types';
import { where, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage, ref, uploadBytes, getDownloadURL } from '../services/firebase';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useFirebase } from '../contexts/FirebaseContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { generatePTS } from '../services/geminiService';
import { SAFETY_GLOSSARY } from '../constants/glossary';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export function PTSGenerator() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { addNode } = useZettelkasten();
  const { environment } = useUniversalKnowledge();
  const [documentType, setDocumentType] = useState('PTS');
  const [taskName, setTaskName] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [normative, setNormative] = useState('DS 594 (Condiciones Sanitarias y Ambientales)');
  const [riskLevel, setRiskLevel] = useState('Media');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [generatedPTS, setGeneratedPTS] = useState<any>(null);
  const [selectedRiskId, setSelectedRiskId] = useState<string>('');
  const pdfRef = useRef<HTMLDivElement>(null);

  // Fetch approved risks from Zettelkasten
  const { data: nodes } = useFirestoreCollection<ZettelkastenNode>(
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
        setTaskName(`PTS - ${risk.title}`);
        setTaskDescription(risk.description);
        setRiskLevel(risk.metadata?.criticidad || 'Media');
        setNormative(risk.metadata?.normativa || 'DS 594');
      }
    } else {
      setTaskName('');
      setTaskDescription('');
      setRiskLevel('Media');
      setNormative('DS 594');
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName || !taskDescription) return;

    setIsGenerating(true);
    try {
      const envContext = environment ? `Clima actual: ${environment.weather?.temp}°C, Viento: ${environment.weather?.windSpeed}km/h. Sismos recientes: ${environment.seismic?.magnitude || 'Ninguno'}` : 'Sin datos ambientales en tiempo real.';
      
      // Extract relevant Zettelkasten context (e.g., related incidents or risks)
      const zkContext = nodes
        .filter(n => n.type === NodeType.INCIDENT || n.type === NodeType.RISK)
        .slice(0, 5) // Limit to top 5 for context size
        .map(n => `${n.title}: ${n.description}`)
        .join('\n');

      const result = await generatePTS(taskName, taskDescription, riskLevel, normative, SAFETY_GLOSSARY, envContext, zkContext, documentType);
      setGeneratedPTS(result);
    } catch (error) {
      console.error('Error generating PTS:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedPTS || !selectedProject || !user || !pdfRef.current) return;
    
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
      const fileName = `${documentType === 'PTS' ? 'PTS' : 'PE'}_${taskName.replace(/\s+/g, '_')}_${timestamp}.pdf`;
      const storageRef = ref(storage, `projects/${selectedProject.id}/documents/${fileName}`);
      await uploadBytes(storageRef, pdfBlob);
      const downloadUrl = await getDownloadURL(storageRef);

      // 3. Save document to Firestore
      const docRef = await addDoc(collection(db, `projects/${selectedProject.id}/documents`), {
        name: taskName,
        category: documentType === 'PTS' ? 'Procedimiento' : 'Plan de Emergencia',
        status: 'Vigente',
        uploadDate: new Date().toISOString(),
        uploadedBy: user.displayName || user.email || 'Usuario',
        projectId: selectedProject.id,
        content: generatedPTS, // Storing the structured JSON
        url: downloadUrl, // Storing the PDF URL
        isGenerated: true,
        createdAt: serverTimestamp()
      });

      // 4. Add to Zettelkasten
      await addNode({
        type: NodeType.DOCUMENT,
        title: taskName,
        description: generatedPTS.objetivo,
        tags: [documentType, documentType === 'PTS' ? 'Procedimiento' : 'Emergencia', riskLevel, normative.split(' ')[0]],
        projectId: selectedProject.id,
        connections: selectedRiskId ? [selectedRiskId] : [], // Link to the risk if selected
        metadata: {
          documentId: docRef.id,
          category: documentType === 'PTS' ? 'Procedimiento' : 'Plan de Emergencia',
          status: 'Vigente',
          isGenerated: true,
          pdfUrl: downloadUrl
        }
      });

      alert(`${documentType} guardado exitosamente en Documentos y Red Neuronal`);
    } catch (error) {
      console.error(`Error saving ${documentType}:`, error);
      alert(`Error al guardar el ${documentType}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!pdfRef.current || !generatedPTS) return;
    
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
      
      pdf.save(`${documentType === 'PTS' ? 'PTS' : 'PE'}_${taskName.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Hubo un error al generar el PDF.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Generador de Documentos</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            PTS y Planes de Emergencia Asistidos por IA
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h2 className="text-lg font-black text-white uppercase tracking-tight mb-6 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-500" />
              Datos de la Tarea
            </h2>
            
            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  Tipo de Documento
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDocumentType('PTS')}
                    className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                      documentType === 'PTS' 
                        ? 'bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]' 
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    PTS
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocumentType('Plan de Emergencia')}
                    className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                      documentType === 'Plan de Emergencia' 
                        ? 'bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.3)]' 
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    Plan Emergencia
                  </button>
                </div>
              </div>

              {approvedRisks.length > 0 && (
                <div>
                  <label className="block text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Brain className="w-3 h-3" />
                    Importar desde Red Neuronal
                  </label>
                  <select
                    value={selectedRiskId}
                    onChange={handleRiskSelection}
                    className="w-full bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-sm text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
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
                  {documentType === 'PTS' ? 'Nombre de la Tarea' : 'Nombre del Plan / Escenario'}
                </label>
                <input
                  type="text"
                  required
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  placeholder={documentType === 'PTS' ? "Ej: Trabajo en Altura - Mantención de Techo" : "Ej: Plan de Evacuación por Sismo"}
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  Descripción Detallada
                </label>
                <textarea
                  required
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none h-32"
                  placeholder="Describe los pasos generales, herramientas a usar y el entorno de trabajo..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                    Nivel de Riesgo
                  </label>
                  <select
                    value={riskLevel}
                    onChange={(e) => setRiskLevel(e.target.value)}
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value="Bajo">Bajo</option>
                    <option value="Medio">Medio</option>
                    <option value="Alto">Alto</option>
                    <option value="Crítico">Crítico</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                    Normativa Principal
                  </label>
                  <select
                    value={normative}
                    onChange={(e) => setNormative(e.target.value)}
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value="DS 594 (Condiciones Sanitarias y Ambientales)">DS 594</option>
                    <option value="Ley 16.744 (Accidentes del Trabajo)">Ley 16.744</option>
                    <option value="DS 40 (Prevención de Riesgos)">DS 40</option>
                    <option value="ISO 45001 (Sistemas de Gestión SST)">ISO 45001</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isGenerating || !taskName || !taskDescription}
                className="w-full bg-emerald-500 text-white font-black uppercase tracking-widest py-4 rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generando {documentType}...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5" />
                    Generar con IA
                  </>
                )}
              </button>
            </form>
          </div>
          
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-sm font-black text-emerald-500 uppercase tracking-tight mb-2">Nota Importante</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  El {documentType} generado por IA es un borrador inicial. Debe ser revisado, validado y firmado por un Prevencionista de Riesgos o profesional competente antes de su implementación en terreno.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="lg:col-span-2">
          {generatedPTS ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-8 md:p-12 text-black shadow-2xl relative"
              ref={pdfRef}
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500 rounded-t-3xl" data-html2canvas-ignore="true" />
              
              <div className="flex justify-between items-start mb-8 border-b border-zinc-200 pb-8" data-html2canvas-ignore="true">
                <div>
                  <h2 className="text-3xl font-black uppercase tracking-tighter mb-2">{documentType === 'PTS' ? 'Procedimiento de Trabajo Seguro' : 'Plan de Emergencia'}</h2>
                  <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">{taskName}</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-500 hover:bg-zinc-200 hover:text-black transition-colors disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  </button>
                  <button 
                    onClick={handleDownloadPDF}
                    disabled={isDownloading}
                    className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    {isDownloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Formal Document Header for PDF */}
              <table className="w-full border-collapse border border-zinc-800 mb-8 text-xs">
                <tbody>
                  <tr>
                    <td rowSpan={3} className="border border-zinc-800 p-4 text-center w-1/4 font-black text-2xl tracking-tighter text-emerald-600">
                      <div className="flex flex-col items-center justify-center">
                        <ShieldAlert className="w-8 h-8 mb-1" />
                        PRAEVENTIO
                      </div>
                    </td>
                    <td rowSpan={3} className="border border-zinc-800 p-4 text-center w-2/4 font-black text-xl uppercase tracking-widest bg-zinc-50">
                      {documentType === 'PTS' ? 'Procedimiento de Trabajo Seguro' : 'Plan de Emergencia'}
                    </td>
                    <td className="border border-zinc-800 p-2 w-1/4 bg-zinc-50"><strong>Código:</strong> {documentType === 'PTS' ? 'PTS' : 'PE'}-{selectedRiskId ? selectedRiskId.substring(0, 4).toUpperCase() : '001'}</td>
                  </tr>
                  <tr>
                    <td className="border border-zinc-800 p-2 bg-zinc-50"><strong>Versión:</strong> 1.0</td>
                  </tr>
                  <tr>
                    <td className="border border-zinc-800 p-2 bg-zinc-50"><strong>Fecha:</strong> {new Date().toLocaleDateString('es-CL')}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="border border-zinc-800 p-3 bg-emerald-50 text-emerald-900 border-t-2 border-t-emerald-500">
                      <div className="flex justify-between items-center">
                        <span><strong>Título:</strong> {taskName}</span>
                        <span><strong>Proyecto:</strong> {selectedProject?.name || 'General'}</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="space-y-8">
                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">1</div>
                    Objetivo
                  </h3>
                  <p className="text-zinc-700 leading-relaxed pl-8">{generatedPTS.objetivo}</p>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">2</div>
                    Alcance
                  </h3>
                  <p className="text-zinc-700 leading-relaxed pl-8">{generatedPTS.alcance}</p>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">3</div>
                    Responsabilidades
                  </h3>
                  <ul className="list-disc list-inside text-zinc-700 space-y-2 pl-8">
                    {generatedPTS.responsabilidades.map((resp: string, i: number) => (
                      <li key={i}>{resp}</li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">4</div>
                    {documentType === 'PTS' ? 'Equipos de Protección Individual (EPI)' : 'Equipos de Emergencia y Rescate'}
                  </h3>
                  <div className="flex flex-wrap gap-2 pl-8">
                    {generatedPTS.epp.map((item: string, i: number) => (
                      <span key={i} className="bg-zinc-100 text-zinc-800 px-3 py-1 rounded-lg text-sm font-medium border border-zinc-200">
                        {item}
                      </span>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">5</div>
                    {documentType === 'PTS' ? 'Riesgos y Medidas Correctoras' : 'Escenarios de Riesgo y Medidas Preventivas'}
                  </h3>
                  <div className="space-y-4 pl-8">
                    {generatedPTS.riesgos.map((item: any, i: number) => (
                      <div key={i} className="bg-zinc-50 rounded-xl p-4 border border-zinc-200">
                        <p className="font-bold text-red-600 mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Riesgo: {item.riesgo}
                        </p>
                        <p className="text-emerald-700 font-medium flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                          Control: {item.control}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">6</div>
                    {documentType === 'PTS' ? 'Procedimiento Paso a Paso' : 'Procedimiento de Evacuación y Respuesta'}
                  </h3>
                  <div className="space-y-4 pl-8">
                    {generatedPTS.pasos.map((paso: string, i: number) => (
                      <div key={i} className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 font-bold shrink-0">
                          {i + 1}
                        </div>
                        <p className="text-zinc-700 pt-1">{paso}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {generatedPTS.emergencias && generatedPTS.emergencias.length > 0 && (
                  <section>
                    <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded bg-red-100 flex items-center justify-center text-red-600 text-xs">7</div>
                      {documentType === 'PTS' ? 'Respuesta a Emergencias' : 'Comunicaciones y Contactos de Emergencia'}
                    </h3>
                    <div className="space-y-4 pl-8">
                      {generatedPTS.emergencias.map((paso: string, i: number) => (
                        <div key={i} className="flex gap-4">
                          <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                            <ShieldAlert className="w-4 h-4" />
                          </div>
                          <p className="text-zinc-700 pt-1">{paso}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* Formal Signature Block for PDF */}
              <div className="mt-12 break-inside-avoid">
                <table className="w-full border-collapse border border-zinc-800 text-xs text-center">
                  <thead>
                    <tr className="bg-zinc-100">
                      <th className="border border-zinc-800 p-3 w-1/3 uppercase tracking-widest text-[10px]">Elaborado por</th>
                      <th className="border border-zinc-800 p-3 w-1/3 uppercase tracking-widest text-[10px]">Revisado por</th>
                      <th className="border border-zinc-800 p-3 w-1/3 uppercase tracking-widest text-[10px]">Aprobado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-zinc-800 p-2 h-24 align-bottom text-zinc-400">Firma / Fecha</td>
                      <td className="border border-zinc-800 p-2 h-24 align-bottom text-zinc-400">Firma / Fecha</td>
                      <td className="border border-zinc-800 p-2 h-24 align-bottom text-zinc-400">Firma / Fecha</td>
                    </tr>
                    <tr>
                      <td className="border border-zinc-800 p-2 font-bold">Prevención de Riesgos</td>
                      <td className="border border-zinc-800 p-2 font-bold">Administrador de Contrato</td>
                      <td className="border border-zinc-800 p-2 font-bold">Gerencia</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Toma de Conocimiento Block for PDF */}
              <div className="mt-12 break-inside-avoid">
                <h3 className="text-lg font-black uppercase tracking-tight mb-4 flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">8</div>
                  Toma de Conocimiento
                </h3>
                <p className="text-xs text-zinc-600 mb-4">
                  Los abajo firmantes declaran haber recibido instrucción, comprendido y aceptado el presente {documentType === 'PTS' ? 'Procedimiento de Trabajo Seguro' : 'Plan de Emergencia'}, comprometiéndose a cumplir todas las medidas preventivas indicadas.
                </p>
                <table className="w-full border-collapse border border-zinc-800 text-xs text-center">
                  <thead>
                    <tr className="bg-zinc-100">
                      <th className="border border-zinc-800 p-2 w-1/4 uppercase tracking-widest text-[10px]">Nombre Completo</th>
                      <th className="border border-zinc-800 p-2 w-1/4 uppercase tracking-widest text-[10px]">RUT</th>
                      <th className="border border-zinc-800 p-2 w-1/4 uppercase tracking-widest text-[10px]">Cargo</th>
                      <th className="border border-zinc-800 p-2 w-1/4 uppercase tracking-widest text-[10px]">Firma</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...Array(8)].map((_, i) => (
                      <tr key={i}>
                        <td className="border border-zinc-800 p-2 h-10"></td>
                        <td className="border border-zinc-800 p-2 h-10"></td>
                        <td className="border border-zinc-800 p-2 h-10"></td>
                        <td className="border border-zinc-800 p-2 h-10"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </motion.div>
          ) : (
            <div className="h-full min-h-[600px] bg-zinc-900/30 border border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center text-center p-8">
              <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center mb-6">
                <FileText className="w-10 h-10 text-zinc-600" />
              </div>
              <h3 className="text-2xl font-black text-white uppercase tracking-tight mb-2">Vista Previa del Documento</h3>
              <p className="text-zinc-500 max-w-md">
                Completa los datos de la tarea y haz clic en "Generar con IA" para crear un Procedimiento de Trabajo Seguro estructurado.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


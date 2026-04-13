import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { FileText, Wand2, Loader2, Save, Download, CheckCircle2, AlertTriangle, Brain, ShieldAlert, WifiOff, MapPin } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { RiskNode, NodeType } from '../types';
import { saveForSync } from '../utils/pwa-offline';
import { where, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage, ref, uploadBytes, getDownloadURL } from '../services/firebase';
import { logAuditAction } from '../services/auditService';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { generatePTS, generatePTSWithManufacturerData } from '../services/geminiService';
import { SAFETY_GLOSSARY } from '../constants/glossary';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export function PTSGenerator() {
  const [searchParams] = useSearchParams();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { addNode, addConnection, nodes } = useRiskEngine();
  const { environment } = useUniversalKnowledge();
  const { isPremium } = useSubscription();
  const [documentType, setDocumentType] = useState('PTS');
  const [taskName, setTaskName] = useState(searchParams.get('title') || '');
  const [taskDescription, setTaskDescription] = useState(searchParams.get('desc') || '');
  const [machineryDetails, setMachineryDetails] = useState('');
  const [normative, setNormative] = useState(searchParams.get('normative') || 'DS 594 (Condiciones Sanitarias y Ambientales)');
  const [riskLevel, setRiskLevel] = useState('Media');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [generatedPTS, setGeneratedPTS] = useState<any>(null);
  const [selectedRiskId, setSelectedRiskId] = useState<string>('');
  const [suspensionReason, setSuspensionReason] = useState<string>('');
  const [isSuspending, setIsSuspending] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [showSuccessQuote, setShowSuccessQuote] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);
  const isOnline = useOnlineStatus();

  // Check for dangerous weather conditions
  const dangerousWeather = React.useMemo(() => {
    if (!environment?.weather) return null;
    const { windSpeed, temp } = environment.weather;
    
    if (windSpeed > 40) return `Vientos peligrosos (${windSpeed} km/h). Riesgo crítico para trabajos en altura o izaje.`;
    if (temp > 35) return `Calor extremo (${temp}°C). Riesgo crítico de estrés térmico.`;
    if (temp < -5) return `Frío extremo (${temp}°C). Riesgo crítico de hipotermia o congelamiento.`;
    
    return null;
  }, [environment]);

  // Fetch approved risks from Risk Network
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

  const handleSuspendTask = async () => {
    if (!selectedProject || !dangerousWeather || !taskName) return;
    
    setIsSuspending(true);
    try {
      const suspensionNode: Omit<RiskNode, 'id' | 'createdAt' | 'updatedAt'> = {
        title: `Suspensión: ${taskName}`,
        description: `Tarea suspendida preventivamente. Motivo: ${dangerousWeather}. Descripción original: ${taskDescription}`,
        type: NodeType.FINDING,
        projectId: selectedProject.id,
        tags: ['Suspensión', 'Clima', 'Prevención'],
        connections: [],
        metadata: {
          status: 'approved',
          criticidad: 'Alta',
          weatherCondition: dangerousWeather,
          suspendedAt: new Date().toISOString(),
          suspendedBy: user?.displayName || user?.email || 'Sistema Guardián'
        }
      };
      
      await addNode(suspensionNode);
      
      await logAuditAction(
        'SUSPEND_TASK',
        'PTSGenerator',
        {
          taskName,
          reason: dangerousWeather,
          originalDescription: taskDescription
        },
        selectedProject.id
      );

      setSuspensionReason(dangerousWeather);
      setGeneratedPTS(null); // Clear any generated PTS
    } catch (error) {
      console.error('Error suspending task:', error);
    } finally {
      setIsSuspending(false);
    }
  };

  const handleGPSAutocomplete = () => {
    if (!navigator.geolocation) {
      alert('Geolocalización no soportada por el navegador.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          
          // Reverse geocoding using OpenStreetMap Nominatim (free, no API key needed for basic usage)
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          const data = await response.json();
          
          const locationName = data.address?.city || data.address?.town || data.address?.village || data.address?.county || 'Ubicación Desconocida';
          const weatherInfo = environment?.weather ? `Clima: ${environment.weather.temp}°C, Viento: ${environment.weather.windSpeed}km/h` : '';
          
          setTaskDescription(prev => {
            const prefix = `[Ubicación GPS: ${locationName} (Lat: ${latitude.toFixed(4)}, Lon: ${longitude.toFixed(4)})] ${weatherInfo}\n\n`;
            return prefix + prev;
          });
          
        } catch (error) {
          console.error('Error in reverse geocoding:', error);
          alert('No se pudo obtener el nombre de la ubicación, pero se registraron las coordenadas.');
          setTaskDescription(prev => `[Coordenadas GPS: Lat: ${position.coords.latitude.toFixed(4)}, Lon: ${position.coords.longitude.toFixed(4)}]\n\n` + prev);
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        console.error('Error getting location:', error);
        alert('Error al obtener la ubicación GPS.');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName || !taskDescription || !isOnline) return;

    setIsGenerating(true);
    try {
      const envContext = environment ? `Clima actual: ${environment.weather?.temp}°C, Viento: ${environment.weather?.windSpeed}km/h. Sismos recientes: ${environment.earthquakes && environment.earthquakes.length > 0 ? environment.earthquakes[0].Magnitud : 'Ninguno'}` : 'Sin datos ambientales en tiempo real.';
      
      // Extract relevant Risk Network context (e.g., related incidents or risks)
      const zkContext = nodes
        .filter(n => n.type === NodeType.INCIDENT || n.type === NodeType.RISK)
        .slice(0, 5) // Limit to top 5 for context size
        .map(n => `${n.title}: ${n.description}`)
        .join('\n');

      let result;
      if (machineryDetails.trim() !== '') {
        result = await generatePTSWithManufacturerData(taskName, taskDescription, machineryDetails, riskLevel, normative, SAFETY_GLOSSARY, envContext, zkContext, documentType);
      } else {
        result = await generatePTS(taskName, taskDescription, riskLevel, normative, SAFETY_GLOSSARY, envContext, zkContext, documentType);
      }
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
      const pdfFile = new File([pdfBlob], `${documentType === 'PTS' ? 'PTS' : 'PE'}_${taskName.replace(/\s+/g, '_')}.pdf`, { type: 'application/pdf' });

      const timestamp = new Date().getTime();
      const fileName = `${documentType === 'PTS' ? 'PTS' : 'PE'}_${taskName.replace(/\s+/g, '_')}_${timestamp}.pdf`;
      const storagePath = `projects/${selectedProject.id}/documents/${fileName}`;

      const documentData = {
        name: taskName,
        category: documentType === 'PTS' ? 'Procedimiento' : 'Plan de Emergencia',
        status: 'Vigente',
        uploadDate: new Date().toISOString(),
        uploadedBy: user.displayName || user.email || 'Usuario',
        projectId: selectedProject.id,
        content: generatedPTS, // Storing the structured JSON
        isGenerated: true,
        createdAt: new Date().toISOString() // Fallback for serverTimestamp
      };

      const nodeData = {
        type: NodeType.DOCUMENT,
        title: taskName,
        description: generatedPTS.objetivo,
        tags: [documentType, documentType === 'PTS' ? 'Procedimiento' : 'Emergencia', riskLevel, normative.split(' ')[0]],
        projectId: selectedProject.id,
        connections: selectedRiskId ? [selectedRiskId] : [], // Link to the risk if selected
        metadata: {
          category: documentType === 'PTS' ? 'Procedimiento' : 'Plan de Emergencia',
          status: 'Vigente',
          isGenerated: true
        }
      };

      if (!isOnline) {
        await saveForSync({
          type: 'upload',
          collection: `projects/${selectedProject.id}/documents`,
          data: {
            storagePath,
            documentData,
            createNode: true,
            nodeData
          },
          file: pdfFile
        });
        alert('Documento guardado para sincronización cuando haya conexión.');
      } else {
        // 2. Upload to Storage
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, pdfBlob);
        const downloadUrl = await getDownloadURL(storageRef);

        // 3. Save document to Firestore
        const docRef = await addDoc(collection(db, `projects/${selectedProject.id}/documents`), {
          ...documentData,
          url: downloadUrl,
          createdAt: serverTimestamp()
        });

        // 4. Add to Risk Network
        const newNode = await addNode({
          ...nodeData,
          metadata: {
            ...nodeData.metadata,
            documentId: docRef.id,
            pdfUrl: downloadUrl
          }
        });

        // Conexiones Semánticas Automáticas
        if (newNode) {
          await logAuditAction(
            'GENERATE_DOCUMENT',
            'PTSGenerator',
            {
              documentType,
              taskName,
              riskLevel,
              normative,
              documentId: docRef.id,
              nodeId: newNode.id
            },
            selectedProject.id
          );

          const textToAnalyze = JSON.stringify(generatedPTS).toLowerCase();
          const keywords = {
            'altura': ['arnés', 'linea de vida', 'caída', 'andamio'],
            'eléctrico': ['dieléctrico', 'bloqueo', 'loto', 'energía'],
            'caliente': ['soldadura', 'chispa', 'ignición', 'extintor'],
            'confinado': ['gases', 'ventilación', 'oxígeno', 'rescate']
          };

          const matchedKeywords = new Set<string>();
          Object.entries(keywords).forEach(([category, words]) => {
            if (textToAnalyze.includes(category)) {
              words.forEach(w => matchedKeywords.add(w));
            }
          });

          // Find existing nodes that match these keywords
          const nodesToConnect = nodes.filter(n => 
            n.id !== newNode.id && 
            (n.type === NodeType.EPP || n.type === NodeType.RISK || n.type === NodeType.MACHINE) &&
            Array.from(matchedKeywords).some(kw => 
              n.title.toLowerCase().includes(kw) || 
              (n.description && n.description.toLowerCase().includes(kw)) ||
              (n.tags && n.tags.some(t => t.toLowerCase().includes(kw)))
            )
          );

          for (const n of nodesToConnect) {
            await addConnection(newNode.id, n.id);
          }
        }
      }

      setShowSuccessQuote(true);
      setTimeout(() => setShowSuccessQuote(false), 8000);
      
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
          {dangerousWeather && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-rose-500/10 border border-rose-500/30 rounded-3xl p-6"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-rose-500 shrink-0 mt-1" />
                <div>
                  <h3 className="text-sm font-black text-rose-500 uppercase tracking-widest mb-2">
                    Alerta Meteorológica
                  </h3>
                  <p className="text-xs text-rose-200 mb-4 leading-relaxed">
                    {dangerousWeather}
                  </p>
                  <button
                    type="button"
                    onClick={handleSuspendTask}
                    disabled={isSuspending || !taskName}
                    className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSuspending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                    Suspender y Registrar
                  </button>
                  {!taskName && (
                    <p className="text-[9px] text-rose-400/70 mt-2 text-center uppercase tracking-widest">
                      Ingrese un nombre de tarea para registrar
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {suspensionReason && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-emerald-500/10 border border-emerald-500/30 rounded-3xl p-6 text-center"
            >
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
              <h3 className="text-sm font-black text-emerald-500 uppercase tracking-widest mb-2">
                Suspensión Registrada
              </h3>
              <p className="text-xs text-emerald-200/70">
                La tarea ha sido suspendida preventivamente y registrada en el Zettelkasten.
              </p>
            </motion.div>
          )}

          {showSuccessQuote && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              className="bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 rounded-3xl p-6 relative overflow-hidden"
            >
              <div className="absolute -right-4 -top-4 opacity-10">
                <Brain className="w-32 h-32 text-emerald-500" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-emerald-400 uppercase tracking-widest">Documento Forjado</h3>
                    <p className="text-[10px] text-emerald-500/70 font-bold uppercase tracking-widest">Guardado en Red Neuronal</p>
                  </div>
                </div>
                <div className="border-l-2 border-emerald-500/50 pl-4 py-1 mt-2">
                  <p className="text-sm text-emerald-100 leading-relaxed">
                    El documento ha sido validado, encriptado y almacenado de forma inmutable. La trazabilidad está garantizada.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

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
                <div className="relative">
                  <textarea
                    required
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none h-32"
                    placeholder="Describe los pasos generales, herramientas a usar y el entorno de trabajo..."
                  />
                  <button
                    type="button"
                    onClick={handleGPSAutocomplete}
                    disabled={isLocating}
                    className="absolute bottom-3 right-3 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 p-2 rounded-lg transition-colors flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                    title="Autocompletar con ubicación GPS actual"
                  >
                    {isLocating ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                    GPS
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  Maquinaria y Herramientas (Opcional)
                </label>
                <textarea
                  value={machineryDetails}
                  onChange={(e) => setMachineryDetails(e.target.value)}
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none h-24"
                  placeholder="Ej: Esmeril angular Makita 9557NB, Andamio Layher Allround... (La IA buscará manuales del fabricante)"
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
                className={`w-full font-black uppercase tracking-widest py-4 rounded-xl transition-colors flex items-center justify-center gap-2 ${
                  !isOnline 
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {!isOnline ? (
                  <>
                    <WifiOff className="w-5 h-5" />
                    Requiere Conexión
                  </>
                ) : isGenerating ? (
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

                {generatedPTS.marcoLegal && generatedPTS.marcoLegal.length > 0 && (
                  <section>
                    <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">3</div>
                      Marco Legal y Normativo
                    </h3>
                    <ul className="list-disc list-inside text-zinc-700 space-y-2 pl-8">
                      {generatedPTS.marcoLegal.map((ley: string, i: number) => (
                        <li key={i}>{ley}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {generatedPTS.evaluacionMatematica && (
                  <section>
                    <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">4</div>
                      Evaluación Matemática del Riesgo
                    </h3>
                    <div className="pl-8 text-zinc-700 prose prose-zinc max-w-none">
                      <ReactMarkdown 
                        remarkPlugins={[remarkMath]} 
                        rehypePlugins={[rehypeKatex]}
                      >
                        {generatedPTS.evaluacionMatematica}
                      </ReactMarkdown>
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">5</div>
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
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">6</div>
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
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">7</div>
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
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">8</div>
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
                      <div className="w-6 h-6 rounded bg-red-100 flex items-center justify-center text-red-600 text-xs">9</div>
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

                {generatedPTS.fuentesFabricante && generatedPTS.fuentesFabricante.length > 0 && (
                  <section>
                    <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center text-blue-600 text-xs">10</div>
                      Fuentes del Fabricante Consultadas
                    </h3>
                    <ul className="list-disc list-inside text-zinc-700 space-y-2 pl-8">
                      {generatedPTS.fuentesFabricante.map((fuente: string, i: number) => (
                        <li key={i} className="text-sm break-all">
                          {fuente.startsWith('http') ? (
                            <a href={fuente} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                              {fuente}
                            </a>
                          ) : (
                            fuente
                          )}
                        </li>
                      ))}
                    </ul>
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


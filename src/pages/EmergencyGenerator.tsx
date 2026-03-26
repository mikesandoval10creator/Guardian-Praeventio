import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Wand2, Loader2, Save, Download, CheckCircle2, AlertTriangle, Brain } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { ZettelkastenNode, NodeType } from '../types';
import { where, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { generateEmergencyPlanJSON } from '../services/geminiService';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useFirebase } from '../contexts/FirebaseContext';

export function EmergencyGenerator() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { addNode } = useZettelkasten();
  const [scenario, setScenario] = useState('');
  const [description, setDescription] = useState('');
  const [normative, setNormative] = useState('DS 594 / Ley 16.744');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState<any>(null);
  const [selectedRiskId, setSelectedRiskId] = useState<string>('');

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
    if (!scenario || !description) return;

    setIsGenerating(true);
    try {
      const data = await generateEmergencyPlanJSON(scenario, description, normative);
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
    if (!generatedPlan || !selectedProject || !user) return;
    
    setIsSaving(true);
    try {
      // 1. Save document to Firestore
      const docRef = await addDoc(collection(db, `projects/${selectedProject.id}/documents`), {
        name: `Plan de Emergencia: ${scenario}`,
        category: 'Plan de Emergencia',
        status: 'Vigente',
        uploadDate: new Date().toISOString(),
        uploadedBy: user.displayName || user.email || 'Usuario',
        projectId: selectedProject.id,
        content: generatedPlan, // Storing the structured JSON
        isGenerated: true,
        createdAt: serverTimestamp()
      });

      // 2. Add to Zettelkasten
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
          isGenerated: true
        }
      });

      // 3. Add to Emergency Protocols
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
                disabled={isGenerating || !scenario || !description}
                className="w-full bg-rose-500 hover:bg-rose-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-6 py-4 rounded-xl font-black uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2 mt-4"
              >
                {isGenerating ? (
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
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 text-zinc-900 shadow-2xl"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 sm:gap-0 mb-6 sm:mb-8 border-b border-zinc-200 pb-4 sm:pb-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tighter text-zinc-900 leading-tight">Plan de Emergencia</h2>
                  <p className="text-sm sm:text-base text-rose-600 font-bold mt-1">{scenario}</p>
                </div>
                <div className="flex gap-2 self-end sm:self-auto">
                  <button 
                    onClick={handleSave}
                    disabled={isSaving}
                    className="p-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-600 transition-colors disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <Save className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>
                  <button className="p-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-600 transition-colors">
                    <Download className="w-4 h-4 sm:w-5 sm:h-5" />
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

                <section>
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">3. Cadena de Mando y Comunicaciones</h3>
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
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">4. Acciones Inmediatas</h3>
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
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">5. Procedimiento de Evacuación</h3>
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
                  <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 mb-2 sm:mb-3">6. Equipos de Emergencia Requeridos</h3>
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

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldCheck, 
  Activity, 
  Volume2, 
  Sun, 
  Wind, 
  AlertTriangle, 
  CheckCircle2, 
  Brain,
  Loader2,
  ChevronRight,
  FileText
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { evaluateMinsalCompliance } from '../services/geminiService';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import ReactMarkdown from 'react-markdown';

const PROTOCOLS = [
  {
    id: 'prexor',
    title: 'PREXOR',
    description: 'Protocolo de Exposición Ocupacional a Ruido',
    icon: Volume2,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20'
  },
  {
    id: 'tmert',
    title: 'TMERT',
    description: 'Trastornos Musculoesqueléticos Relacionados al Trabajo',
    icon: Activity,
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/20'
  },
  {
    id: 'planesi',
    title: 'PLANESI',
    description: 'Plan Nacional de Erradicación de la Silicosis',
    icon: Wind,
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/20'
  },
  {
    id: 'uv',
    title: 'Radiación UV',
    description: 'Guía Técnica de Radiación Ultravioleta de Origen Solar',
    icon: Sun,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20'
  },
  {
    id: 'plaguicidas',
    title: 'Plaguicidas',
    description: 'Protocolo de Vigilancia Epidemiológica de Plaguicidas',
    icon: ShieldCheck,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20'
  }
];

export function MinsalProtocols() {
  const { selectedProject } = useProject();
  const { nodes } = useRiskEngine();
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalyze = async (protocolId: string, protocolTitle: string) => {
    setSelectedProtocol(protocolId);
    setIsAnalyzing(true);
    setAnalysisResult(null);

    try {
      // Gather context from Zettelkasten
      const projectNodes = nodes.filter(n => !selectedProject || n.projectId === selectedProject.id);
      const relevantNodes = projectNodes.filter(n => 
        (n.title || '').toLowerCase().includes(String(protocolId || '').toLowerCase()) || 
        (n.description || '').toLowerCase().includes(String(protocolId || '').toLowerCase()) ||
        (n.tags || []).some(t => String(t || '').toLowerCase().includes(String(protocolId || '').toLowerCase()))
      );

      const context = relevantNodes.map(n => `[${n.type}] ${n.title}: ${n.description}`).join('\n');
      
      const result = await evaluateMinsalCompliance(protocolTitle, context, selectedProject?.industry);
      setAnalysisResult(result);
    } catch (error) {
      console.error('Error analyzing protocol:', error);
      setAnalysisResult('Error al analizar el cumplimiento. Por favor, intente nuevamente.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <PremiumFeatureGuard featureName="Protocolos MINSAL" description="Audita y gestiona el cumplimiento de los protocolos del Ministerio de Salud de Chile (PREXOR, TMERT, PLANESI) con IA.">
      <div className="p-6 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              <ShieldCheck className="w-8 h-8 text-emerald-500" />
              Protocolos MINSAL
            </h1>
            <p className="text-zinc-400 mt-1">Gestión de cumplimiento normativo de salud ocupacional en Chile</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Protocols List */}
          <div className="lg:col-span-1 space-y-4">
            {PROTOCOLS.map((protocol) => (
              <motion.button
                key={protocol.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleAnalyze(protocol.id, protocol.title)}
                className={`w-full text-left p-4 rounded-2xl border transition-all ${
                  selectedProtocol === protocol.id 
                    ? `bg-zinc-800 border-${protocol.color.split('-')[1]}-500 shadow-lg` 
                    : 'bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800/80'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl ${protocol.bg} flex items-center justify-center ${protocol.border} border shrink-0`}>
                    <protocol.icon className={`w-6 h-6 ${protocol.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-white truncate">{protocol.title}</h3>
                    <p className="text-sm text-zinc-400 line-clamp-2 mt-1">{protocol.description}</p>
                  </div>
                  <ChevronRight className={`w-5 h-5 ${selectedProtocol === protocol.id ? protocol.color : 'text-zinc-600'} mt-3 shrink-0`} />
                </div>
              </motion.button>
            ))}
          </div>

          {/* Analysis Panel */}
          <div className="lg:col-span-2">
            <div className="bg-zinc-900/50 rounded-3xl border border-zinc-800 p-6 min-h-[600px] flex flex-col">
              <AnimatePresence mode="wait">
                {!selectedProtocol ? (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex-1 flex flex-col items-center justify-center text-zinc-500 space-y-4"
                  >
                    <FileText className="w-16 h-16 opacity-20" />
                    <p className="text-center max-w-sm">
                      Selecciona un protocolo de la lista para analizar el nivel de cumplimiento actual de tu proyecto utilizando IA.
                    </p>
                  </motion.div>
                ) : isAnalyzing ? (
                  <motion.div 
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex-1 flex flex-col items-center justify-center text-zinc-400 space-y-6"
                  >
                    <div className="relative">
                      <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full animate-pulse" />
                      <Brain className="w-16 h-16 text-emerald-500 animate-bounce relative z-10" />
                    </div>
                    <div className="text-center space-y-2">
                      <h3 className="text-lg font-bold text-white">Analizando Cumplimiento</h3>
                      <p className="text-sm">Cruzando datos del Zettelkasten con exigencias del MINSAL...</p>
                    </div>
                  </motion.div>
                ) : analysisResult ? (
                  <motion.div 
                    key="result"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex-1 overflow-y-auto custom-scrollbar pr-2"
                  >
                    <div className="flex items-center gap-3 mb-6 pb-6 border-b border-zinc-800">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-white">Informe de Auditoría IA</h2>
                        <p className="text-sm text-zinc-400">Generado basado en el contexto actual del proyecto</p>
                      </div>
                    </div>
                    
                    <div className="prose prose-invert prose-emerald max-w-none">
                      <ReactMarkdown>{analysisResult}</ReactMarkdown>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </PremiumFeatureGuard>
  );
}

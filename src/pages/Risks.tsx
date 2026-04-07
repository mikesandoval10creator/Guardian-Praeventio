import { useState } from 'react';
import { Card, Button } from '../components/shared/Card';
import { Modal } from '../components/shared/Modal';
import { IPERCAnalysis } from '../components/risks/IPERCAnalysis';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { RiskNode, NodeType } from '../types';
import { Shield, Info, Volume2, Activity, Wind, Cloud, Accessibility, Brain, ArrowDownCircle, Zap, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const iconMap: Record<string, any> = {
  Volume2,
  Activity,
  Wind,
  Cloud,
  Accessibility,
  Brain,
  ArrowDownCircle,
};

export function Risks() {
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const { selectedProject } = useProject();
  const { data: nodes, loading } = useFirestoreCollection<RiskNode>('nodes');
  const navigate = useNavigate();

  const riskNodes = nodes.filter(node => 
    node.type === NodeType.RISK && 
    (selectedProject ? node.projectId === selectedProject.id : true)
  );

  return (
    <div className="space-y-6 sm:space-y-8 p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col items-center text-center mb-6 sm:mb-8">
        <div className="bg-emerald-100 dark:bg-emerald-900/20 p-3 sm:p-4 rounded-2xl sm:rounded-3xl mb-3 sm:mb-4">
          <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">Gestión de Riesgos</h2>
        <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 max-w-xs mt-1">
          Identificación y control de peligros en el entorno laboral.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 sm:py-20 gap-3 sm:gap-4">
          <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-500 animate-spin" />
          <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest">Cargando riesgos...</p>
        </div>
      ) : riskNodes.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {riskNodes.map((node) => {
            const Icon = iconMap[node.metadata?.icon] || Info;
            const hasCoords = node.metadata?.lat !== undefined && node.metadata?.lng !== undefined;

            return (
              <Card 
                key={node.id} 
                className="p-4 sm:p-6 flex flex-row sm:flex-col items-center sm:text-center gap-4 hover:border-emerald-500/50 transition-all active:scale-95 group relative"
              >
                <div className={`${node.metadata?.color || 'bg-zinc-500'} p-3 sm:p-4 rounded-xl sm:rounded-2xl shadow-lg shadow-zinc-500/20 shrink-0`}>
                  <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <span className="text-[9px] sm:text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest leading-none truncate">
                    {node.tags[0] || 'General'}
                  </span>
                  <h3 className="text-xs sm:text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight leading-tight sm:leading-none line-clamp-2">
                    {node.title}
                  </h3>
                </div>
                
                {hasCoords && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('/site-map');
                    }}
                    className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg sm:absolute sm:top-2 sm:right-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"
                    title="Ver en Mapa"
                  >
                    <MapPin className="w-4 h-4 sm:w-3 sm:h-3" />
                  </button>
                )}
                
                {node.isPendingSync && (
                  <div className="absolute top-2 right-2 sm:top-2 sm:right-2">
                    <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[9px] font-black uppercase tracking-widest flex items-center gap-1">
                      <RefreshCw className="w-2 h-2 animate-spin" />
                      Pendiente
                    </span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 sm:py-10 bg-white/50 dark:bg-zinc-900/50 rounded-2xl sm:rounded-3xl border border-dashed border-zinc-200 dark:border-white/10">
          <p className="text-zinc-500 text-xs sm:text-sm px-4">No se han identificado riesgos para este proyecto.</p>
        </div>
      )}

      <Card className="p-5 sm:p-6 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-zinc-200 dark:border-white/5 shadow-xl">
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-emerald-100 dark:bg-emerald-500/20 p-2 rounded-xl shrink-0">
            <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex flex-col min-w-0">
            <h3 className="text-sm sm:text-base font-black uppercase tracking-widest truncate">Matriz IPERC IA</h3>
            <span className="text-[9px] sm:text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Inteligencia Artificial</span>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-5 sm:mb-6">
          Genera una matriz de identificación de peligros y evaluación de riesgos personalizada utilizando inteligencia artificial.
        </p>
        <Button 
          onClick={() => setIsAnalysisOpen(true)}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 sm:py-3 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-black uppercase tracking-widest transition-colors"
        >
          Iniciar Análisis IA
        </Button>
      </Card>

      <Modal
        isOpen={isAnalysisOpen}
        onClose={() => setIsAnalysisOpen(false)}
        title="Análisis de Riesgo Inteligente"
      >
        <IPERCAnalysis />
      </Modal>
    </div>
  );
}

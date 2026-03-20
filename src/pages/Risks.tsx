import { useState } from 'react';
import { Card, Button } from '../components/shared/Card';
import { Modal } from '../components/shared/Modal';
import { IPERCAnalysis } from '../components/risks/IPERCAnalysis';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { ZettelkastenNode, NodeType } from '../types';
import { Shield, Info, Volume2, Activity, Wind, Cloud, Accessibility, Brain, ArrowDownCircle, Zap, Loader2 } from 'lucide-react';

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
  const { data: nodes, loading } = useFirestoreCollection<ZettelkastenNode>('nodes');

  const riskNodes = nodes.filter(node => 
    node.type === NodeType.RISK && 
    (selectedProject ? node.projectId === selectedProject.id : true)
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="bg-emerald-100 dark:bg-emerald-900/20 p-4 rounded-3xl mb-4">
          <Shield className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-2xl font-black uppercase tracking-tighter">Gestión de Riesgos</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
          Identificación y control de peligros en el entorno laboral.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Cargando riesgos...</p>
        </div>
      ) : riskNodes.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {riskNodes.map((node) => {
            const Icon = iconMap[node.metadata?.icon] || Info;
            return (
              <Card key={node.id} className="p-6 flex flex-col items-center text-center gap-4 hover:border-emerald-500/50 transition-all active:scale-95 cursor-pointer">
                <div className={`${node.metadata?.color || 'bg-zinc-500'} p-4 rounded-2xl shadow-lg shadow-zinc-500/20`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">
                    {node.tags[0] || 'General'}
                  </span>
                  <h3 className="text-xs font-black uppercase tracking-tight leading-none">
                    {node.title}
                  </h3>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-10 bg-zinc-900/50 rounded-3xl border border-dashed border-white/10">
          <p className="text-zinc-500 text-sm">No se han identificado riesgos para este proyecto.</p>
        </div>
      )}

      <Card className="p-6 bg-zinc-900 text-white border-none shadow-xl">
        <div className="flex items-center gap-4 mb-6">
          <div className="bg-emerald-500 p-2 rounded-xl">
            <Zap className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <h3 className="text-sm font-black uppercase tracking-widest">Matriz IPERC IA</h3>
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Beta v1.0</span>
          </div>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed mb-6">
          Genera una matriz de identificación de peligros y evaluación de riesgos personalizada utilizando inteligencia artificial.
        </p>
        <Button 
          onClick={() => setIsAnalysisOpen(true)}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-colors"
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

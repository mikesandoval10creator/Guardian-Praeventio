import React, { useMemo } from 'react';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { useProject } from '../../contexts/ProjectContext';
import { NodeType } from '../../types';
import { AlertTriangle, CheckCircle2, ShieldAlert, Activity } from 'lucide-react';

export const RealTimeStatusWidget: React.FC = () => {
  const { nodes } = useZettelkasten();
  const { selectedProject } = useProject();

  const industry = selectedProject?.industry || 'General';

  const status = useMemo(() => {
    const now = new Date();
    const recentCriticalNodes = nodes.filter(n => {
      if (n.type !== NodeType.INCIDENT && n.type !== NodeType.EMERGENCY) return false;
      if (selectedProject && n.projectId !== selectedProject.id) return false;
      
      const isRecent = (now.getTime() - new Date(n.createdAt).getTime()) < 24 * 60 * 60 * 1000;
      const isActive = n.metadata?.status === 'active' || n.metadata?.estado === 'Abierto';
      
      return isRecent || isActive;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (recentCriticalNodes.length > 0) {
      return {
        type: 'alert',
        node: recentCriticalNodes[0]
      };
    }

    return {
      type: 'ok',
      node: null
    };
  }, [nodes, selectedProject]);

  const getRecommendation = (industry: string) => {
    switch (industry) {
      case 'Minería':
        return 'Verifique sistemas de ventilación y fortificación. Monitoree fatiga en operadores de maquinaria pesada.';
      case 'Construcción':
        return 'Inspeccione andamios y líneas de vida. Asegure el uso correcto de arneses en trabajos en altura.';
      case 'Manufactura':
        return 'Revise guardas de seguridad en maquinaria móvil. Mantenga pasillos despejados de obstáculos.';
      case 'Agricultura':
        return 'Asegure hidratación constante y pausas bajo sombra. Verifique EPP para aplicación de agroquímicos.';
      case 'Energía':
        return 'Confirme bloqueos de energía (LOTO) antes de intervenciones. Use EPP dieléctrico certificado.';
      default:
        return 'Mantenga las áreas de trabajo ordenadas y limpias. Realice pausas activas cada 2 horas.';
    }
  };

  if (status.type === 'alert' && status.node) {
    return (
      <section className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-2.5 sm:p-3 shadow-sm relative overflow-hidden w-full">
        <div className="absolute -right-4 -top-4 opacity-10">
          <ShieldAlert className="w-24 h-24 text-rose-500" />
        </div>
        <div className="relative z-10 flex flex-row gap-2 sm:gap-3 items-center">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-0.5 sm:mb-1">
              <span className="bg-rose-500 text-white text-[7px] sm:text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded">
                {status.node.type === NodeType.EMERGENCY ? 'Emergencia Activa' : 'Incidente Reciente'}
              </span>
              <span className="text-[8px] sm:text-[10px] text-rose-600 dark:text-rose-400 font-bold">
                {new Date(status.node.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <h3 className="text-[10px] sm:text-xs font-black text-zinc-900 dark:text-white leading-tight mb-0.5 truncate">
              {status.node.title}
            </h3>
            <p className="text-[9px] sm:text-[10px] text-zinc-600 dark:text-zinc-300 leading-snug line-clamp-2 sm:line-clamp-none">
              {status.node.description}
            </p>
          </div>
          <div className="shrink-0">
            <button className="bg-rose-500 hover:bg-rose-600 text-white text-[8px] sm:text-[9px] font-black uppercase tracking-widest px-2 sm:px-3 py-1.5 rounded-lg transition-colors shadow-sm whitespace-nowrap">
              Ver Protocolo
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-2.5 sm:p-3 shadow-sm relative overflow-hidden w-full">
      <div className="absolute -right-4 -top-4 opacity-5">
        <Activity className="w-24 h-24 text-indigo-500" />
      </div>
      <div className="relative z-10 flex flex-row gap-2 sm:gap-3 items-center">
        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5 sm:mb-1">
            <span className="bg-indigo-500 text-white text-[7px] sm:text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded">
              Estado Operativo
            </span>
            <span className="text-[8px] sm:text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">
              Faena Normal
            </span>
          </div>
          <h3 className="text-[10px] sm:text-xs font-black text-zinc-900 dark:text-white leading-tight mb-0.5 truncate">
            Recomendación
          </h3>
          <p className="text-[9px] sm:text-[10px] text-zinc-600 dark:text-zinc-300 leading-snug">
            {getRecommendation(industry)}
          </p>
        </div>
      </div>
    </section>
  );
};

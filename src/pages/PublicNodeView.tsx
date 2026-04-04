import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Shield, 
  User, 
  Cpu, 
  FileText, 
  AlertTriangle, 
  Info,
  ArrowLeft,
  ExternalLink,
  QrCode,
  CheckCircle2,
  Clock,
  MapPin
} from 'lucide-react';
import { db, doc, getDoc, collection, query, where, getDocs } from '../services/firebase';
import { RiskNode, NodeType } from '../types';

export function PublicNodeView() {
  const { nodeId } = useParams<{ nodeId: string }>();
  const [node, setNode] = useState<RiskNode | null>(null);
  const [connections, setConnections] = useState<RiskNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchNode() {
      if (!nodeId) return;
      try {
        const nodeRef = doc(db, 'zettelkasten', nodeId);
        const nodeSnap = await getDoc(nodeRef);

        if (nodeSnap.exists()) {
          const nodeData = { id: nodeSnap.id, ...nodeSnap.data() } as RiskNode;
          
          if (nodeData.isPublic === false) {
             setError('Nodo no encontrado o no es público.');
             setLoading(false);
             return;
          }
          
          setNode(nodeData);

          // Fetch connections
          if (nodeData.connections && nodeData.connections.length > 0) {
            const connPromises = nodeData.connections.map(id => getDoc(doc(db, 'zettelkasten', id)));
            const connSnaps = await Promise.all(connPromises);
            const connData = connSnaps
              .filter(s => s.exists())
              .map(s => ({ id: s.id, ...s.data() } as RiskNode));
            setConnections(connData);
          }
        } else {
          setError('Nodo no encontrado o no es público.');
        }
      } catch (err) {
        console.error('Error fetching public node:', err);
        setError('Error al cargar la información.');
      } finally {
        setLoading(false);
      }
    }

    fetchNode();
  }, [nodeId]);

  const getNodeIcon = (type: NodeType) => {
    switch (type) {
      case NodeType.WORKER: return User;
      case NodeType.RISK: return AlertTriangle;
      case NodeType.EPP: return Shield;
      case NodeType.MACHINE: return Cpu;
      case NodeType.NORMATIVE: return FileText;
      case NodeType.DOCUMENT: return FileText;
      default: return Info;
    }
  };

  const getNodeColor = (type: NodeType) => {
    switch (type) {
      case NodeType.WORKER: return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case NodeType.RISK: return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      case NodeType.EPP: return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      case NodeType.NORMATIVE: return 'text-violet-500 bg-violet-500/10 border-violet-500/20';
      case NodeType.DOCUMENT: return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      default: return 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Validando Credenciales...</span>
        </div>
      </div>
    );
  }

  if (error || !node) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-black text-white uppercase tracking-tighter">Acceso Denegado</h1>
          <p className="text-zinc-500 text-sm leading-relaxed">
            {error || 'El recurso solicitado no está disponible o ha sido restringido.'}
          </p>
          <Link to="/" className="inline-flex items-center gap-2 text-emerald-500 font-black text-[10px] uppercase tracking-widest hover:text-emerald-400 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Volver al Inicio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-300 font-sans selection:bg-emerald-500/30">
      {/* Public Header */}
      <div className="bg-zinc-900/50 border-b border-white/5 p-6 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-tighter">Praeventio Guard</h2>
              <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Verificación de Nodo</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Autenticado</span>
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto p-6 space-y-8">
        {/* Main Node Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900 border border-white/10 rounded-[2rem] sm:rounded-[40px] p-6 sm:p-8 md:p-12 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-4 sm:p-8 opacity-5">
            {React.createElement(getNodeIcon(node.type), { size: 150, className: "sm:w-[200px] sm:h-[200px]" })}
          </div>

          <div className="relative z-10 space-y-6 sm:space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-4">
                <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border ${getNodeColor(node.type)}`}>
                  {React.createElement(getNodeIcon(node.type), { className: 'w-4 h-4' })}
                  <span className="text-[10px] font-black uppercase tracking-widest">{node.type}</span>
                </div>
                <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-white uppercase tracking-tighter leading-tight">
                  {node.title}
                </h1>
              </div>
              <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-start gap-4 md:gap-2">
                <div className="p-3 sm:p-4 bg-white rounded-2xl shadow-xl order-2 md:order-1">
                  <QrCode className="w-10 h-10 sm:w-12 sm:h-12 text-black" />
                </div>
                <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest order-1 md:order-2">ID: {node.id.slice(0, 8)}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white/5 border border-white/5 rounded-3xl p-6">
                <Clock className="w-5 h-5 text-zinc-500 mb-3" />
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Última Actualización</p>
                <p className="text-sm font-bold text-white">{new Date(node.updatedAt).toLocaleDateString('es-CL')}</p>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-3xl p-6">
                <MapPin className="w-5 h-5 text-zinc-500 mb-3" />
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Proyecto</p>
                <p className="text-sm font-bold text-white">{node.projectId || 'Global'}</p>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-3xl p-6">
                <Network className="w-5 h-5 text-zinc-500 mb-3" />
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Conexiones</p>
                <p className="text-sm font-bold text-white">{node.connections.length} Nodos</p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Descripción Detallada</h3>
              <p className="text-zinc-400 leading-relaxed text-lg">
                {node.description}
              </p>
            </div>

            {node.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-4">
                {node.tags.map(tag => (
                  <span key={tag} className="px-4 py-1.5 bg-zinc-800 border border-white/5 rounded-xl text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Connections Section */}
        {connections.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between px-4">
              <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Nodos Relacionados</h2>
              <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Certificaciones y Registros</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {connections.map((conn) => (
                <motion.div
                  key={conn.id}
                  whileHover={{ scale: 1.02 }}
                  className="bg-zinc-900 border border-white/10 rounded-3xl p-6 flex items-center justify-between group cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl border ${getNodeColor(conn.type)}`}>
                      {React.createElement(getNodeIcon(conn.type), { className: 'w-5 h-5' })}
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-white uppercase tracking-tight">{conn.title}</h4>
                      <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">{conn.type}</p>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-zinc-700 group-hover:text-emerald-500 transition-colors" />
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Footer Info */}
        <div className="text-center py-12 space-y-4">
          <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
            Documento generado por Praeventio Guard AI
          </p>
          <div className="flex justify-center gap-6">
            <img src="https://picsum.photos/seed/cert/100/100" alt="Seal 1" className="w-12 h-12 grayscale opacity-20" referrerPolicy="no-referrer" />
            <img src="https://picsum.photos/seed/iso/100/100" alt="Seal 2" className="w-12 h-12 grayscale opacity-20" referrerPolicy="no-referrer" />
          </div>
        </div>
      </main>
    </div>
  );
}

// Helper for Network icon if not imported
function Network({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </svg>
  );
}

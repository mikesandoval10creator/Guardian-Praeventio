import React, { useState, useMemo } from 'react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType, RiskNode } from '../../types';
import { 
  Plus, 
  Link as LinkIcon, 
  Search, 
  X, 
  Check, 
  AlertCircle,
  Database,
  Network,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function RiskNetworkManager() {
  const { nodes, loading } = useUniversalKnowledge();
  const { addConnection, addNode } = useRiskEngine();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  const filteredNodes = useMemo(() => {
    return nodes.filter(n => 
      n.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.type.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [nodes, searchTerm]);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const targetNode = nodes.find(n => n.id === targetNodeId);

  const handleLink = async () => {
    if (selectedNodeId && targetNodeId && selectedNodeId !== targetNodeId) {
      await addConnection(selectedNodeId, targetNodeId);
      setIsLinking(false);
      setTargetNodeId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-[2.5rem] p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 border border-indigo-500/20">
            <Network className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">Gestor de Sinapsis</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Conecta el Conocimiento de Seguridad</p>
          </div>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar nodos..."
            className="bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-64"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Node List */}
        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
            <Database className="w-3 h-3" /> Nodos Disponibles
          </h3>
          <div className="h-[400px] overflow-y-auto pr-2 space-y-2 custom-scrollbar">
            {filteredNodes.map(node => (
              <button
                key={node.id}
                onClick={() => setSelectedNodeId(node.id)}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                  selectedNodeId === node.id 
                    ? 'bg-indigo-500/10 border-indigo-500/50' 
                    : 'bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/5 hover:bg-zinc-100 dark:hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    node.type === NodeType.RISK ? 'bg-red-500' :
                    node.type === NodeType.INCIDENT ? 'bg-rose-500' :
                    'bg-blue-500'
                  }`} />
                  <div className="text-left">
                    <p className="text-[10px] font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate max-w-[180px]">{node.title}</p>
                    <p className="text-[8px] font-bold text-zinc-500 uppercase">{node.type}</p>
                  </div>
                </div>
                {selectedNodeId === node.id && <Check className="w-4 h-4 text-indigo-500" />}
              </button>
            ))}
          </div>
        </div>

        {/* Connection Panel */}
        <div className="bg-zinc-50 dark:bg-zinc-950/50 rounded-3xl border border-zinc-200 dark:border-white/5 p-6 flex flex-col justify-center items-center text-center space-y-6">
          {!selectedNode ? (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-zinc-200 dark:bg-white/5 flex items-center justify-center mx-auto">
                <AlertCircle className="w-8 h-8 text-zinc-400 dark:text-zinc-700" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-tight">Selecciona un nodo</p>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mt-1">Para comenzar a crear conexiones</p>
              </div>
            </div>
          ) : (
            <div className="w-full space-y-8">
              <div className="flex items-center justify-center gap-6">
                <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl w-32">
                  <p className="text-[8px] font-black text-indigo-500 uppercase mb-1">Origen</p>
                  <p className="text-[10px] font-bold text-zinc-900 dark:text-white uppercase truncate">{selectedNode.title}</p>
                </div>
                <div className="w-12 h-px bg-zinc-300 dark:bg-zinc-800 relative">
                  <ArrowRight className="absolute -right-2 -top-1.5 w-3 h-3 text-zinc-300 dark:text-zinc-800" />
                </div>
                {targetNode ? (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl w-32 relative group">
                    <button 
                      onClick={() => setTargetNodeId(null)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <p className="text-[8px] font-black text-emerald-500 uppercase mb-1">Destino</p>
                    <p className="text-[10px] font-bold text-zinc-900 dark:text-white uppercase truncate">{targetNode.title}</p>
                  </div>
                ) : (
                  <button 
                    onClick={() => setIsLinking(true)}
                    className="p-4 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 border-dashed rounded-2xl w-32 hover:bg-zinc-200 dark:hover:bg-white/10 transition-all"
                  >
                    <Plus className="w-4 h-4 text-zinc-400 dark:text-zinc-600 mx-auto mb-1" />
                    <p className="text-[8px] font-black text-zinc-400 dark:text-zinc-600 uppercase">Conectar</p>
                  </button>
                )}
              </div>

              {isLinking && (
                <div className="space-y-4">
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Selecciona el nodo destino</p>
                  <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                    {nodes.filter(n => n.id !== selectedNodeId).map(node => (
                      <button
                        key={node.id}
                        onClick={() => setTargetNodeId(node.id)}
                        className="p-3 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-xl hover:border-emerald-500/30 text-left transition-all"
                      >
                        <p className="text-[9px] font-bold text-zinc-900 dark:text-white uppercase truncate">{node.title}</p>
                        <p className="text-[7px] text-zinc-500 uppercase">{node.type}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                disabled={!selectedNodeId || !targetNodeId}
                onClick={handleLink}
                className="w-full bg-indigo-600 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-all flex items-center justify-center gap-3"
              >
                <LinkIcon className="w-4 h-4" />
                Establecer Sinapsis
              </button>

              <div className="pt-6 border-t border-zinc-200 dark:border-white/5">
                <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 text-left">Conexiones Existentes</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedNode.connections.length === 0 ? (
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-700 italic">Sin conexiones activas</p>
                  ) : (
                    nodes.filter(n => selectedNode.connections.includes(n.id)).map(conn => (
                      <div key={conn.id} className="px-3 py-1.5 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-lg flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-indigo-500" />
                        <span className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase">{conn.title}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';
import ForceGraph3D from 'react-force-graph-3d';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType, RiskNode } from '../../types';
import { 
  Shield, 
  User, 
  Cpu, 
  FileText, 
  AlertTriangle, 
  X, 
  Maximize2, 
  Minimize2,
  Filter,
  Info,
  Search,
  Zap,
  WifiOff,
  Box
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import * as THREE from 'three';

export function KnowledgeGraph() {
  const { getGraphData, loading } = useRiskEngine();
  const graphRef = useRef<ForceGraphMethods>(null);
  const graph3DRef = useRef<any>(null);
  const [selectedNode, setSelectedNode] = useState<RiskNode | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [filter, setFilter] = useState<NodeType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [propagatingNode, setPropagatingNode] = useState<string | null>(null);
  const [isSimulatingPropagation, setIsSimulatingPropagation] = useState(false);
  const [propagationResult, setPropagationResult] = useState<any>(null);
  const isOnline = useOnlineStatus();

  const graphData = useMemo(() => {
    const data = getGraphData();
    let filteredNodes = data.nodes;

    if (filter !== 'all') {
      filteredNodes = filteredNodes.filter(n => n.type === filter);
    }

    if (searchQuery) {
      const lowQuery = String(searchQuery || '').toLowerCase();
      filteredNodes = filteredNodes.filter(n => 
        n.title.toLowerCase().includes(lowQuery) || 
        (n.description || '').toLowerCase().includes(lowQuery) ||
        n.tags.some(t => t.toLowerCase().includes(lowQuery))
      );
    }
    
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredLinks = data.links.filter(l => 
      nodeIds.has(typeof l.source === 'string' ? l.source : (l.source as any).id) && 
      nodeIds.has(typeof l.target === 'string' ? l.target : (l.target as any).id)
    );

    return { nodes: filteredNodes, links: filteredLinks };
  }, [getGraphData, filter, searchQuery]);

  const handleSimulatePropagation = async (node: RiskNode) => {
    if (!isOnline) return;
    if (propagatingNode === node.id) {
      setPropagatingNode(null);
      setPropagationResult(null);
      return;
    }

    setPropagatingNode(node.id);
    setIsSimulatingPropagation(true);
    setPropagationResult(null);

    try {
      const { simulateRiskPropagation } = await import('../../services/geminiService');
      const context = graphData.nodes
        .slice(0, 20)
        .map(n => `- ${n.type}: ${n.title}`)
        .join('\n');
      
      const result = await simulateRiskPropagation(node.title, context);
      setPropagationResult(result);
    } catch (error) {
      console.error('Error simulating propagation:', error);
    } finally {
      setIsSimulatingPropagation(false);
    }
  };

  const affectedNodes = useMemo(() => {
    if (!propagatingNode) return new Set<string>();
    const affected = new Set<string>([propagatingNode]);
    
    if (propagationResult && propagationResult.affectedNodes) {
      const data = getGraphData();
      const affectedTitles = new Set(propagationResult.affectedNodes.map((t: string) => t.toLowerCase()));
      data.nodes.forEach(n => {
        if (affectedTitles.has(n.title.toLowerCase())) {
          affected.add(n.id);
        }
      });
      return affected;
    }

    const data = getGraphData();
    // Simple 1-level propagation for demo while loading
    data.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : (link.source as any).id;
      const targetId = typeof link.target === 'string' ? link.target : (link.target as any).id;
      
      if (sourceId === propagatingNode) affected.add(targetId);
      if (targetId === propagatingNode) affected.add(sourceId);
    });
    
    return affected;
  }, [propagatingNode, getGraphData, propagationResult]);

  const getNodeColor = (type: NodeType) => {
    switch (type) {
      case NodeType.WORKER: return '#10b981'; // emerald-500
      case NodeType.RISK: return '#f43f5e'; // rose-500
      case NodeType.EPP: return '#3b82f6'; // blue-500
      case NodeType.MACHINE: return '#f59e0b'; // amber-500
      case NodeType.NORMATIVE: return '#8b5cf6'; // violet-500
      case NodeType.FINDING: return '#f59e0b'; // amber-500
      case NodeType.AUDIT: return '#06b6d4'; // cyan-500
      case NodeType.PROJECT: return '#10b981'; // emerald-500
      default: return '#71717a'; // zinc-500
    }
  };

  const getNodeIcon = (type: NodeType) => {
    switch (type) {
      case NodeType.WORKER: return User;
      case NodeType.RISK: return AlertTriangle;
      case NodeType.EPP: return Shield;
      case NodeType.MACHINE: return Cpu;
      case NodeType.NORMATIVE: return FileText;
      case NodeType.FINDING: return AlertTriangle;
      case NodeType.AUDIT: return Shield;
      default: return Info;
    }
  };

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);
    if (is3D && graph3DRef.current) {
      // Aim at node from outside it
      const distance = 100;
      const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);

      graph3DRef.current.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, // new position
        node, // lookAt ({ x, y, z })
        3000  // ms transition duration
      );
    } else if (!is3D && graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 1000);
      graphRef.current.zoom(2, 1000);
    }
  }, [is3D]);

  if (loading) {
    return (
      <div className="w-full h-[600px] flex items-center justify-center bg-zinc-950 rounded-3xl border border-white/5">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Sincronizando Red Neuronal...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative bg-zinc-950 rounded-3xl border border-white/5 overflow-hidden transition-all duration-500 ${isFullscreen ? 'fixed inset-0 z-50' : 'h-[600px]'}`}>
      {/* Header / Controls */}
      <div className="absolute top-0 left-0 right-0 p-3 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between z-10 pointer-events-none gap-2 sm:gap-0">
        <div className="flex items-center gap-2 sm:gap-4 pointer-events-auto w-full sm:w-auto overflow-x-auto no-scrollbar">
          <div className="bg-zinc-900/80 backdrop-blur-md border border-white/10 p-1.5 sm:p-2 rounded-xl sm:rounded-2xl flex flex-nowrap sm:flex-wrap gap-1.5 sm:gap-2 min-w-max">
            {(['all', NodeType.PROJECT, NodeType.WORKER, NodeType.RISK, NodeType.FINDING, NodeType.AUDIT, NodeType.NORMATIVE] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all ${
                  filter === t ? 'bg-emerald-500 text-white' : 'text-zinc-500 hover:text-white hover:bg-white/5'
                }`}
              >
                {t === 'all' ? 'Todos' : t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto w-full sm:w-auto">
          <div className="relative group flex-1 sm:flex-none">
            <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" />
            <input
              type="text"
              placeholder="Buscar nodos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 sm:pl-11 pr-3 sm:pr-4 py-2 sm:py-3 bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-all w-full sm:w-48 sm:focus:w-64"
            />
          </div>
          <button
            onClick={() => setIs3D(!is3D)}
            className={`p-2 sm:p-3 bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-xl sm:rounded-2xl transition-all shrink-0 ${is3D ? 'text-emerald-500 border-emerald-500/50' : 'text-zinc-400 hover:text-white'}`}
            title={is3D ? "Cambiar a vista 2D" : "Cambiar a vista 3D"}
          >
            <Box className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 sm:p-3 bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-xl sm:rounded-2xl text-zinc-400 hover:text-white transition-all shrink-0"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>
        </div>
      </div>

      {/* Graph Canvas */}
      {is3D ? (
        <ForceGraph3D
          ref={graph3DRef}
          graphData={graphData}
          nodeLabel="title"
          nodeColor={node => getNodeColor((node as any).type)}
          nodeRelSize={6}
          linkDirectionalParticles={2}
          linkDirectionalParticleSpeed={0.005}
          linkColor={() => 'rgba(255, 255, 255, 0.1)'}
          onNodeClick={handleNodeClick}
          backgroundColor="#09090b"
          nodeThreeObject={(node: any) => {
            const color = getNodeColor(node.type);
            const isAffected = affectedNodes.has(node.id);
            
            // Create a custom material
            const material = new THREE.MeshLambertMaterial({
              color: color,
              transparent: true,
              opacity: isAffected ? 1 : 0.8,
              emissive: color,
              emissiveIntensity: isAffected ? 0.8 : 0.2
            });

            // Create geometry
            const geometry = new THREE.SphereGeometry(isAffected ? 8 : 5);
            const mesh = new THREE.Mesh(geometry, material);

            // Add a glow effect if affected
            if (isAffected) {
              const glowMaterial = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.3,
                blending: THREE.AdditiveBlending
              });
              const glowGeometry = new THREE.SphereGeometry(12);
              const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
              
              // Simple animation for the glow
              const animateGlow = () => {
                const scale = 1 + Math.sin(Date.now() / 200) * 0.2;
                glowMesh.scale.set(scale, scale, scale);
                requestAnimationFrame(animateGlow);
              };
              animateGlow();
              
              mesh.add(glowMesh);
            }

            return mesh;
          }}
        />
      ) : (
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          nodeLabel="title"
          nodeColor={node => getNodeColor((node as any).type)}
          nodeRelSize={6}
          linkDirectionalParticles={2}
          linkDirectionalParticleSpeed={0.005}
          linkColor={() => 'rgba(255, 255, 255, 0.1)'}
          onNodeClick={handleNodeClick}
          backgroundColor="#09090b"
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const label = node.title;
            const fontSize = 12 / globalScale;
            const color = getNodeColor(node.type);
            
            // Draw node glow
            const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 10);
            gradient.addColorStop(0, `${color}44`);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(node.x, node.y, 10, 0, 2 * Math.PI);
            ctx.fill();

            // Draw node circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, 4, 0, 2 * Math.PI, false);
            ctx.fillStyle = color;
            ctx.fill();

            // Propagation effect
            if (affectedNodes.has(node.id)) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, 4 * (1.5 + Math.sin(Date.now() / 200) * 0.2), 0, 2 * Math.PI, false);
              ctx.strokeStyle = color;
              ctx.lineWidth = 0.5 / globalScale;
              ctx.stroke();
            }
            
            // Draw border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1 / globalScale;
            ctx.stroke();

            // Draw label
            if (globalScale > 1.2) {
              ctx.font = `${fontSize}px Inter`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              
              // Text shadow for readability
              ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
              ctx.shadowBlur = 4;
              
              ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
              ctx.fillText(label, node.x, node.y + 12);
              
              // Reset shadow
              ctx.shadowBlur = 0;
            }
          }}
        />
      )}

      {/* Detail Panel */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            className="absolute top-0 right-0 bottom-0 w-full sm:w-80 bg-zinc-900/95 backdrop-blur-xl border-l border-white/10 p-6 sm:p-8 z-20 overflow-y-auto"
          >
            <button
              onClick={() => setSelectedNode(null)}
              className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 text-zinc-500 hover:text-white transition-colors bg-zinc-800/50 rounded-full"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-6 sm:space-y-8 mt-4 sm:mt-0">
              <div className="flex flex-col items-center text-center gap-3 sm:gap-4">
                <div className={`p-3 sm:p-4 rounded-2xl sm:rounded-3xl bg-opacity-20 ${
                  selectedNode.type === NodeType.WORKER ? 'bg-emerald-500 text-emerald-500' :
                  selectedNode.type === NodeType.RISK ? 'bg-rose-500 text-rose-500' :
                  selectedNode.type === NodeType.EPP ? 'bg-blue-500 text-blue-500' :
                  'bg-zinc-500 text-zinc-500'
                }`}>
                  {React.createElement(getNodeIcon(selectedNode.type), { className: 'w-6 h-6 sm:w-8 sm:h-8' })}
                </div>
                <div>
                  <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1 block">
                    {selectedNode.type}
                  </span>
                  <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight text-white leading-tight">
                    {selectedNode.title}
                  </h3>
                </div>
              </div>

              <div className="space-y-3 sm:space-y-4">
                <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">Descripción</h4>
                <p className="text-[11px] sm:text-xs text-zinc-400 leading-relaxed">
                  {selectedNode.description}
                </p>
              </div>

              {selectedNode.metadata?.normativa && (
                <div className="space-y-3 sm:space-y-4">
                  <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">Normativa Asociada</h4>
                  <div className="p-3 sm:p-4 bg-violet-500/10 border border-violet-500/20 rounded-xl sm:rounded-2xl">
                    <p className="text-[10px] sm:text-[11px] text-violet-400 font-medium leading-relaxed">
                      {selectedNode.metadata.normativa}
                    </p>
                  </div>
                </div>
              )}

              {selectedNode.tags.length > 0 && (
                <div className="space-y-3 sm:space-y-4">
                  <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">Etiquetas</h4>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {selectedNode.tags.map(tag => (
                      <span key={tag} className="px-2 sm:px-3 py-1 bg-white/5 rounded-md sm:rounded-lg text-[8px] sm:text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-6 sm:pt-8 border-t border-white/5 flex flex-col gap-2 sm:gap-3">
                <button 
                  onClick={() => handleSimulatePropagation(selectedNode)}
                  disabled={isSimulatingPropagation || !isOnline}
                  className={`w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                    !isOnline 
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : propagatingNode === selectedNode.id 
                        ? 'bg-rose-500 text-white' 
                        : 'bg-amber-500/20 text-amber-500 hover:bg-amber-500/30'
                  } disabled:opacity-50`}
                >
                  {!isOnline ? (
                    <WifiOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  ) : (
                    <Zap className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isSimulatingPropagation ? 'animate-pulse' : ''}`} />
                  )}
                  {!isOnline ? 'Requiere Conexión' : isSimulatingPropagation ? 'Analizando...' : propagatingNode === selectedNode.id ? 'Detener Análisis' : 'Analizar Propagación'}
                </button>
                <button className="w-full py-3 sm:py-4 bg-white/5 hover:bg-white/10 text-white rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all active:scale-95">
                  Ver Nodo Completo
                </button>
              </div>

              {propagationResult && propagatingNode === selectedNode.id && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 sm:mt-6 p-3 sm:p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl sm:rounded-2xl space-y-3 sm:space-y-4"
                >
                  <div className="flex items-center gap-2 text-rose-500">
                    <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">Análisis de Propagación</h4>
                  </div>
                  
                  <div>
                    <p className="text-[11px] sm:text-xs text-zinc-300 leading-relaxed">
                      {propagationResult.explanation}
                    </p>
                  </div>

                  {propagationResult.recommendedActions && propagationResult.recommendedActions.length > 0 && (
                    <div className="space-y-1.5 sm:space-y-2">
                      <h5 className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-zinc-500">Acciones Recomendadas</h5>
                      <ul className="space-y-1.5 sm:space-y-2">
                        {propagationResult.recommendedActions.map((action: string, i: number) => (
                          <li key={i} className="text-[11px] sm:text-xs text-zinc-400 flex items-start gap-2">
                            <span className="text-rose-500 mt-0.5">•</span>
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="hidden sm:block absolute bottom-6 left-6 p-4 bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-2xl space-y-2 pointer-events-none">
        <h4 className="text-[8px] font-black uppercase tracking-widest text-zinc-500 mb-2">Leyenda</h4>
        <div className="flex flex-col gap-2">
          {([NodeType.PROJECT, NodeType.WORKER, NodeType.RISK, NodeType.FINDING, NodeType.AUDIT, NodeType.NORMATIVE] as const).map(t => (
            <div key={t} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getNodeColor(t) }} />
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

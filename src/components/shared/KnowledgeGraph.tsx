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
  Box,
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import * as THREE from 'three';
import { analyzeRootCauses } from '../../services/geminiService';
import jsPDF from 'jspdf';
import { QRCodeSVG } from 'qrcode.react';

/**
 * Props for {@link KnowledgeGraph}.
 *
 * `controlledSelectedId` is an OPTIONAL inversion-of-control hook used by
 * deep-link consumers (currently `RiskNetwork.tsx`) to programmatically
 * surface a node when arriving from `/risk-network?node=<id>`. When set
 * AND the matching node has loaded into `getGraphData()`, the component
 * promotes it to `selectedNode` (opening the detail drawer) and pans the
 * 2D camera onto it — matching the click behaviour of `handleNodeClick`.
 *
 * Contract:
 *   - `null` / `undefined` is the uncontrolled default; the component
 *     manages selection through user clicks alone.
 *   - The effect re-runs whenever the prop *or* `nodes.length` changes,
 *     so a deep-link that arrives before nodes settle still resolves
 *     once the graph data is ready (the `RiskNetwork` page deep-link is
 *     validated against loaded ids, so a missing id won't fire here).
 *   - We only react to changes — an external user click (which mutates
 *     internal `selectedNode` directly) is NOT clobbered as long as the
 *     prop hasn't changed.
 *   - The 3D camera path is not exercised today (the deep-link arrives
 *     before users toggle 3D), so we centre via `centerAt` only. 3D
 *     framing is a follow-up if/when a deep-link toggles `is3D` first.
 */
interface KnowledgeGraphProps {
  controlledSelectedId?: string | null;
}

export function KnowledgeGraph({ controlledSelectedId }: KnowledgeGraphProps = {}) {
  const { nodes, getGraphData, loading } = useRiskEngine();
  const graphRef = useRef<ForceGraphMethods>(null);
  const graph3DRef = useRef<any>(null);
  const [selectedNode, setSelectedNode] = useState<RiskNode | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [filter, setFilter] = useState<NodeType | 'all' | 'orphan'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [propagatingNode, setPropagatingNode] = useState<string | null>(null);
  const [isSimulatingPropagation, setIsSimulatingPropagation] = useState(false);
  const [propagationResult, setPropagationResult] = useState<any>(null);
  const [isAnalyzingCauses, setIsAnalyzingCauses] = useState(false);
  const [causeAnalysisResult, setCauseAnalysisResult] = useState<any>(null);
  const isOnline = useOnlineStatus();

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Cache for Three.js objects to prevent memory leaks
  const threeCache = useRef<{
    geometries: Record<string, THREE.SphereGeometry>;
    materials: Record<string, THREE.Material>;
  }>({
    geometries: {},
    materials: {}
  });

  // Cleanup Three.js resources on unmount
  useEffect(() => {
    return () => {
      const { geometries, materials } = threeCache.current;
      Object.values(geometries).forEach(g => g.dispose());
      Object.values(materials).forEach(m => m.dispose());
      
      // Force WebGL context loss if possible
      if (graph3DRef.current) {
        try {
          const renderer = graph3DRef.current.renderer();
          if (renderer) {
            renderer.dispose();
            renderer.forceContextLoss();
          }
        } catch (e) {
          console.warn("Could not dispose WebGL context", e);
        }
      }
    };
  }, []);

  const graphData = useMemo(() => {
    const data = getGraphData();
    let filteredNodes = data.nodes;

    if (focusMode && selectedNode) {
      // Find neighbors up to depth 2
      const neighbors = new Set<string>([selectedNode.id]);
      const depth1 = new Set<string>();
      
      data.links.forEach(l => {
        const sourceId = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const targetId = typeof l.target === 'string' ? l.target : (l.target as any).id;
        
        if (sourceId === selectedNode.id) depth1.add(targetId);
        if (targetId === selectedNode.id) depth1.add(sourceId);
      });

      depth1.forEach(id => neighbors.add(id));

      data.links.forEach(l => {
        const sourceId = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const targetId = typeof l.target === 'string' ? l.target : (l.target as any).id;
        
        if (depth1.has(sourceId)) neighbors.add(targetId);
        if (depth1.has(targetId)) neighbors.add(sourceId);
      });

      filteredNodes = filteredNodes.filter(n => neighbors.has(n.id));
    } else if (filter === 'orphan') {
      const connectedNodeIds = new Set<string>();
      data.links.forEach(l => {
        connectedNodeIds.add(typeof l.source === 'string' ? l.source : (l.source as any).id);
        connectedNodeIds.add(typeof l.target === 'string' ? l.target : (l.target as any).id);
      });
      filteredNodes = filteredNodes.filter(n => !connectedNodeIds.has(n.id));
    } else if (filter !== 'all') {
      filteredNodes = filteredNodes.filter(n => n.type === filter);
    }

    if (debouncedSearchQuery) {
      const lowQuery = String(debouncedSearchQuery || '').toLowerCase();
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
  }, [getGraphData, filter, debouncedSearchQuery, focusMode, selectedNode]);

  // Stop simulation after 3 seconds to save battery
  useEffect(() => {
    const timer = setTimeout(() => {
      if (graphRef.current) {
        graphRef.current.d3Force('charge')?.strength(0);
        graphRef.current.d3Force('link')?.strength(0);
      }
      if (graph3DRef.current) {
        graph3DRef.current.d3Force('charge')?.strength(0);
        graph3DRef.current.d3Force('link')?.strength(0);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [graphData]);

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

  const handleAnalyzeCauses = async (node: RiskNode) => {
    if (!isOnline) return;
    
    setIsAnalyzingCauses(true);
    setCauseAnalysisResult(null);
    
    try {
      const data = getGraphData();
      // Gather context from connected nodes
      const connectedLinks = data.links.filter(l => 
        (typeof l.source === 'object' ? (l.source as any).id : l.source) === node.id || 
        (typeof l.target === 'object' ? (l.target as any).id : l.target) === node.id
      );
      
      const connectedNodeIds = new Set(connectedLinks.flatMap(l => [
        typeof l.source === 'object' ? (l.source as any).id : l.source,
        typeof l.target === 'object' ? (l.target as any).id : l.target
      ]));
      
      const contextNodes = data.nodes.filter(n => connectedNodeIds.has(n.id) && n.id !== node.id);
      const contextString = contextNodes.map(n => `${n.type}: ${n.title}`).join('\n');
      
      const result = await analyzeRootCauses(node.title, node.description, contextString);
      setCauseAnalysisResult(result);
    } catch (error) {
      console.error("Error analyzing causes:", error);
    } finally {
      setIsAnalyzingCauses(false);
    }
  };

  const handleExportPDF = () => {
    if (!selectedNode) return;
    
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    
    pdf.setFontSize(20);
    pdf.setTextColor(15, 23, 42); // slate-900
    pdf.text('Charla Integral de 5 Minutos', pageWidth / 2, 20, { align: 'center' });
    
    pdf.setFontSize(14);
    pdf.setTextColor(51, 65, 85); // slate-700
    pdf.text(`Tema: ${selectedNode.title}`, 20, 40);
    
    pdf.setFontSize(12);
    pdf.setTextColor(100, 116, 139); // slate-500
    pdf.text(`Tipo: ${selectedNode.type}`, 20, 50);
    
    pdf.setFontSize(11);
    pdf.setTextColor(15, 23, 42); // slate-900
    const splitDescription = pdf.splitTextToSize(selectedNode.description || 'Sin descripción', pageWidth - 40);
    pdf.text(splitDescription, 20, 70);
    
    if (selectedNode.tags && selectedNode.tags.length > 0) {
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139); // slate-500
      pdf.text(`Etiquetas: ${selectedNode.tags.join(', ')}`, 20, 70 + (splitDescription.length * 6) + 10);
    }
    
    pdf.save(`Charla_5_Min_${selectedNode.title.replace(/\s+/g, '_')}.pdf`);
  };

  const getNodeColor = (type: NodeType, node?: RiskNode) => {
    if (node && isCriticalNormative(node)) return '#ef4444'; // red-500
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

  // Apply external `controlledSelectedId` once nodes have loaded.
  //
  // Wiring:
  //   1. RiskNetwork.tsx resolves `?node=<id>` → passes here.
  //   2. We look up the node in `graphData.nodes` (the FILTERED set the
  //      ForceGraph renders, which includes the d3-attached `x`/`y` once
  //      simulation has settled).
  //   3. If found, we set `selectedNode` (opens drawer + drives Backlinks
  //      computation) and pan the camera. We use the same `centerAt(...,
  //      1000)` call as `handleNodeClick` so the UX is consistent.
  //
  // Edge cases:
  //   - Node exists in raw data but is filtered out (e.g. user has the
  //     "orphan" filter active and the deep-linked node is connected):
  //     we silently no-op rather than mutate `filter`. Surfacing this
  //     would require feedback UI that isn't in scope this round.
  //   - `x`/`y` may still be `undefined` on first render before d3 attaches
  //     positions; `centerAt(undefined, undefined, ...)` is a no-op in
  //     react-force-graph, so we set `selectedNode` regardless and the
  //     camera will catch up on the next render where positions exist.
  useEffect(() => {
    if (!controlledSelectedId) return;
    if (graphData.nodes.length === 0) return;
    // If the user already has this node selected, skip — avoids a
    // re-pan loop if the parent re-renders.
    if (selectedNode?.id === controlledSelectedId) return;

    const target = graphData.nodes.find((n: any) => n.id === controlledSelectedId);
    if (!target) return;

    setSelectedNode(target as RiskNode);

    if (!is3D && graphRef.current && typeof (target as any).x === 'number' && typeof (target as any).y === 'number') {
      graphRef.current.centerAt((target as any).x, (target as any).y, 1000);
      graphRef.current.zoom(2, 1000);
    }
    // Note: depend on `graphData.nodes.length` (not the array) so we
    // re-run once data lands, but don't churn when force-sim updates
    // node coordinates each tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSelectedId, graphData.nodes.length, is3D]);

  if (loading) {
    return (
      <div className="w-full h-[600px] flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 rounded-3xl border border-zinc-200 dark:border-white/5">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Sincronizando Red Neuronal...</span>
        </div>
      </div>
    );
  }

  const isCriticalNormative = (node: RiskNode) => {
    if (node.type !== NodeType.NORMATIVE) return false;
    const text = `${node.title} ${node.description}`.toLowerCase();
    return text.includes('cierre') || text.includes('clausura') || text.includes('fatal') || text.includes('muerte') || text.includes('grave') || text.includes('clausura de faena');
  };

  return (
    <div className={`relative rounded-3xl border overflow-hidden transition-all duration-500 ${isFullscreen ? 'fixed inset-0 z-50' : 'h-[600px]'} ${isZenMode ? 'bg-black border-transparent' : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-white/5'}`}>
      {/* Header / Controls */}
      <div className={`absolute top-0 left-0 right-0 p-3 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between z-10 pointer-events-none gap-2 sm:gap-0 transition-opacity duration-500 ${isZenMode ? 'opacity-0 hover:opacity-100' : 'opacity-100'}`}>
        <div className="flex items-center gap-2 sm:gap-4 pointer-events-auto w-full sm:w-auto overflow-x-auto no-scrollbar">
          <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200 dark:border-white/10 p-1.5 sm:p-2 rounded-xl sm:rounded-2xl flex flex-nowrap sm:flex-wrap gap-1.5 sm:gap-2 min-w-max">
            {(['all', NodeType.PROJECT, NodeType.WORKER, NodeType.RISK, NodeType.FINDING, NodeType.AUDIT, NodeType.NORMATIVE, 'orphan'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all ${
                  filter === t ? 'bg-emerald-500 text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5'
                }`}
              >
                {t === 'all' ? 'Todos' : t === 'orphan' ? 'Huérfanos' : t}
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
              className="pl-9 sm:pl-11 pr-3 sm:pr-4 py-2 sm:py-3 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-all w-full sm:w-48 sm:focus:w-64"
            />
          </div>
          <button
            onClick={() => setIsZenMode(!isZenMode)}
            className={`p-2 sm:p-3 backdrop-blur-md border rounded-xl sm:rounded-2xl transition-all ${isZenMode ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white/80 dark:bg-zinc-900/80 border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}
            title="Modo Zen"
          >
            <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          <button
            onClick={() => setIs3D(!is3D)}
            className={`p-2 sm:p-3 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl transition-all shrink-0 ${is3D ? 'text-emerald-500 border-emerald-500/50' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`}
            title={is3D ? "Cambiar a vista 2D" : "Cambiar a vista 3D"}
          >
            <Box className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 sm:p-3 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all shrink-0"
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
          nodeColor={node => getNodeColor((node as any).type, node as RiskNode)}
          nodeRelSize={6}
          linkDirectionalParticles={2}
          linkDirectionalParticleSpeed={0.005}
          linkColor={() => 'rgba(255, 255, 255, 0.1)'}
          onNodeClick={handleNodeClick}
          backgroundColor={isZenMode ? '#000000' : '#09090b'}
          nodeThreeObject={(node: any) => {
            const color = getNodeColor(node.type, node);
            const isAffected = affectedNodes.has(node.id);
            
            // Get or create geometry
            const geoKey = isAffected ? 'affected' : 'normal';
            if (!threeCache.current.geometries[geoKey]) {
              threeCache.current.geometries[geoKey] = new THREE.SphereGeometry(isAffected ? 8 : 5);
            }
            const geometry = threeCache.current.geometries[geoKey];

            // Get or create material
            const matKey = `${color}-${isAffected}`;
            if (!threeCache.current.materials[matKey]) {
              threeCache.current.materials[matKey] = new THREE.MeshLambertMaterial({
                color: color,
                transparent: true,
                opacity: isAffected ? 1 : 0.8,
                emissive: color,
                emissiveIntensity: isAffected ? 0.8 : 0.2
              });
            }
            const material = threeCache.current.materials[matKey];

            const mesh = new THREE.Mesh(geometry, material);

            // Add a glow effect if affected
            if (isAffected) {
              const glowMatKey = `glow-${color}`;
              if (!threeCache.current.materials[glowMatKey]) {
                threeCache.current.materials[glowMatKey] = new THREE.MeshBasicMaterial({
                  color: color,
                  transparent: true,
                  opacity: 0.3,
                  blending: THREE.AdditiveBlending
                });
              }
              const glowMaterial = threeCache.current.materials[glowMatKey];
              
              const glowGeoKey = 'glow';
              if (!threeCache.current.geometries[glowGeoKey]) {
                threeCache.current.geometries[glowGeoKey] = new THREE.SphereGeometry(12);
              }
              const glowGeometry = threeCache.current.geometries[glowGeoKey];
              
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
          nodeColor={node => getNodeColor((node as any).type, node as RiskNode)}
          nodeRelSize={6}
          linkDirectionalParticles={2}
          linkDirectionalParticleSpeed={0.005}
          linkColor={() => 'rgba(255, 255, 255, 0.1)'}
          onNodeClick={handleNodeClick}
          backgroundColor={isZenMode ? '#000000' : '#09090b'}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const label = node.title;
            const fontSize = 12 / globalScale;
            const color = getNodeColor(node.type, node);
            
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
            className="absolute top-0 right-0 bottom-0 w-full sm:w-80 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border-l border-zinc-200 dark:border-white/10 p-6 sm:p-8 z-20 overflow-y-auto"
          >
            <button
              onClick={() => setSelectedNode(null)}
              className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors bg-zinc-100 dark:bg-zinc-800/50 rounded-full"
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
                  <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight text-zinc-900 dark:text-white leading-tight">
                    {selectedNode.title}
                  </h3>
                </div>
              </div>

              <div className="space-y-3 sm:space-y-4">
                <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">Descripción</h4>
                <p className="text-[11px] sm:text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
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

              {/*
                * Backlinks panel — Round 14 Task 3.
                *
                * Shows every node that *points to* the currently selected
                * node (i.e. the inbound edges). Distinct from the outgoing
                * `selectedNode.connections` list because the graph stores
                * bidirectional edges as two separate arrayUnion writes
                * (see networkBackend.ts step 4): a node can technically
                * appear here without being in `selectedNode.connections`
                * if a write was partially applied. We compute fresh from
                * the live `nodes` array each render so any drift surfaces
                * immediately rather than relying on stale `connections`.
                *
                * Clicking a backlink pivots the drawer to that node by
                * routing through `handleNodeClick`, so the camera pan +
                * Backlinks recompute fire as if the user had clicked
                * directly on the graph.
                */}
              {(() => {
                const backlinks = nodes.filter(
                  (n) => n.id !== selectedNode.id && Array.isArray(n.connections) && n.connections.includes(selectedNode.id),
                );
                return (
                  <div className="space-y-3 sm:space-y-4">
                    <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Referencias entrantes
                      {backlinks.length > 0 && (
                        <span className="ml-2 px-1.5 py-0.5 bg-zinc-100 dark:bg-white/5 rounded text-zinc-600 dark:text-zinc-400 text-[8px]">
                          {backlinks.length}
                        </span>
                      )}
                    </h4>
                    {backlinks.length === 0 ? (
                      <p className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-500 italic leading-relaxed">
                        Ningún nodo apunta a este aún.
                      </p>
                    ) : (
                      <ul className="space-y-1.5 sm:space-y-2">
                        {backlinks.map((bl) => {
                          const Icon = getNodeIcon(bl.type);
                          return (
                            <li key={bl.id}>
                              <button
                                type="button"
                                onClick={() => handleNodeClick(bl)}
                                className="w-full flex items-center gap-2 px-2.5 py-2 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-lg sm:rounded-xl transition-colors text-left"
                              >
                                <span
                                  className="shrink-0 w-2 h-2 rounded-full"
                                  style={{ backgroundColor: getNodeColor(bl.type, bl) }}
                                  aria-hidden="true"
                                />
                                <Icon className="w-3 h-3 text-zinc-500 dark:text-zinc-400 shrink-0" />
                                <span className="text-[10px] sm:text-[11px] font-bold text-zinc-700 dark:text-zinc-300 truncate">
                                  {bl.title}
                                </span>
                                <span className="ml-auto text-[8px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600 shrink-0">
                                  {bl.type}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })()}

              {selectedNode.tags.length > 0 && (
                <div className="space-y-3 sm:space-y-4">
                  <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">Etiquetas</h4>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {isCriticalNormative(selectedNode) && (
                      <span className="px-2 sm:px-3 py-1 bg-red-500 rounded-md sm:rounded-lg text-[8px] sm:text-[9px] font-bold text-white uppercase tracking-widest flex items-center gap-1 shadow-[0_0_10px_rgba(239,68,68,0.5)]">
                        <AlertTriangle className="w-3 h-3" />
                        Riesgo de Cierre de Faena
                      </span>
                    )}
                    {selectedNode.tags.map(tag => (
                      <span key={tag} className="px-2 sm:px-3 py-1 bg-zinc-100 dark:bg-white/5 rounded-md sm:rounded-lg text-[8px] sm:text-[9px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-6 sm:pt-8 border-t border-zinc-200 dark:border-white/5 flex flex-col gap-2 sm:gap-3">
                {/* Contextual Actions based on Node Type */}
                {selectedNode.type === NodeType.RISK && (
                  <>
                    <button 
                      onClick={() => window.location.href = `/pts?title=${encodeURIComponent(selectedNode.title)}&desc=${encodeURIComponent(selectedNode.description)}&normative=${encodeURIComponent(selectedNode.metadata?.normativa || '')}`}
                      className="w-full py-3 sm:py-4 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <FileText className="w-4 h-4" /> Generar PTS Automático
                    </button>
                    <button 
                      onClick={() => handleAnalyzeCauses(selectedNode)}
                      disabled={isAnalyzingCauses || !isOnline}
                      className={`w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                        !isOnline 
                          ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed'
                          : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400'
                      } disabled:opacity-50`}
                    >
                      {isAnalyzingCauses ? <AlertTriangle className="w-4 h-4 animate-pulse" /> : <Search className="w-4 h-4" />}
                      {isAnalyzingCauses ? 'Analizando Causas...' : 'Analizar Causas Raíz'}
                    </button>
                  </>
                )}
                
                {selectedNode.type === NodeType.WORKER && (
                  <button 
                    onClick={() => window.location.href = `/curriculum`}
                    className="w-full py-3 sm:py-4 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <User className="w-4 h-4" /> Ver Currículum Preventivo
                  </button>
                )}

                {selectedNode.type === NodeType.NORMATIVE && (
                  <button
                    onClick={() => {
                      // ── Round 16 (R1): prefer a deep-link to the
                      // specific BCN Norma/Parte when the node carries
                      // those identifiers. Falls back to the search
                      // results page when the metadata is missing —
                      // existing nodes need to be enriched with
                      // `bcnNormaId` (and optionally `bcnIdParte`)
                      // before this fallback can be removed (deferred
                      // to a future round; track via the A2 NIT).
                      const meta = (selectedNode.metadata ?? {}) as {
                        bcnNormaId?: string | number;
                        bcnIdParte?: string | number;
                      };
                      let url: string;
                      if (meta.bcnNormaId) {
                        const params = new URLSearchParams({
                          idNorma: String(meta.bcnNormaId),
                        });
                        if (meta.bcnIdParte) {
                          params.set('idParte', String(meta.bcnIdParte));
                        }
                        url = `https://www.bcn.cl/leychile/navegar?${params.toString()}`;
                      } else {
                        url = `https://www.bcn.cl/leychile/consulta/busqueda?texto=${encodeURIComponent(selectedNode.title)}`;
                      }
                      window.open(url, '_blank');
                    }}
                    className="w-full py-3 sm:py-4 bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <FileText className="w-4 h-4" /> Leer Ley Completa (BCN)
                  </button>
                )}

                <button 
                  onClick={() => handleSimulatePropagation(selectedNode)}
                  disabled={isSimulatingPropagation || !isOnline}
                  className={`w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                    !isOnline 
                      ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : propagatingNode === selectedNode.id 
                        ? 'bg-rose-500 text-white' 
                        : 'bg-amber-500/20 text-amber-600 dark:text-amber-500 hover:bg-amber-500/30'
                  } disabled:opacity-50`}
                >
                  {!isOnline ? (
                    <WifiOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  ) : (
                    <Zap className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isSimulatingPropagation ? 'animate-pulse' : ''}`} />
                  )}
                  {!isOnline ? 'Requiere Conexión' : isSimulatingPropagation ? 'Analizando...' : propagatingNode === selectedNode.id ? 'Detener Análisis' : 'Analizar Propagación'}
                </button>
                <button 
                  onClick={() => setFocusMode(!focusMode)}
                  className={`w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                    focusMode
                      ? 'bg-emerald-500 text-white'
                      : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  <Filter className="w-4 h-4" /> {focusMode ? 'Mostrar Toda la Red' : 'Enfocar Vecindario'}
                </button>
                <button 
                  onClick={handleExportPDF}
                  className="w-full py-3 sm:py-4 bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" /> Exportar Charla 5 Min
                </button>
                <button 
                  onClick={() => setShowQR(!showQR)}
                  className="w-full py-3 sm:py-4 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Box className="w-4 h-4" /> {showQR ? 'Ocultar QR' : 'Sincronización P2P (QR)'}
                </button>
                <button className="w-full py-3 sm:py-4 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-900 dark:text-white rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all active:scale-95">
                  Ver Nodo Completo
                </button>
              </div>

              {showQR && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-4 sm:mt-6 p-4 bg-white dark:bg-zinc-800 rounded-xl sm:rounded-2xl flex flex-col items-center justify-center gap-4"
                >
                  <p className="text-xs text-zinc-500 text-center">
                    Escanea este código con otro dispositivo para transferir este nodo de conocimiento (Air-gapped).
                  </p>
                  <div className="p-4 bg-white rounded-xl">
                    <QRCodeSVG 
                      value={JSON.stringify({
                        id: selectedNode.id,
                        title: selectedNode.title,
                        type: selectedNode.type,
                        description: selectedNode.description,
                        tags: selectedNode.tags
                      })} 
                      size={200}
                      level="H"
                      includeMargin={true}
                    />
                  </div>
                </motion.div>
              )}

              {propagationResult && propagatingNode === selectedNode.id && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 sm:mt-6 p-3 sm:p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl sm:rounded-2xl space-y-3 sm:space-y-4"
                >
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-500">
                    <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">Análisis de Propagación</h4>
                  </div>
                  
                  <div>
                    <p className="text-[11px] sm:text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {propagationResult.explanation}
                    </p>
                  </div>

                  {propagationResult.recommendedActions && propagationResult.recommendedActions.length > 0 && (
                    <div className="space-y-1.5 sm:space-y-2">
                      <h5 className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-zinc-500">Acciones Recomendadas</h5>
                      <ul className="space-y-1.5 sm:space-y-2">
                        {propagationResult.recommendedActions.map((action: string, i: number) => (
                          <li key={i} className="text-[11px] sm:text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
                            <span className="text-rose-500 mt-0.5">•</span>
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              )}
              {causeAnalysisResult && selectedNode.type === NodeType.RISK && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 sm:mt-6 p-3 sm:p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl sm:rounded-2xl space-y-3 sm:space-y-4"
                >
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-500">
                    <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">Ruta de Prevención (Causas Raíz)</h4>
                  </div>
                  
                  <div>
                    <p className="text-[11px] sm:text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {causeAnalysisResult.explanation}
                    </p>
                  </div>

                  {causeAnalysisResult.rootCauses && causeAnalysisResult.rootCauses.length > 0 && (
                    <div className="space-y-1.5 sm:space-y-2">
                      <h5 className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-zinc-500">Causas Principales a Investigar</h5>
                      <ul className="space-y-1.5 sm:space-y-2">
                        {causeAnalysisResult.rootCauses.map((cause: string, i: number) => (
                          <li key={i} className="text-[11px] sm:text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
                            <span className="text-rose-500 mt-0.5">•</span>
                            <span>{cause}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {causeAnalysisResult.recommendedActions && causeAnalysisResult.recommendedActions.length > 0 && (
                    <div className="space-y-1.5 sm:space-y-2">
                      <h5 className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-zinc-500">Acciones en Terreno</h5>
                      <ul className="space-y-1.5 sm:space-y-2">
                        {causeAnalysisResult.recommendedActions.map((action: string, i: number) => (
                          <li key={i} className="text-[11px] sm:text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
                            <span className="text-emerald-500 mt-0.5">✓</span>
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
      <div className="hidden sm:block absolute bottom-6 left-6 p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200 dark:border-white/10 rounded-2xl space-y-2 pointer-events-none">
        <h4 className="text-[8px] font-black uppercase tracking-widest text-zinc-500 mb-2">Leyenda</h4>
        <div className="flex flex-col gap-2">
          {([NodeType.PROJECT, NodeType.WORKER, NodeType.RISK, NodeType.FINDING, NodeType.AUDIT, NodeType.NORMATIVE] as const).map(t => (
            <div key={t} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getNodeColor(t) }} />
              <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

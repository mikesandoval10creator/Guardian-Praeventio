import React, { useState, useMemo, useRef, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { NodeType, RiskNode, ImplementationGuide, ImplementationSpec, ImplementationEquipment } from '../../types';
import { db } from '../../services/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import {
  Search,
  Maximize2,
  Minimize2,
  Link as LinkIcon,
  Clock,
  Tag,
  ChevronRight,
  X,
  Brain,
  ShieldCheck,
  Plus,
  Trash2,
  Save,
  Loader2,
  CheckSquare,
  Wrench,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const emptyGuide = (): ImplementationGuide => ({
  steps: [],
  technicalSpecs: [],
  requiredEquipment: [],
  environmentalConstraints: [],
  successRate: undefined,
  implementationsCount: undefined,
  contextualNotes: '',
});

export function RiskNetworkExplorer() {
  const { nodes, stats, loading } = useUniversalKnowledge();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [selectedNode, setSelectedNode] = useState<RiskNode | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filterType, setFilterType] = useState<NodeType | 'All'>('All');
  const [editingGuide, setEditingGuide] = useState<ImplementationGuide | null>(null);
  const [isSavingGuide, setIsSavingGuide] = useState(false);
  const [guideSaved, setGuideSaved] = useState(false);
  const fgRef = useRef<any>(null);

  // Debounce search term to prevent excessive graph re-renders
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const graphData = useMemo(() => {
    const filteredNodes = nodes.filter(n => {
      const matchesSearch = n.title.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                          (n.description || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase());
      const matchesType = filterType === 'All' || n.type === filterType;
      return matchesSearch && matchesType;
    });

    const links: { source: string; target: string }[] = [];
    const nodeIds = new Set(filteredNodes.map(n => n.id));

    filteredNodes.forEach(node => {
      node.connections.forEach(targetId => {
        if (nodeIds.has(targetId)) {
          links.push({ source: node.id, target: targetId });
        }
      });
    });

    return {
      nodes: filteredNodes.map(n => ({
        ...n,
        id: n.id,
        name: n.title,
        color: getNodeColor(n.type),
        val: 1 + (n.connections.length * 0.5)
      })),
      links
    };
  }, [nodes, searchTerm, filterType]);

  // Stop simulation after 3 seconds to save battery
  useEffect(() => {
    const timer = setTimeout(() => {
      if (fgRef.current) {
        fgRef.current.d3Force('charge').strength(0);
        fgRef.current.d3Force('link').strength(0);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [graphData]);

  function getNodeColor(type: NodeType) {
    switch (type) {
      case NodeType.WORKER: return '#10B981'; // Emerald
      case NodeType.RISK: return '#EF4444'; // Red
      case NodeType.MACHINE: return '#3B82F6'; // Blue
      case NodeType.CONTROL: return '#22C55E'; // Green
      case NodeType.NORMATIVE: return '#F59E0B'; // Amber
      case NodeType.INSPECTION: return '#8B5CF6'; // Purple
      case NodeType.INCIDENT: return '#F43F5E'; // Rose
      case NodeType.TASK: return '#06B6D4'; // Cyan
      case NodeType.AUDIT: return '#6366F1'; // Indigo
      default: return '#94A3B8'; // Slate
    }
  }

  const handleNodeClick = (node: any) => {
    setSelectedNode(node);
    setEditingGuide(null);
    setGuideSaved(false);
    if (fgRef.current) {
      fgRef.current.centerAt(node.x, node.y, 1000);
      fgRef.current.zoom(2, 1000);
    }
  };

  const handleSaveGuide = async () => {
    if (!selectedNode || !editingGuide) return;
    setIsSavingGuide(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'nodes', selectedNode.id), {
        implementationGuide: editingGuide,
        updatedAt: now,
      });
      setGuideSaved(true);
      setTimeout(() => setGuideSaved(false), 3000);
    } catch (err) {
      console.error('Error saving implementation guide:', err);
    } finally {
      setIsSavingGuide(false);
    }
  };

  const guideOrDefault = editingGuide ?? selectedNode?.implementationGuide ?? emptyGuide();

  const updateGuideField = <K extends keyof ImplementationGuide>(key: K, value: ImplementationGuide[K]) => {
    setEditingGuide(prev => ({ ...(prev ?? guideOrDefault), [key]: value }));
  };

  return (
    <div className={`bg-white dark:bg-zinc-950 rounded-[2.5rem] border border-zinc-200 dark:border-white/5 overflow-hidden flex flex-col transition-all duration-500 ${
      isFullscreen ? 'fixed inset-4 z-50' : 'h-[600px]'
    }`}>
      {/* Header */}
      <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-50 dark:bg-zinc-900/50 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tighter">Explorador de Conocimiento</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Visualización de la Red Neuronal</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar en la red..."
              className="bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-48 transition-all"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 outline-none"
          >
            <option value="All">Todos los Tipos</option>
            {Object.values(NodeType).map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Graph Area */}
      <div className="flex-1 relative bg-zinc-100 dark:bg-[#050505]">
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          nodeLabel="name"
          nodeColor="color"
          nodeRelSize={6}
          linkWidth={1}
          linkColor={() => 'rgba(255, 255, 255, 0.1)'}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const label = node.name;
            const fontSize = 12 / globalScale;
            ctx.font = `${fontSize}px Inter`;
            const textWidth = ctx.measureText(label).width;
            const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = node.color;
            ctx.fillText(label, node.x, node.y);

            node.__bckgDimensions = bckgDimensions;
          }}
          onNodeClick={handleNodeClick}
          backgroundColor="transparent"
        />

        {/* Legend Overlay */}
        <div className="absolute bottom-6 left-6 p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md rounded-2xl border border-zinc-200 dark:border-white/10 space-y-2 pointer-events-none">
          <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Leyenda de Nodos</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {[
              { label: 'Trabajador', color: '#10B981' },
              { label: 'Riesgo', color: '#EF4444' },
              { label: 'Máquina', color: '#3B82F6' },
              { label: 'Normativa', color: '#F59E0B' },
              { label: 'Inspección', color: '#8B5CF6' },
              { label: 'Incidente', color: '#F43F5E' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-[8px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Node Detail Sidebar */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="absolute top-0 right-0 h-full w-full sm:w-80 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border-l border-zinc-200 dark:border-white/10 p-6 overflow-y-auto shadow-2xl z-50"
            >
              <div className="flex items-center justify-between mb-6">
                <div className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest`} style={{ backgroundColor: `${getNodeColor(selectedNode.type)}20`, color: getNodeColor(selectedNode.type) }}>
                  {selectedNode.type}
                </div>
                <button onClick={() => setSelectedNode(null)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight mb-2">{selectedNode.title}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6">{selectedNode.description}</p>

              <div className="space-y-6">
                <div>
                  <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Tag className="w-3 h-3" /> Etiquetas
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedNode.tags.map(tag => (
                      <span key={tag} className="px-2 py-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-md text-[9px] font-bold text-zinc-700 dark:text-zinc-300 uppercase">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <LinkIcon className="w-3 h-3" /> Conexiones ({selectedNode.connections.length})
                  </h4>
                  <div className="space-y-2">
                    {nodes.filter(n => selectedNode.connections.includes(n.id)).map(conn => (
                      <button
                        key={conn.id}
                        onClick={() => handleNodeClick(conn)}
                        className="w-full flex items-center justify-between p-3 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/10 transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getNodeColor(conn.type) }} />
                          <span className="text-[10px] font-bold text-zinc-700 dark:text-zinc-300 uppercase truncate max-w-[140px]">{conn.title}</span>
                        </div>
                        <ChevronRight className="w-3 h-3 text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-6 border-t border-zinc-200 dark:border-white/5">
                  <div className="flex items-center gap-2 text-[9px] text-zinc-500 font-bold uppercase">
                    <Clock className="w-3 h-3" />
                    Actualizado: {new Date(selectedNode.updatedAt).toLocaleDateString()}
                  </div>
                </div>

                {/* Implementation Guide — only for CONTROL nodes */}
                {selectedNode.type === NodeType.CONTROL && (
                  <div className="pt-6 border-t border-zinc-200 dark:border-white/5 space-y-5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <ShieldCheck className="w-3 h-3 text-emerald-500" />
                        Guía de Implementación
                      </h4>
                      {!editingGuide && (
                        <button
                          onClick={() => setEditingGuide(selectedNode.implementationGuide ? { ...selectedNode.implementationGuide } : emptyGuide())}
                          className="text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-400 transition-colors"
                        >
                          {selectedNode.implementationGuide ? 'Editar' : '+ Agregar'}
                        </button>
                      )}
                    </div>

                    {!editingGuide && !selectedNode.implementationGuide && (
                      <p className="text-[10px] text-zinc-500 italic">Sin guía de implementación. Agrega una para capturar cómo se aplica este control.</p>
                    )}

                    {!editingGuide && selectedNode.implementationGuide && (
                      <div className="space-y-4 text-xs text-zinc-600 dark:text-zinc-400">
                        {selectedNode.implementationGuide.steps.length > 0 && (
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1"><CheckSquare className="w-3 h-3" /> Pasos</p>
                            <ol className="space-y-1 list-decimal list-inside">
                              {selectedNode.implementationGuide.steps.map((s, i) => <li key={i}>{s}</li>)}
                            </ol>
                          </div>
                        )}
                        {selectedNode.implementationGuide.technicalSpecs.length > 0 && (
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1"><Wrench className="w-3 h-3" /> Especificaciones</p>
                            <div className="space-y-1">
                              {selectedNode.implementationGuide.technicalSpecs.map((s, i) => (
                                <div key={i} className="flex justify-between">
                                  <span className="font-bold text-zinc-700 dark:text-zinc-300">{s.key}</span>
                                  <span>{s.value}{s.unit ? ` ${s.unit}` : ''}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {selectedNode.implementationGuide.environmentalConstraints.length > 0 && (
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Restricciones</p>
                            <ul className="space-y-1 list-disc list-inside">
                              {selectedNode.implementationGuide.environmentalConstraints.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        )}
                        {(selectedNode.implementationGuide.successRate !== undefined || selectedNode.implementationGuide.implementationsCount !== undefined) && (
                          <div className="flex gap-4">
                            {selectedNode.implementationGuide.successRate !== undefined && (
                              <div className="text-center">
                                <p className="text-lg font-black text-emerald-500">{selectedNode.implementationGuide.successRate}%</p>
                                <p className="text-[8px] font-bold uppercase text-zinc-500">Éxito</p>
                              </div>
                            )}
                            {selectedNode.implementationGuide.implementationsCount !== undefined && (
                              <div className="text-center">
                                <p className="text-lg font-black text-blue-500">{selectedNode.implementationGuide.implementationsCount}</p>
                                <p className="text-[8px] font-bold uppercase text-zinc-500">Implementaciones</p>
                              </div>
                            )}
                          </div>
                        )}
                        {selectedNode.implementationGuide.contextualNotes && (
                          <p className="text-[10px] italic text-zinc-500">{selectedNode.implementationGuide.contextualNotes}</p>
                        )}
                      </div>
                    )}

                    {editingGuide && (
                      <div className="space-y-5">
                        {/* Steps */}
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1"><CheckSquare className="w-3 h-3" /> Pasos de implementación</p>
                          <div className="space-y-2">
                            {editingGuide.steps.map((step, i) => (
                              <div key={i} className="flex gap-2">
                                <span className="text-[9px] font-black text-zinc-500 mt-2 min-w-[16px]">{i + 1}.</span>
                                <input
                                  className="flex-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                  value={step}
                                  onChange={e => {
                                    const next = [...editingGuide.steps];
                                    next[i] = e.target.value;
                                    updateGuideField('steps', next);
                                  }}
                                />
                                <button onClick={() => updateGuideField('steps', editingGuide.steps.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500 transition-colors">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => updateGuideField('steps', [...editingGuide.steps, ''])}
                              className="text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-400 flex items-center gap-1 transition-colors"
                            >
                              <Plus className="w-3 h-3" /> Agregar paso
                            </button>
                          </div>
                        </div>

                        {/* Technical Specs */}
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1"><Wrench className="w-3 h-3" /> Especificaciones técnicas</p>
                          <div className="space-y-2">
                            {editingGuide.technicalSpecs.map((spec, i) => (
                              <div key={i} className="grid grid-cols-5 gap-1 items-center">
                                <input placeholder="Clave" className="col-span-2 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                  value={spec.key}
                                  onChange={e => { const next = [...editingGuide.technicalSpecs]; next[i] = { ...next[i], key: e.target.value }; updateGuideField('technicalSpecs', next); }}
                                />
                                <input placeholder="Valor" className="col-span-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                  value={spec.value}
                                  onChange={e => { const next = [...editingGuide.technicalSpecs]; next[i] = { ...next[i], value: e.target.value }; updateGuideField('technicalSpecs', next); }}
                                />
                                <input placeholder="Unidad" className="col-span-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                  value={spec.unit ?? ''}
                                  onChange={e => { const next = [...editingGuide.technicalSpecs]; next[i] = { ...next[i], unit: e.target.value }; updateGuideField('technicalSpecs', next); }}
                                />
                                <button onClick={() => updateGuideField('technicalSpecs', editingGuide.technicalSpecs.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500 transition-colors flex justify-center">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => updateGuideField('technicalSpecs', [...editingGuide.technicalSpecs, { key: '', value: '', unit: '' }])}
                              className="text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-400 flex items-center gap-1 transition-colors"
                            >
                              <Plus className="w-3 h-3" /> Agregar especificación
                            </button>
                          </div>
                        </div>

                        {/* Required Equipment */}
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2">Equipamiento requerido</p>
                          <div className="space-y-2">
                            {editingGuide.requiredEquipment.map((eq, i) => (
                              <div key={i} className="grid grid-cols-5 gap-1 items-center">
                                <input placeholder="Nombre" className="col-span-2 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                  value={eq.name}
                                  onChange={e => { const next = [...editingGuide.requiredEquipment]; next[i] = { ...next[i], name: e.target.value }; updateGuideField('requiredEquipment', next); }}
                                />
                                <input placeholder="Norma" className="col-span-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                  value={eq.standard ?? ''}
                                  onChange={e => { const next = [...editingGuide.requiredEquipment]; next[i] = { ...next[i], standard: e.target.value }; updateGuideField('requiredEquipment', next); }}
                                />
                                <input type="number" placeholder="Cant." className="col-span-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                  value={eq.quantity ?? ''}
                                  onChange={e => { const next = [...editingGuide.requiredEquipment]; next[i] = { ...next[i], quantity: e.target.value ? Number(e.target.value) : undefined }; updateGuideField('requiredEquipment', next); }}
                                />
                                <button onClick={() => updateGuideField('requiredEquipment', editingGuide.requiredEquipment.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500 transition-colors flex justify-center">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => updateGuideField('requiredEquipment', [...editingGuide.requiredEquipment, { name: '' }])}
                              className="text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-400 flex items-center gap-1 transition-colors"
                            >
                              <Plus className="w-3 h-3" /> Agregar equipo
                            </button>
                          </div>
                        </div>

                        {/* Environmental Constraints */}
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Restricciones ambientales</p>
                          <div className="space-y-2">
                            {editingGuide.environmentalConstraints.map((c, i) => (
                              <div key={i} className="flex gap-2">
                                <input
                                  className="flex-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                  value={c}
                                  onChange={e => { const next = [...editingGuide.environmentalConstraints]; next[i] = e.target.value; updateGuideField('environmentalConstraints', next); }}
                                />
                                <button onClick={() => updateGuideField('environmentalConstraints', editingGuide.environmentalConstraints.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500 transition-colors">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => updateGuideField('environmentalConstraints', [...editingGuide.environmentalConstraints, ''])}
                              className="text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-400 flex items-center gap-1 transition-colors"
                            >
                              <Plus className="w-3 h-3" /> Agregar restricción
                            </button>
                          </div>
                        </div>

                        {/* Success rate + count + notes */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500 block mb-1">% Éxito</label>
                            <input type="number" min={0} max={100}
                              className="w-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                              value={editingGuide.successRate ?? ''}
                              onChange={e => updateGuideField('successRate', e.target.value ? Number(e.target.value) : undefined)}
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500 block mb-1">N° Implementaciones</label>
                            <input type="number" min={0}
                              className="w-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                              value={editingGuide.implementationsCount ?? ''}
                              onChange={e => updateGuideField('implementationsCount', e.target.value ? Number(e.target.value) : undefined)}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500 block mb-1">Notas contextuales</label>
                          <textarea rows={3}
                            className="w-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none"
                            value={editingGuide.contextualNotes ?? ''}
                            onChange={e => updateGuideField('contextualNotes', e.target.value)}
                          />
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                          <button
                            onClick={handleSaveGuide}
                            disabled={isSavingGuide}
                            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-400 text-white transition-colors disabled:opacity-50"
                          >
                            {isSavingGuide ? <Loader2 className="w-3 h-3 animate-spin" /> : guideSaved ? <ShieldCheck className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                            {guideSaved ? 'Guardado' : 'Guardar Guía'}
                          </button>
                          <button
                            onClick={() => setEditingGuide(null)}
                            className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

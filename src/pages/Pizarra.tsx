import React, { useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Plus, Network, Lightbulb, Tag, X, Save, Loader2, PanelRightClose, PanelRightOpen
} from 'lucide-react';
// Sprint 29 Bucket BB H24 — lazy split: KnowledgeGraph pulls
// react-force-graph-2d/3d (~1MB combined) and three.js. Defer until
// the user actually opens the Pizarra view.
const KnowledgeGraph = lazy(() =>
  import('../components/shared/KnowledgeGraph').then((m) => ({ default: m.KnowledgeGraph })),
);
import { SmartConnectionsPanel } from '../components/knowledge/SmartConnectionsPanel';
import { EmptyState } from '../components/shared/EmptyState';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useProject } from '../contexts/ProjectContext';
import { NodeType } from '../types';
import { getNodeBgClass } from '../utils/nodeTypeUtils';

const QUICK_NODE_TYPES: { type: NodeType; label: string }[] = [
  { type: NodeType.RISK,          label: 'Riesgo' },
  { type: NodeType.CONTROL,       label: 'Control' },
  { type: NodeType.LESSON_LEARNED,label: 'Lección Aprendida' },
  { type: NodeType.BEST_PRACTICE, label: 'Buena Práctica' },
  { type: NodeType.TRAINING,      label: 'Capacitación' },
  { type: NodeType.NORMATIVE,     label: 'Normativa' },
  { type: NodeType.INCIDENT,      label: 'Incidente' },
  { type: NodeType.FINDING,       label: 'Hallazgo' },
];

interface NewNodeForm {
  title: string;
  description: string;
  type: NodeType;
  tags: string;
}

const EMPTY_FORM: NewNodeForm = {
  title: '',
  description: '',
  type: NodeType.LESSON_LEARNED,
  tags: '',
};

export function Pizarra() {
  const { t } = useTranslation();
  const { addNode } = useRiskEngine();
  const { nodes } = useUniversalKnowledge();
  const { selectedProject } = useProject();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewNodeForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const handleSave = async () => {
    if (!form.title.trim() || !selectedProject) return;
    setSaving(true);
    try {
      await addNode({
        title: form.title.trim(),
        description: form.description.trim(),
        type: form.type,
        projectId: selectedProject.id,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        connections: [],
        metadata: {},
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  // Counts
  const totalNodes = nodes.length;
  const lessonNodes = nodes.filter(n => n.type === NodeType.LESSON_LEARNED).length;
  const bestPractices = nodes.filter(n => n.type === NodeType.BEST_PRACTICE).length;
  const orphans = nodes.filter(n => n.connections.length === 0).length;

  return (
    <div className="flex flex-col h-full min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/5 bg-zinc-900/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <LayoutDashboard className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-black uppercase tracking-tighter text-white">{t('pizarra.title', 'Pizarra')}</h1>
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Red de Conocimiento Colaborativa</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Stats pills */}
          <div className="hidden sm:flex items-center gap-2">
            {[
              { label: 'Nodos', value: totalNodes, color: 'text-indigo-400' },
              { label: 'Lecciones', value: lessonNodes, color: 'text-emerald-400' },
              { label: 'Buenas Prácticas', value: bestPractices, color: 'text-amber-400' },
              { label: 'Sin conexión', value: orphans, color: 'text-rose-400' },
            ].map(s => (
              <div key={s.label} className="px-2.5 py-1 bg-zinc-800/80 rounded-lg border border-white/5 text-center">
                <p className={`text-sm font-black ${s.color}`}>{s.value}</p>
                <p className="text-[8px] text-zinc-500 uppercase tracking-widest">{s.label}</p>
              </div>
            ))}
          </div>

          <AnimatePresence>
            {savedFlash && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs text-emerald-400 font-bold"
              >
                ✓ Guardado
              </motion.span>
            )}
          </AnimatePresence>

          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nuevo nodo
          </button>
        </div>
      </div>

      {/* New node form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/5 bg-zinc-900/60 shrink-0"
          >
            <div className="px-4 sm:px-6 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Type selector */}
              <div>
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Tipo</label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_NODE_TYPES.map(({ type, label }) => (
                    <button
                      key={type}
                      onClick={() => setForm(f => ({ ...f, type }))}
                      className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider text-white transition-all ${
                        form.type === type
                          ? `${getNodeBgClass(type)} ring-2 ring-white/30`
                          : 'bg-zinc-800 hover:bg-zinc-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Título *</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder={t('pizarra.titlePlaceholder', 'Ej: Uso de doble guante en ácidos...')}
                  className="w-full bg-zinc-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Descripción</label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder={t('pizarra.descPlaceholder', 'Detalle del conocimiento...')}
                  className="w-full bg-zinc-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              {/* Tags + actions */}
              <div className="flex flex-col gap-2">
                <div>
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">
                    <Tag className="w-3 h-3 inline mr-1" />Tags (coma)
                  </label>
                  <input
                    value={form.tags}
                    onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                    placeholder={t('pizarra.tagsPlaceholder', 'seguridad, químicos, DS 594')}
                    className="w-full bg-zinc-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-xl text-xs font-bold transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Cancelar
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!form.title.trim() || saving}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black disabled:opacity-40 transition-colors"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main: graph + smart panel */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Knowledge graph */}
        <div className="flex-1 overflow-hidden">
          {totalNodes === 0 ? (
            <EmptyState
              mascot
              title="Red de conocimiento vacía"
              description="Crea tu primer nodo para comenzar a mapear riesgos, lecciones y buenas prácticas."
              action={{ label: 'Nuevo nodo', onClick: () => setShowForm(true) }}
            />
          ) : (
            <Suspense fallback={
              <div className="w-full h-[600px] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              </div>
            }>
              <KnowledgeGraph />
            </Suspense>
          )}
        </div>

        {/* Toggle button (mobile) */}
        <button
          onClick={() => setShowPanel(v => !v)}
          aria-label={showPanel ? 'Cerrar panel de conexiones' : 'Abrir panel de conexiones inteligentes'}
          className="sm:hidden absolute bottom-4 right-4 z-20 p-3 bg-amber-500 text-white rounded-2xl shadow-lg"
        >
          {showPanel ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
        </button>

        {/* Smart connections side panel — always visible on sm+, toggleable on mobile */}
        <AnimatePresence>
          {showPanel && (
            <motion.div
              initial={false}
              className={`${showPanel ? 'flex' : 'hidden'} sm:flex flex-col w-72 shrink-0 border-l border-white/5 overflow-y-auto bg-zinc-900/40 absolute sm:relative inset-y-0 right-0 z-10`}
            >
              <div className="p-3 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Conexiones Inteligentes</span>
                </div>
              </div>
              <SmartConnectionsPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardCheck,
  Plus,
  Search,
  Filter,
  Calendar,
  User,
  Shield,
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronRight,
  FileText,
  Target,
  Award,
  ChevronDown,
  Save,
  RefreshCw,
  BarChart3,
  AlertCircle
} from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType, RiskNode } from '../../types';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { AddAuditModal } from './AddAuditModal';
import { AuditDetailModal } from './AuditDetailModal';

// ---------------------------------------------------------------------------
// ISO 45001 conditional checklist definition
// ---------------------------------------------------------------------------

type Answer = 'Si' | 'Parcial' | 'No' | null;

interface ISOQuestion {
  id: string;
  clause: string;
  text: string;
  showWhen?: { parentId: string; answers: Answer[] };
  weight?: number;
}

const ISO_QUESTIONS: ISOQuestion[] = [
  // Clause 4 — Contexto
  { id: '4.1', clause: '4.1', text: 'La organización ha determinado los factores externos e internos que son pertinentes para su propósito.', weight: 1 },
  { id: '4.1a', clause: '4.1', text: '¿Se han identificado factores negativos (amenazas) específicos para la seguridad y salud en el trabajo?', showWhen: { parentId: '4.1', answers: ['Parcial', 'No'] }, weight: 1 },
  { id: '4.2', clause: '4.2', text: 'Se han identificado las partes interesadas pertinentes al SGSST y sus necesidades y expectativas.', weight: 1 },
  { id: '4.2a', clause: '4.2', text: '¿Están documentadas las partes interesadas y sus requisitos legales o voluntarios aplicables?', showWhen: { parentId: '4.2', answers: ['Parcial', 'No'] }, weight: 1 },
  { id: '4.3', clause: '4.3', text: 'El alcance del SGSST está determinado y disponible como información documentada.', weight: 1 },
  // Clause 5 — Liderazgo
  { id: '5.1', clause: '5.1', text: 'La alta dirección demuestra liderazgo y compromiso con el SGSST.', weight: 2 },
  { id: '5.1a', clause: '5.1', text: '¿La dirección participa activamente en investigaciones de incidentes y revisiones del sistema?', showWhen: { parentId: '5.1', answers: ['Parcial', 'No'] }, weight: 1 },
  { id: '5.2', clause: '5.2', text: 'Existe una política de SST documentada, comunicada y disponible para todas las partes interesadas.', weight: 2 },
  { id: '5.4', clause: '5.4', text: 'Los trabajadores participan en el desarrollo, planificación e implementación del SGSST.', weight: 2 },
  { id: '5.4a', clause: '5.4', text: '¿Existe un mecanismo formal para que los trabajadores reporten peligros sin temor a represalias?', showWhen: { parentId: '5.4', answers: ['Parcial', 'No'] }, weight: 1 },
  // Clause 6 — Planificación
  { id: '6.1', clause: '6.1', text: 'Se identifican y evalúan peligros y riesgos para la SST de forma sistemática (IPERC).', weight: 3 },
  { id: '6.1a', clause: '6.1', text: '¿El proceso de identificación de peligros considera actividades rutinarias, no rutinarias y emergencias?', showWhen: { parentId: '6.1', answers: ['Parcial', 'No'] }, weight: 1 },
  { id: '6.1b', clause: '6.1', text: '¿Se incluyen los factores psicosociales (estrés, acoso, carga mental) en la evaluación de riesgos?', showWhen: { parentId: '6.1', answers: ['Parcial', 'No'] }, weight: 1 },
  { id: '6.2', clause: '6.2', text: 'Los objetivos de SST son medibles, coherentes con la política y se realiza seguimiento de su cumplimiento.', weight: 2 },
  // Clause 7 — Apoyo
  { id: '7.2', clause: '7.2', text: 'Los trabajadores tienen la competencia necesaria (educación, formación, experiencia) para sus tareas.', weight: 2 },
  { id: '7.2a', clause: '7.2', text: '¿Están documentadas las brechas de competencia identificadas y los planes de capacitación asociados?', showWhen: { parentId: '7.2', answers: ['Parcial', 'No'] }, weight: 1 },
  { id: '7.3', clause: '7.3', text: 'Los trabajadores son conscientes de la política SST, los peligros relevantes y sus consecuencias.', weight: 2 },
  { id: '7.4', clause: '7.4', text: 'Existen procesos de comunicación interna y externa sobre el SGSST.', weight: 1 },
  // Clause 8 — Operación
  { id: '8.1', clause: '8.1', text: 'Se planifican, implementan y controlan los procesos necesarios para cumplir los requisitos del SGSST.', weight: 2 },
  { id: '8.1a', clause: '8.1', text: '¿Están implementados controles para todos los riesgos clasificados como "Alto" o "Crítico"?', showWhen: { parentId: '8.1', answers: ['Parcial', 'No'] }, weight: 2 },
  { id: '8.2', clause: '8.2', text: 'La organización está preparada para responder ante situaciones de emergencia potenciales.', weight: 3 },
  { id: '8.2a', clause: '8.2', text: '¿Se realizan simulacros de emergencia al menos una vez al año y se documentan las lecciones aprendidas?', showWhen: { parentId: '8.2', answers: ['Parcial', 'No'] }, weight: 1 },
  { id: '8.6', clause: '8.6', text: 'Existen controles para la adquisición de productos, equipos y servicios con impacto en SST.', weight: 1 },
  // Clause 9 — Evaluación del desempeño
  { id: '9.1', clause: '9.1', text: 'Se realiza seguimiento, medición y evaluación del desempeño del SGSST con indicadores definidos.', weight: 2 },
  { id: '9.1a', clause: '9.1', text: '¿Los indicadores incluyen tanto métricas reactivas (accidentes) como proactivas (inspecciones, capacitaciones)?', showWhen: { parentId: '9.1', answers: ['Parcial', 'No'] }, weight: 1 },
  { id: '9.2', clause: '9.2', text: 'Se realizan auditorías internas a intervalos planificados para evaluar el SGSST.', weight: 2 },
  { id: '9.3', clause: '9.3', text: 'La alta dirección revisa el SGSST a intervalos planificados para asegurar su conveniencia.', weight: 2 },
  // Clause 10 — Mejora
  { id: '10.1', clause: '10.1', text: 'Se determinan oportunidades de mejora y se implementan acciones necesarias.', weight: 1 },
  { id: '10.2', clause: '10.2', text: 'Se investigan los incidentes y no conformidades para determinar causas raíz e implementar acciones correctivas.', weight: 3 },
  { id: '10.2a', clause: '10.2', text: '¿Las investigaciones de incidentes involucran a los trabajadores afectados y representantes de SST?', showWhen: { parentId: '10.2', answers: ['Parcial', 'No'] }, weight: 1 },
  { id: '10.3', clause: '10.3', text: 'La organización mejora continuamente la idoneidad, adecuación y eficacia del SGSST.', weight: 2 },
];

const CLAUSES = [
  { id: '4', label: 'Cl. 4 — Contexto' },
  { id: '5', label: 'Cl. 5 — Liderazgo' },
  { id: '6', label: 'Cl. 6 — Planificación' },
  { id: '7', label: 'Cl. 7 — Apoyo' },
  { id: '8', label: 'Cl. 8 — Operación' },
  { id: '9', label: 'Cl. 9 — Evaluación' },
  { id: '10', label: 'Cl. 10 — Mejora' },
];

function answerScore(a: Answer, weight = 1): number {
  if (a === 'Si') return weight;
  if (a === 'Parcial') return weight * 0.5;
  return 0;
}

function getComplianceColor(pct: number) {
  if (pct >= 80) return 'text-emerald-500';
  if (pct >= 60) return 'text-amber-500';
  return 'text-rose-500';
}
function getComplianceBg(pct: number) {
  if (pct >= 80) return 'bg-emerald-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-rose-500';
}

// ---------------------------------------------------------------------------
// Checklist component
// ---------------------------------------------------------------------------

function ISOChecklist() {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [openClause, setOpenClause] = useState<string>('4');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();
  const { user } = useFirebase();

  const visibleQuestions = ISO_QUESTIONS.filter(q => {
    if (!q.showWhen) return true;
    const parentAnswer = answers[q.showWhen.parentId];
    return q.showWhen.answers.includes(parentAnswer);
  });

  const totalWeight = visibleQuestions.reduce((s, q) => s + (q.weight ?? 1), 0);
  const earnedWeight = visibleQuestions.reduce((s, q) => s + answerScore(answers[q.id], q.weight ?? 1), 0);
  const compliancePct = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  const answeredCount = visibleQuestions.filter(q => answers[q.id] !== undefined && answers[q.id] !== null).length;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await addNode({
        type: NodeType.AUDIT,
        title: `Auditoría ISO 45001 — ${compliancePct}% cumplimiento`,
        description: `Inspección ISO 45001 realizada por ${user?.displayName || user?.email || 'Usuario'}. Preguntas respondidas: ${answeredCount}/${visibleQuestions.length}.`,
        tags: ['ISO', 'ISO 45001', 'Auditoría', 'SGSST'],
        metadata: {
          status: 'Completada',
          score: compliancePct,
          auditor: user?.displayName || user?.email,
          date: new Date().toISOString(),
          answers,
          answeredCount,
          totalQuestions: visibleQuestions.length,
        },
        connections: [],
        projectId: selectedProject?.id,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setSaveError('Error al guardar la auditoría. Verifica tu conexión e intenta nuevamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Score header */}
      <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl p-4 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Cumplimiento ISO 45001</p>
            <p className={`text-3xl font-black tracking-tighter ${getComplianceColor(compliancePct)}`}>{compliancePct}%</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Progreso</p>
            <p className="text-sm font-black text-zinc-700 dark:text-zinc-300">{answeredCount} / {visibleQuestions.length}</p>
          </div>
        </div>
        <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${getComplianceBg(compliancePct)}`}
            initial={{ width: 0 }}
            animate={{ width: `${compliancePct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        <div className="flex flex-col items-end gap-2 mt-3">
          {saveError && (
            <p className="text-[10px] font-bold text-rose-500 text-right max-w-xs">{saveError}</p>
          )}
          <div className="flex gap-2">
            {saveError && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Reintentar
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || answeredCount === 0}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? <CheckCircle2 className="w-3 h-3" /> : <Save className="w-3 h-3" />}
              {saved ? 'Guardado ✓' : 'Guardar Auditoría'}
            </button>
          </div>
        </div>
      </div>

      {/* Clause accordion */}
      {CLAUSES.map(clause => {
        const clauseQs = visibleQuestions.filter(q => q.id.startsWith(clause.id));
        const clauseAnswered = clauseQs.filter(q => answers[q.id] != null).length;
        const clauseTotal = clauseQs.length;
        const clauseWeight = clauseQs.reduce((s, q) => s + (q.weight ?? 1), 0);
        const clauseEarned = clauseQs.reduce((s, q) => s + answerScore(answers[q.id], q.weight ?? 1), 0);
        const clausePct = clauseWeight > 0 ? Math.round((clauseEarned / clauseWeight) * 100) : 0;
        const isOpen = openClause === clause.id;

        return (
          <div key={clause.id} className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm overflow-hidden">
            <button
              onClick={() => setOpenClause(isOpen ? '' : clause.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-tight">{clause.label}</span>
                <span className="text-[9px] font-bold text-zinc-500">{clauseAnswered}/{clauseTotal}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-black ${getComplianceColor(clausePct)}`}>{clauseAnswered > 0 ? `${clausePct}%` : '—'}</span>
                <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>

            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-3">
                    {clauseQs.map(q => (
                      <motion.div
                        key={q.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`rounded-xl p-3 border transition-colors ${
                          q.showWhen
                            ? 'ml-4 bg-amber-50/60 dark:bg-amber-500/5 border-amber-200/50 dark:border-amber-500/20'
                            : 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200/50 dark:border-zinc-700/50'
                        }`}
                      >
                        <div className="flex items-start gap-2 mb-2">
                          {q.showWhen && <AlertCircle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />}
                          <p className="text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed flex-1">{q.text}</p>
                          {(q.weight ?? 1) >= 3 && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[8px] font-black uppercase tracking-wider">Crítico</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {(['Si', 'Parcial', 'No'] as const).map(opt => (
                            <button
                              key={opt}
                              onClick={() => setAnswers(prev => ({ ...prev, [q.id]: prev[q.id] === opt ? null : opt }))}
                              className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${
                                answers[q.id] === opt
                                  ? opt === 'Si' ? 'bg-emerald-500 border-emerald-500 text-white'
                                    : opt === 'Parcial' ? 'bg-amber-500 border-amber-500 text-white'
                                    : 'bg-rose-500 border-rose-500 text-white'
                                  : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-400'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ISOAudit component
// ---------------------------------------------------------------------------

export function ISOAudit() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<RiskNode | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState<'history' | 'checklist'>('history');
  const { nodes, loading } = useRiskEngine();
  const { selectedProject } = useProject();

  const isoAudits = nodes.filter(n =>
    n.type === NodeType.AUDIT &&
    n.tags.some(t => t.includes('ISO')) &&
    (!selectedProject || n.projectId === selectedProject.id) &&
    (n.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
     (n.description || '').toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const stats = {
    total: isoAudits.length,
    planned: isoAudits.filter(a => a.metadata.status === 'Planificada').length,
    completed: isoAudits.filter(a => a.metadata.status === 'Completada' || a.metadata.status === 'Completado').length,
    avgScore: isoAudits.length > 0
      ? (isoAudits.reduce((acc, a) => acc + (a.metadata.score || 0), 0) / isoAudits.length).toFixed(1)
      : 0
  };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total ISO', value: stats.total, icon: Award, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
          { label: 'Planificadas', value: stats.planned, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Completadas', value: stats.completed, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Puntaje Prom.', value: `${stats.avgScore}%`, icon: Target, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl p-3 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm"
          >
            <div className={`w-7 h-7 rounded-lg ${stat.bg} flex items-center justify-center mb-2`}>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">{stat.label}</p>
            <p className="text-xl font-black text-zinc-900 dark:text-white tracking-tighter">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex gap-2 items-center">
        <div className="flex bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-xl">
          <button
            onClick={() => setView('history')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              view === 'history' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            <FileText className="w-3 h-3 inline mr-1.5" />Historial
          </button>
          <button
            onClick={() => setView('checklist')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              view === 'checklist' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            <BarChart3 className="w-3 h-3 inline mr-1.5" />Inspección ISO 45001
          </button>
        </div>

        {view === 'history' && (
          <>
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar auditorías ISO..."
                className="w-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-zinc-200/50 dark:border-zinc-800/50 rounded-xl pl-11 pr-4 py-2.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
              />
            </div>
            <button className="p-2.5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-zinc-200/50 dark:border-zinc-800/50 rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
              <Filter className="w-4 h-4" />
            </button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsModalOpen(true)}
              className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 transition-colors group"
            >
              <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Planificar ISO</span>
            </motion.button>
          </>
        )}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {view === 'checklist' ? (
          <motion.div key="checklist" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ISOChecklist />
          </motion.div>
        ) : (
          <motion.div key="history" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sincronizando Auditorías ISO...</p>
              </div>
            ) : isoAudits.length > 0 ? (
              isoAudits.map((audit, i) => (
                <motion.div
                  key={audit.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => setSelectedAudit(audit)}
                  className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl p-4 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm group hover:border-indigo-500/30 transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest bg-indigo-500 text-white">
                          {audit.tags.find(t => t.includes('ISO')) || 'ISO'}
                        </span>
                        <span className={`text-[8px] font-black uppercase tracking-widest ${
                          audit.metadata.status === 'Completada' || audit.metadata.status === 'Completado' ? 'text-emerald-500' : 'text-amber-500'
                        }`}>
                          {audit.metadata.status}
                        </span>
                      </div>
                      <h3 className="text-sm font-black text-zinc-950 dark:text-white uppercase tracking-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {audit.title}
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                        {audit.description}
                      </p>
                      <div className="flex items-center gap-4 pt-1">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3 text-zinc-400" />
                          <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">{audit.metadata.auditor || 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-zinc-400" />
                          <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">
                            {audit.metadata.date ? new Date(audit.metadata.date).toLocaleDateString('es-CL') : 'Sin fecha'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-3">
                      <div className="text-right">
                        <p className="text-[10px] font-black text-zinc-900 dark:text-white tracking-tighter">{audit.metadata.score || 0}%</p>
                        <p className="text-[7px] font-bold text-zinc-400 uppercase tracking-widest">Cumplimiento</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-12 bg-white/50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
                <Award className="w-12 h-12 text-zinc-200 dark:text-zinc-700 mx-auto mb-4" />
                <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest">No hay auditorías ISO programadas</p>
                <p className="text-[10px] text-zinc-400 mt-1">Usa "Inspección ISO 45001" para iniciar tu primera auditoría interactiva</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AddAuditModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialType="Certificación"
      />

      <AuditDetailModal
        audit={selectedAudit}
        isOpen={!!selectedAudit}
        onClose={() => setSelectedAudit(null)}
      />
    </div>
  );
}

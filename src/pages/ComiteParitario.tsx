import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAutoCalendarEvents } from '../hooks/useAutoCalendarEvents';
import {
  Users,
  FileText,
  CheckCircle,
  Clock,
  Plus,
  X,
  Calendar as CalendarIcon,
  AlertTriangle,
  ShieldCheck,
  Loader2,
  ClipboardList,
  Wand2,
  ListChecks
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { scanLegalUpdates, suggestMeetingAgenda, summarizeAgreements } from '../services/geminiService';
import { db } from '../services/firebase';
import { collection, addDoc, doc, updateDoc, arrayUnion } from 'firebase/firestore';

interface Acta {
  id: string;
  fecha: string;
  tipo: 'Ordinaria' | 'Extraordinaria';
  asistentes: string[];
  acuerdos: Acuerdo[];
}

interface Acuerdo {
  id: string;
  descripcion: string;
  responsable: string;
  fechaPlazo: string;
  estado: 'Pendiente' | 'En Progreso' | 'Completado';
}

export function ComiteParitario() {
  const { selectedProject } = useProject();
  const [activeTab, setActiveTab] = useState<'actas' | 'acuerdos'>('actas');
  useAutoCalendarEvents();
  const [legalScanResult, setLegalScanResult] = useState<any>(null);
  const [legalScanning, setLegalScanning] = useState(false);
  const [showAddActa, setShowAddActa] = useState(false);
  const [actaSaving, setActaSaving] = useState(false);
  const [actaForm, setActaForm] = useState({
    fecha: new Date().toISOString().split('T')[0],
    tipo: 'Ordinaria' as 'Ordinaria' | 'Extraordinaria',
    asistentesRaw: '',
  });

  const [addAcuerdoActaId, setAddAcuerdoActaId] = useState<string | null>(null);
  const [acuerdoSaving, setAcuerdoSaving] = useState(false);
  const [acuerdoForm, setAcuerdoForm] = useState({ descripcion: '', responsable: '', fechaPlazo: '' });

  const handleAddActa = async () => {
    if (!selectedProject) return;
    const asistentes = actaForm.asistentesRaw
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    if (!actaForm.fecha || asistentes.length === 0) return;
    setActaSaving(true);
    try {
      await addDoc(collection(db, `projects/${selectedProject.id}/comite_actas`), {
        fecha: actaForm.fecha,
        tipo: actaForm.tipo,
        asistentes,
        acuerdos: [],
        createdAt: new Date().toISOString(),
      });
      setShowAddActa(false);
      setActaForm({ fecha: new Date().toISOString().split('T')[0], tipo: 'Ordinaria', asistentesRaw: '' });
    } catch {
      // error handled silently — optimistic UI stays open
    } finally {
      setActaSaving(false);
    }
  };

  const handleAddAcuerdo = async (actaId: string) => {
    if (!selectedProject || !acuerdoForm.descripcion.trim() || !acuerdoForm.responsable.trim() || !acuerdoForm.fechaPlazo) return;
    setAcuerdoSaving(true);
    try {
      const newAcuerdo: Acuerdo = {
        id: crypto.randomUUID(),
        descripcion: acuerdoForm.descripcion.trim(),
        responsable: acuerdoForm.responsable.trim(),
        fechaPlazo: acuerdoForm.fechaPlazo,
        estado: 'Pendiente',
      };
      await updateDoc(doc(db, `projects/${selectedProject.id}/comite_actas`, actaId), {
        acuerdos: arrayUnion(newAcuerdo),
      });
      setAddAcuerdoActaId(null);
      setAcuerdoForm({ descripcion: '', responsable: '', fechaPlazo: '' });
    } catch {
      // silent — form stays open so user can retry
    } finally {
      setAcuerdoSaving(false);
    }
  };

  const handleUpdateAcuerdoEstado = async (actaId: string, acuerdoId: string, newEstado: Acuerdo['estado']) => {
    if (!selectedProject) return;
    const acta = actas?.find(a => a.id === actaId);
    if (!acta) return;
    const updatedAcuerdos = acta.acuerdos.map(a =>
      a.id === acuerdoId ? { ...a, estado: newEstado } : a
    );
    await updateDoc(doc(db, `projects/${selectedProject.id}/comite_actas`, actaId), {
      acuerdos: updatedAcuerdos,
    });
  };

  const [agendaResult, setAgendaResult] = useState<any>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [meetingNotes, setMeetingNotes] = useState('');
  const [summaryResult, setSummaryResult] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const { data: actas, loading } = useFirestoreCollection<Acta>(
    selectedProject ? `projects/${selectedProject.id}/comite_actas` : null
  );

  const todosLosAcuerdos = actas?.flatMap(acta =>
    acta.acuerdos.map(a => ({ ...a, actaId: acta.id }))
  ) || [];

  const runLegalScan = async () => {
    setLegalScanning(true);
    try {
      const result = await scanLegalUpdates(
        'DS 594 — Condiciones Sanitarias y Ambientales',
        'Actualización de límites de exposición a ruido y agentes químicos en ambientes laborales.',
        'Módulos: EPP, Matriz IPER, Auditorías, Capacitaciones, CPHS, Hallazgos'
      );
      setLegalScanResult(result);
    } catch {
      setLegalScanResult({ affected: false, impactLevel: 'Sin impacto', affectedModules: [], summary: 'No se pudo conectar con el servicio.', recommendedAction: 'Verificar conexión.' });
    } finally {
      setLegalScanning(false);
    }
  };

  const runAgendaSuggestion = async () => {
    setAgendaLoading(true);
    try {
      const pending = todosLosAcuerdos.filter(a => a.estado === 'Pendiente');
      const result = await suggestMeetingAgenda([], pending);
      setAgendaResult(result);
    } catch {
      setAgendaResult(null);
    } finally {
      setAgendaLoading(false);
    }
  };

  const runSummarize = async () => {
    if (!meetingNotes.trim()) return;
    setSummaryLoading(true);
    try {
      const result = await summarizeAgreements(meetingNotes);
      setSummaryResult(result);
    } catch {
      setSummaryResult(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">
            Comité Paritario
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Gestión DS 54 - Actas y Acuerdos
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddActa(true)}
            className="bg-zinc-900 dark:bg-white text-white dark:text-black px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-xl flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Acta</span>
          </button>
        </div>
      </div>

      {/* Tabs — WCAG 4.1.2 (A11Y-012, 13th wave). Implements the
          ARIA tablist pattern with roving tabindex + arrow-key cycling
          (ArrowLeft/Right + Home/End) so SR users hear "selected, tab N
          of 2" instead of just "button" and keyboard users can move
          between tabs without first tabbing through the rest of the
          panel. */}
      <div
        role="tablist"
        aria-label="Vistas del comité paritario"
        className="flex gap-4 border-b border-zinc-200 dark:border-white/10 pb-4"
        onKeyDown={(e) => {
          // Roving-tabindex arrow handler. Cycle through the two tabs;
          // Home/End jump to first/last (matches ARIA APG tablist).
          const order: Array<'actas' | 'acuerdos'> = ['actas', 'acuerdos'];
          const currentIdx = order.indexOf(activeTab);
          let nextIdx = currentIdx;
          if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % order.length;
          else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + order.length) % order.length;
          else if (e.key === 'Home') nextIdx = 0;
          else if (e.key === 'End') nextIdx = order.length - 1;
          else return;
          e.preventDefault();
          setActiveTab(order[nextIdx]);
          // Move focus to the newly selected tab so the screen reader
          // re-announces selection state.
          const next = e.currentTarget.querySelector<HTMLButtonElement>(
            `[data-tab-id="${order[nextIdx]}"]`,
          );
          next?.focus();
        }}
      >
        <button
          role="tab"
          id="comite-tab-actas"
          data-tab-id="actas"
          aria-selected={activeTab === 'actas'}
          aria-controls="comite-panel-actas"
          tabIndex={activeTab === 'actas' ? 0 : -1}
          onClick={() => setActiveTab('actas')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'actas'
              ? 'bg-zinc-900 dark:bg-white text-white dark:text-black'
              : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5'
          }`}
        >
          <FileText className="w-4 h-4" aria-hidden="true" />
          Actas de Reunión
        </button>
        <button
          role="tab"
          id="comite-tab-acuerdos"
          data-tab-id="acuerdos"
          aria-selected={activeTab === 'acuerdos'}
          aria-controls="comite-panel-acuerdos"
          tabIndex={activeTab === 'acuerdos' ? 0 : -1}
          onClick={() => setActiveTab('acuerdos')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'acuerdos'
              ? 'bg-zinc-900 dark:bg-white text-white dark:text-black'
              : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5'
          }`}
        >
          <CheckCircle className="w-4 h-4" aria-hidden="true" />
          Seguimiento de Acuerdos
        </button>
      </div>

      {/* Content */}
      <div
        role="tabpanel"
        id={`comite-panel-${activeTab}`}
        aria-labelledby={`comite-tab-${activeTab}`}
        tabIndex={0}
        className="grid gap-6 focus:outline-none"
      >
        {activeTab === 'actas' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {actas?.length === 0 ? (
              <div className="col-span-full text-center py-12 bg-white dark:bg-zinc-900/30 rounded-[2rem] border border-zinc-200 dark:border-white/10">
                <Users className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">No hay actas registradas</h3>
                <p className="text-sm text-zinc-500 mt-2">Comienza creando la primera acta de constitución o reunión ordinaria.</p>
              </div>
            ) : (
              actas?.map(acta => (
                <motion.div
                  key={acta.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white dark:bg-zinc-900/30 p-6 rounded-[2rem] border border-zinc-200 dark:border-white/10 shadow-xl"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2 text-emerald-500">
                      <CalendarIcon className="w-5 h-5" />
                      <span className="text-xs font-bold uppercase tracking-wider">
                        {format(new Date(acta.fecha), "d 'de' MMMM, yyyy", { locale: es })}
                      </span>
                    </div>
                    <span className="px-3 py-1 bg-zinc-100 dark:bg-white/5 rounded-full text-[10px] font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      {acta.tipo}
                    </span>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Asistentes ({acta.asistentes.length})</p>
                      <div className="flex flex-wrap gap-2">
                        {acta.asistentes.slice(0, 3).map((a, i) => (
                          <span key={i} className="text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-white/5 px-2 py-1 rounded-lg">
                            {a}
                          </span>
                        ))}
                        {acta.asistentes.length > 3 && (
                          <span className="text-xs text-zinc-500 px-2 py-1">+{acta.asistentes.length - 3} más</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Acuerdos ({acta.acuerdos.length})</p>
                      <div className="space-y-2">
                        {acta.acuerdos.slice(0, 2).map((acuerdo, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                            <div className={`w-2 h-2 rounded-full ${
                              acuerdo.estado === 'Completado' ? 'bg-emerald-500' :
                              acuerdo.estado === 'En Progreso' ? 'bg-amber-500' : 'bg-red-500'
                            }`} />
                            <span className="truncate">{acuerdo.descripcion}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {addAcuerdoActaId === acta.id ? (
                    <div className="space-y-2 pt-3 border-t border-zinc-100 dark:border-white/5 mt-3">
                      <input
                        type="text"
                        placeholder="Descripción del acuerdo"
                        value={acuerdoForm.descripcion}
                        onChange={e => setAcuerdoForm(f => ({ ...f, descripcion: e.target.value }))}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="Responsable"
                        value={acuerdoForm.responsable}
                        onChange={e => setAcuerdoForm(f => ({ ...f, responsable: e.target.value }))}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500"
                      />
                      <input
                        type="date"
                        value={acuerdoForm.fechaPlazo}
                        min={new Date().toISOString().split('T')[0]}
                        onChange={e => setAcuerdoForm(f => ({ ...f, fechaPlazo: e.target.value }))}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAddAcuerdo(acta.id)}
                          disabled={acuerdoSaving}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {acuerdoSaving ? 'Guardando...' : 'Guardar'}
                        </button>
                        <button
                          onClick={() => { setAddAcuerdoActaId(null); setAcuerdoForm({ descripcion: '', responsable: '', fechaPlazo: '' }); }}
                          className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddAcuerdoActaId(acta.id); setAcuerdoForm({ descripcion: '', responsable: '', fechaPlazo: '' }); }}
                      className="mt-3 w-full flex items-center justify-center gap-1 px-3 py-1.5 border border-dashed border-zinc-300 dark:border-white/10 rounded-xl text-[10px] font-black text-zinc-500 hover:text-emerald-500 hover:border-emerald-500 transition-colors uppercase tracking-widest"
                    >
                      <Plus className="w-3 h-3" />
                      Añadir Acuerdo
                    </button>
                  )}
                </motion.div>
              ))
            )}
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900/30 rounded-[2rem] border border-zinc-200 dark:border-white/10 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-white/10">
                    <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">Descripción</th>
                    <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">Responsable</th>
                    <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">Plazo</th>
                    <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {todosLosAcuerdos.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-zinc-500 text-sm">
                        No hay acuerdos registrados.
                      </td>
                    </tr>
                  ) : (
                    todosLosAcuerdos.map((acuerdo, i) => (
                      <tr key={i} className="border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                        <td className="p-4 text-sm font-medium text-zinc-900 dark:text-white">
                          {acuerdo.descripcion}
                        </td>
                        <td className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
                          {acuerdo.responsable}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                            <Clock className="w-4 h-4" />
                            {format(new Date(acuerdo.fechaPlazo), "d MMM, yyyy", { locale: es })}
                          </div>
                        </td>
                        <td className="p-4">
                          <select
                            value={acuerdo.estado}
                            onChange={e => handleUpdateAcuerdoEstado(acuerdo.actaId, acuerdo.id, e.target.value as Acuerdo['estado'])}
                            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border-0 cursor-pointer focus:outline-none appearance-none ${
                              acuerdo.estado === 'Completado' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                              acuerdo.estado === 'En Progreso' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' :
                              'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                            }`}
                          >
                            <option value="Pendiente">Pendiente</option>
                            <option value="En Progreso">En Progreso</option>
                            <option value="Completado">Completado</option>
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      {/* Escudo Legal — BCN/SUSESO normative scanner */}
      <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-500/10 rounded-xl">
              <ShieldCheck className="w-5 h-5 text-violet-500" />
            </div>
            <div>
              <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">Escudo Legal</h3>
              <p className="text-[10px] text-zinc-500">Escaneo de impacto normativo con IA</p>
            </div>
          </div>
          <button
            onClick={runLegalScan}
            disabled={legalScanning}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-50"
          >
            {legalScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Verificar Normativas
          </button>
        </div>

        <AnimatePresence>
          {legalScanResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
                legalScanResult.affected
                  ? legalScanResult.impactLevel === 'Crítico' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}>
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span className="text-xs font-black uppercase tracking-widest">
                  {legalScanResult.affected ? `Impacto ${legalScanResult.impactLevel}` : 'Sin impacto detectado'}
                </span>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">{legalScanResult.summary}</p>
              {legalScanResult.affectedModules?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {legalScanResult.affectedModules.map((m: string) => (
                    <span key={m} className="px-2 py-1 bg-violet-500/10 border border-violet-500/20 rounded-lg text-[10px] font-bold text-violet-400 uppercase">{m}</span>
                  ))}
                </div>
              )}
              <p className="text-xs text-zinc-500 italic">{legalScanResult.recommendedAction}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {!legalScanResult && !legalScanning && (
          <p className="text-xs text-zinc-500 text-center py-2">
            Analiza si cambios en DS 594, Ley 16.744 u otras normas afectan los módulos del sistema.
          </p>
        )}
      </div>

      {/* Sugerir Agenda IA */}
      <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl">
              <ClipboardList className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">Agenda Sugerida</h3>
              <p className="text-[10px] text-zinc-500">Generada en base a acuerdos pendientes</p>
            </div>
          </div>
          <button
            onClick={runAgendaSuggestion}
            disabled={agendaLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-50"
          >
            {agendaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            Generar Agenda
          </button>
        </div>
        <AnimatePresence>
          {agendaResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
              {(Array.isArray(agendaResult) ? agendaResult : agendaResult.items ?? [agendaResult]).map((item: any, i: number) => (
                <div key={i} className="flex items-start gap-3 px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                  <span className="text-[10px] font-black text-emerald-400 mt-0.5 shrink-0">{i + 1}.</span>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">{typeof item === 'string' ? item : item.punto ?? JSON.stringify(item)}</p>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {!agendaResult && !agendaLoading && (
          <p className="text-xs text-zinc-500 text-center py-2">
            La IA analiza los acuerdos pendientes y propone los puntos de agenda prioritarios.
          </p>
        )}
      </div>

      {/* Resumir Notas de Reunión */}
      <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-blue-500/10 rounded-xl">
            <ListChecks className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">Resumir Notas</h3>
            <p className="text-[10px] text-zinc-500">Extrae acuerdos estructurados de notas en texto libre</p>
          </div>
        </div>
        <textarea
          value={meetingNotes}
          onChange={e => setMeetingNotes(e.target.value)}
          placeholder="Pega aquí las notas de la reunión en texto libre..."
          rows={4}
          className="w-full bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:border-blue-500 resize-none"
        />
        <div className="flex justify-end">
          <button
            onClick={runSummarize}
            disabled={summaryLoading || !meetingNotes.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-50"
          >
            {summaryLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
            Extraer Acuerdos
          </button>
        </div>
        <AnimatePresence>
          {summaryResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
              {(Array.isArray(summaryResult) ? summaryResult : summaryResult.acuerdos ?? [summaryResult]).map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-3 px-3 py-2 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                  <CheckCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">{typeof a === 'string' ? a : a.descripcion ?? a.acuerdo ?? JSON.stringify(a)}</p>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>

      {/* Nueva Acta Modal */}
      <AnimatePresence>
        {showAddActa && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowAddActa(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-[2rem] p-6 w-full max-w-md shadow-2xl border border-zinc-200 dark:border-white/10 space-y-5"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Nueva Acta</h2>
                <button onClick={() => setShowAddActa(false)} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Fecha de reunión</label>
                  <input
                    type="date"
                    value={actaForm.fecha}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={e => setActaForm(f => ({ ...f, fecha: e.target.value }))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Tipo de reunión</label>
                  <select
                    value={actaForm.tipo}
                    onChange={e => setActaForm(f => ({ ...f, tipo: e.target.value as 'Ordinaria' | 'Extraordinaria' }))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Ordinaria">Ordinaria</option>
                    <option value="Extraordinaria">Extraordinaria</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Asistentes (uno por línea)</label>
                  <textarea
                    value={actaForm.asistentesRaw}
                    onChange={e => setActaForm(f => ({ ...f, asistentesRaw: e.target.value }))}
                    placeholder={"Juan Pérez — Supervisor\nMaría González — Delegada Trabajadores"}
                    rows={4}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowAddActa(false)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white text-xs font-black uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddActa}
                  disabled={actaSaving || !actaForm.fecha || !actaForm.asistentesRaw.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Guardar Acta
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

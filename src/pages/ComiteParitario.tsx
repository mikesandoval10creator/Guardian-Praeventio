import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAutoCalendarEvents } from '../hooks/useAutoCalendarEvents';
import {
  Users,
  FileText,
  CheckCircle,
  Clock,
  Plus,
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

  const [agendaResult, setAgendaResult] = useState<any>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [meetingNotes, setMeetingNotes] = useState('');
  const [summaryResult, setSummaryResult] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const { data: actas, loading } = useFirestoreCollection<Acta>(
    selectedProject ? `projects/${selectedProject.id}/comite_actas` : null
  );

  const todosLosAcuerdos = actas?.flatMap(acta => acta.acuerdos) || [];

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
          <button className="bg-zinc-900 dark:bg-white text-white dark:text-black px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-xl flex items-center gap-2">
            <Plus className="w-4 h-4" />
            <span>Nueva Acta</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-zinc-200 dark:border-white/10 pb-4">
        <button
          onClick={() => setActiveTab('actas')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'actas'
              ? 'bg-zinc-900 dark:bg-white text-white dark:text-black'
              : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5'
          }`}
        >
          <FileText className="w-4 h-4" />
          Actas de Reunión
        </button>
        <button
          onClick={() => setActiveTab('acuerdos')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'acuerdos'
              ? 'bg-zinc-900 dark:bg-white text-white dark:text-black'
              : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5'
          }`}
        >
          <CheckCircle className="w-4 h-4" />
          Seguimiento de Acuerdos
        </button>
      </div>

      {/* Content */}
      <div className="grid gap-6">
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
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            acuerdo.estado === 'Completado' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                            acuerdo.estado === 'En Progreso' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' :
                            'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                          }`}>
                            {acuerdo.estado}
                          </span>
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
    </div>
  );
}

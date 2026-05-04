import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar, Clock, AlertTriangle, CheckCircle, Filter,
  ChevronRight, User, Stethoscope, Wind, Ear, Bone, Brain, Eye, Activity
} from 'lucide-react';
import { MedicalIcon } from '../medical/MedicalIcon';

interface ScheduledExam {
  id: string;
  workerName: string;
  workerRut: string;
  occupation: string;
  program: 'PREXOR' | 'PLANESI' | 'TMERT' | 'EVAST' | 'Cardiovascular' | 'Visual' | 'General';
  examType: string;
  dueDate: string;
  lastExam?: string;
  status: 'pending' | 'overdue' | 'warning' | 'ok';
  ds594Article: string;
}

const PROGRAM_META: Record<ScheduledExam['program'], { icon: typeof Ear; color: string; bg: string; article: string }> = {
  PREXOR: { icon: Ear, color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', article: 'DS 594 Art. 70' },
  PLANESI: { icon: Wind, color: 'text-cyan-500', bg: 'bg-cyan-500/10 border-cyan-500/20', article: 'DS 594 Art. 66' },
  TMERT: { icon: Bone, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', article: 'DS 594 Art. 110bis' },
  EVAST: { icon: Brain, color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/20', article: 'EVAST MINSAL' },
  Cardiovascular: { icon: Activity, color: 'text-rose-600', bg: 'bg-rose-600/10 border-rose-600/20', article: 'Vigilancia genérica' },
  Visual: { icon: Eye, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', article: 'DS 594 Art. 95-99' },
  General: { icon: Stethoscope, color: 'text-[#4db6ac]', bg: 'bg-[#4db6ac]/10 border-[#4db6ac]/20', article: 'DS 109' },
};

const today = new Date();
const addDays = (d: number) => new Date(today.getTime() + d * 86_400_000).toISOString().slice(0, 10);
const subDays = (d: number) => new Date(today.getTime() - d * 86_400_000).toISOString().slice(0, 10);

const DEMO_EXAMS: ScheduledExam[] = [
  { id: '1', workerName: 'Carlos Mendoza Ríos', workerRut: '12.345.678-9', occupation: 'Perforista', program: 'PREXOR', examType: 'Audiometría anual', dueDate: addDays(5), lastExam: subDays(360), status: 'warning', ds594Article: 'DS 594 Art. 70' },
  { id: '2', workerName: 'Ana González Vidal', workerRut: '13.456.789-0', occupation: 'Administrativo', program: 'Visual', examType: 'Evaluación visual', dueDate: addDays(12), lastExam: subDays(353), status: 'warning', ds594Article: 'DS 594 Art. 95-99' },
  { id: '3', workerName: 'Pedro Rojas Castro', workerRut: '14.567.890-1', occupation: 'Operador minero', program: 'PLANESI', examType: 'Rx tórax + espirometría', dueDate: subDays(8), lastExam: subDays(738), status: 'overdue', ds594Article: 'DS 594 Art. 66' },
  { id: '4', workerName: 'María Flores Soto', workerRut: '15.678.901-2', occupation: 'Digitadora', program: 'TMERT', examType: 'Evaluación ergonómica TMERT-EESS', dueDate: addDays(22), lastExam: subDays(343), status: 'warning', ds594Article: 'DS 594 Art. 110bis' },
  { id: '5', workerName: 'Juan Herrera Lagos', workerRut: '16.789.012-3', occupation: 'Operador maquinaria', program: 'Cardiovascular', examType: 'ECG + perfil lipídico', dueDate: addDays(45), lastExam: subDays(320), status: 'ok', ds594Article: 'Vigilancia genérica' },
  { id: '6', workerName: 'Lucía Pérez Torres', workerRut: '17.890.123-4', occupation: 'Supervisora', program: 'EVAST', examType: 'Evaluación riesgo psicosocial ISTAS-21', dueDate: addDays(3), lastExam: subDays(362), status: 'warning', ds594Article: 'EVAST MINSAL' },
  { id: '7', workerName: 'Roberto Silva Muñoz', workerRut: '18.901.234-5', occupation: 'Operador pesado', program: 'General', examType: 'Examen preocupacional', dueDate: addDays(90), lastExam: undefined, status: 'ok', ds594Article: 'DS 109' },
  { id: '8', workerName: 'Carmen Díaz Araya', workerRut: '19.012.345-6', occupation: 'Perforista', program: 'PREXOR', examType: 'Audiometría semestral', dueDate: subDays(3), lastExam: subDays(183), status: 'overdue', ds594Article: 'DS 594 Art. 70' },
];

const getDaysUntil = (dateStr: string): number => {
  const d = new Date(dateStr);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
};

const STATUS_CONFIG = {
  overdue: { label: 'Vencido', color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', dot: 'bg-rose-500' },
  warning: { label: 'Próximo', color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-500' },
  ok: { label: 'Al día', color: 'text-[#4db6ac]', bg: 'bg-[#4db6ac]/10 border-[#4db6ac]/20', dot: 'bg-[#4db6ac]' },
  pending: { label: 'Pendiente', color: 'text-zinc-400', bg: 'bg-zinc-500/10 border-zinc-500/20', dot: 'bg-zinc-500' },
};

const ALL_PROGRAMS: Array<ScheduledExam['program'] | 'Todos'> = ['Todos', 'PREXOR', 'PLANESI', 'TMERT', 'EVAST', 'Cardiovascular', 'Visual', 'General'];

export function VigilanciaScheduler() {
  const [filter, setFilter] = useState<ScheduledExam['program'] | 'Todos'>('Todos');
  const [sortBy, setSortBy] = useState<'dueDate' | 'status'>('dueDate');

  const filtered = useMemo(() => {
    let list = filter === 'Todos' ? DEMO_EXAMS : DEMO_EXAMS.filter(e => e.program === filter);
    return [...list].sort((a, b) => {
      if (sortBy === 'dueDate') return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      const order = { overdue: 0, warning: 1, pending: 2, ok: 3 };
      return order[a.status] - order[b.status];
    });
  }, [filter, sortBy]);

  const counts = useMemo(() => ({
    overdue: DEMO_EXAMS.filter(e => e.status === 'overdue').length,
    warning: DEMO_EXAMS.filter(e => e.status === 'warning').length,
    ok: DEMO_EXAMS.filter(e => e.status === 'ok').length,
  }), []);

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200/50 dark:border-white/5 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-[#4db6ac]/10 dark:bg-[#d4af37]/10">
          <Calendar className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-zinc-900 dark:text-white">Vigilancia Médica Programada</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">PREXOR · PLANESI · TMERT · EVAST · DS 109 — Calendario de vencimientos</p>
        </div>
        {/* Sprint 17c — Bioicons surveillance instrumentation cluster. */}
        <div className="hidden md:flex items-center gap-1.5 text-[#2a8a81] dark:text-[#d4af37]" aria-hidden="true">
          <MedicalIcon name="audiometer" size={18} alt="Audiometría" />
          <MedicalIcon name="spirometer" size={18} alt="Espirometría" />
          <MedicalIcon name="eye" size={18} alt="Visión" />
          <MedicalIcon name="thermometer" size={18} alt="Termometría" />
          <MedicalIcon name="blood-pressure-cuff" size={18} alt="Presión arterial" />
        </div>
        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] border border-[#4db6ac]/20 dark:border-[#d4af37]/20 uppercase">
          Vigilancia
        </span>
      </div>

      {/* Summary KPIs */}
      <div className="px-5 pt-4 grid grid-cols-3 gap-3">
        {[
          { label: 'Vencidos', value: counts.overdue, ...STATUS_CONFIG.overdue },
          { label: 'Próximos 30d', value: counts.warning, ...STATUS_CONFIG.warning },
          { label: 'Al día', value: counts.ok, ...STATUS_CONFIG.ok },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-3 border ${s.bg} text-center`}>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className={`text-[9px] font-black uppercase tracking-widest ${s.color} opacity-80`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="px-5 pt-3 flex flex-wrap gap-2 items-center">
        <Filter className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
        <div className="flex flex-wrap gap-1">
          {ALL_PROGRAMS.map(p => (
            <button
              key={p}
              onClick={() => setFilter(p)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border ${
                filter === p
                  ? 'bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] border-[#4db6ac]/30 dark:border-[#d4af37]/30'
                  : 'text-zinc-500 border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Orden:</span>
          <button
            onClick={() => setSortBy(s => s === 'dueDate' ? 'status' : 'dueDate')}
            className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest text-[#2a8a81] dark:text-[#d4af37] bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 border border-[#4db6ac]/20 dark:border-[#d4af37]/20 transition-all hover:bg-[#4db6ac]/20"
          >
            {sortBy === 'dueDate' ? 'Fecha' : 'Urgencia'}
          </button>
        </div>
      </div>

      {/* Exam list */}
      <div className="p-5 space-y-2">
        {filtered.map((exam, i) => {
          const days = getDaysUntil(exam.dueDate);
          const programMeta = PROGRAM_META[exam.program];
          const statusCfg = STATUS_CONFIG[exam.status];
          const ProgramIcon = programMeta.icon;

          return (
            <motion.div
              key={exam.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="rounded-xl bg-white dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-white/5 p-3 hover:border-zinc-300 dark:hover:border-white/10 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg border ${programMeta.bg} flex-shrink-0`}>
                  <ProgramIcon className={`w-4 h-4 ${programMeta.color}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-black text-zinc-900 dark:text-white truncate">{exam.workerName}</p>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${programMeta.bg} ${programMeta.color}`}>
                      {exam.program}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${statusCfg.bg} ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <p className="text-[10px] text-zinc-500">{exam.examType}</p>
                    <p className="text-[10px] text-zinc-400 flex items-center gap-1">
                      <User className="w-2.5 h-2.5" /> {exam.workerRut}
                    </p>
                  </div>
                </div>

                <div className="flex-shrink-0 text-right">
                  <div className={`flex items-center gap-1 justify-end ${exam.status === 'overdue' ? 'text-rose-500' : exam.status === 'warning' ? 'text-amber-500' : 'text-[#4db6ac]'}`}>
                    {exam.status === 'overdue' ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : exam.status === 'ok' ? (
                      <CheckCircle className="w-3.5 h-3.5" />
                    ) : (
                      <Clock className="w-3.5 h-3.5" />
                    )}
                    <span className="text-xs font-black">
                      {days < 0 ? `${Math.abs(days)}d vencido` : days === 0 ? 'Hoy' : `${days}d`}
                    </span>
                  </div>
                  <p className="text-[9px] text-zinc-500 mt-0.5">{exam.dueDate}</p>
                </div>

                <ChevronRight className="w-4 h-4 text-zinc-400 flex-shrink-0" />
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="px-5 pb-4">
        <p className="text-[9px] text-zinc-400 text-center flex items-center justify-center gap-1">
          <Stethoscope className="w-3 h-3" />
          Protocolos MINSAL — Ley 16.744 art. 68 obliga a vigilancia médica preventiva continua
        </p>
      </div>
    </div>
  );
}

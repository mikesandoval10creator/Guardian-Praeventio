import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  FileText,
  Users,
  ClipboardCheck,
  AlertTriangle,
  TrendingUp,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { addDoc, collection } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useFirestoreCollection } from '../../hooks/useFirestoreCollection';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { ISOAudit } from './ISOAudit';
import { NodeType } from '../../types';

// ─── Local Types ─────────────────────────────────────────────────────────────

interface ISODocument {
  id: string;
  nombre: string;
  tipo: string;
  version: string;
  fecha: string;
  estado: 'Vigente' | 'Obsoleto' | 'En revisión';
  createdAt?: string;
}

interface Worker {
  id: string;
  name: string;
  competencia?: string;
  competencias?: Array<{ nombre: string; estado: string; vencimiento?: string }>;
  estado?: string;
  vencimiento?: string;
}

interface ISOImprovement {
  id: string;
  title: string;
  phase: 'Planear' | 'Hacer' | 'Verificar' | 'Actuar';
  status: 'pending' | 'in_progress' | 'done';
  createdAt?: string;
}

// ─── Sub-tab types ────────────────────────────────────────────────────────────

type ISOTab = 'dashboard' | 'documentos' | 'competencias' | 'auditorias' | 'riesgos' | 'mejora';
type IconType = React.FC<{ className?: string }>;

const TABS: { id: ISOTab; label: string; icon: IconType }[] = [
  { id: 'dashboard',    label: 'Dashboard',       icon: LayoutDashboard },
  { id: 'documentos',   label: 'Documentos',       icon: FileText        },
  { id: 'competencias', label: 'Competencias',     icon: Users           },
  { id: 'auditorias',   label: 'Auditorías',       icon: ClipboardCheck  },
  { id: 'riesgos',      label: 'Riesgos',          icon: AlertTriangle   },
  { id: 'mejora',       label: 'Mejora Continua',  icon: TrendingUp      },
];

const TEAL = '#4db6ac';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(estado: string) {
  const map: Record<string, string> = {
    Vigente:      'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    Obsoleto:     'bg-red-500/10 text-red-600 dark:text-red-400',
    'En revisión':'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    pending:      'bg-zinc-400/10 text-zinc-500',
    in_progress:  'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    done:         'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  };
  return map[estado] ?? 'bg-zinc-400/10 text-zinc-500';
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab({
  docs,
  improvements,
  auditCount,
  isoRiskCount,
}: {
  docs: ISODocument[];
  improvements: ISOImprovement[];
  auditCount: number;
  isoRiskCount: number;
}) {
  const inProgress = improvements.filter(i => i.status === 'in_progress').length;

  const kpis = [
    {
      label: 'Total Documentos',
      value: docs.length,
      icon: FileText,
      color: 'text-[#4db6ac]',
      bg: 'bg-[#4db6ac]/10',
    },
    {
      label: 'Auditorías Completadas',
      value: auditCount,
      icon: CheckCircle2,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Mejoras en Progreso',
      value: inProgress,
      icon: RefreshCw,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Riesgos ISO Altos',
      value: isoRiskCount,
      icon: AlertTriangle,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl p-4 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm"
          >
            <div className={`w-8 h-8 rounded-xl ${kpi.bg} flex items-center justify-center mb-3`}>
              <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
            </div>
            <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">{kpi.label}</p>
            <p className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter">{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* ISO 45001 Summary Card */}
      <div className="bg-white/80 dark:bg-zinc-900/80 rounded-2xl p-5 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="w-5 h-5" style={{ color: TEAL }} />
          <h3 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white">
            Sistema de Gestión ISO 45001
          </h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Documentos Vigentes', value: docs.filter(d => d.estado === 'Vigente').length, total: docs.length },
            { label: 'Mejoras Completadas', value: improvements.filter(i => i.status === 'done').length, total: improvements.length },
            { label: 'Cobertura Auditorías', value: auditCount, total: auditCount + 2 },
          ].map(item => {
            const pct = item.total > 0 ? Math.round((item.value / item.total) * 100) : 0;
            return (
              <div key={item.label} className="space-y-1.5">
                <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{item.label}</p>
                <p className="text-lg font-black text-zinc-900 dark:text-white">{item.value}<span className="text-xs text-zinc-400">/{item.total}</span></p>
                <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: TEAL }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Documentos Tab ───────────────────────────────────────────────────────────

function DocumentosTab({ projectId }: { projectId: string }) {
  const { data: docs, loading } = useFirestoreCollection<ISODocument>(
    `projects/${projectId}/iso_documents`
  );

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nombre: '',
    tipo: '',
    version: '1.0',
    fecha: new Date().toISOString().split('T')[0],
    estado: 'Vigente' as ISODocument['estado'],
  });

  async function handleAddDoc() {
    if (!form.nombre.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, `projects/${projectId}/iso_documents`), {
        ...form,
        createdAt: new Date().toISOString(),
      });
      setForm({ nombre: '', tipo: '', version: '1.0', fecha: new Date().toISOString().split('T')[0], estado: 'Vigente' });
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">Documentos ISO</h3>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: TEAL }}
        >
          <Plus className="w-3 h-3" />
          Nuevo Documento
        </button>
      </div>

      {/* Inline add form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white/80 dark:bg-zinc-900/80 rounded-2xl p-4 border border-zinc-200/50 dark:border-zinc-800/50 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: TEAL }}>Nuevo Documento ISO</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Nombre *</label>
                  <input
                    value={form.nombre}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/30"
                    placeholder="Manual de Seguridad ISO 45001..."
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Tipo</label>
                  <input
                    value={form.tipo}
                    onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none"
                    placeholder="Manual / Procedimiento..."
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Versión</label>
                  <input
                    value={form.version}
                    onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none"
                    placeholder="1.0"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Estado</label>
                  <select
                    value={form.estado}
                    onChange={e => setForm(f => ({ ...f, estado: e.target.value as ISODocument['estado'] }))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none"
                  >
                    <option value="Vigente">Vigente</option>
                    <option value="En revisión">En revisión</option>
                    <option value="Obsoleto">Obsoleto</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddDoc}
                  disabled={saving || !form.nombre.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ backgroundColor: TEAL }}
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Guardar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: TEAL }} />
        </div>
      ) : docs.length === 0 ? (
        <EmptyState icon={FileText} message="No hay documentos ISO registrados" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                {['Nombre', 'Tipo', 'Versión', 'Fecha', 'Estado', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-zinc-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((doc, i) => (
                <tr
                  key={doc.id}
                  className={`border-t border-zinc-100 dark:border-zinc-800/50 ${i % 2 === 0 ? 'bg-white/60 dark:bg-zinc-900/40' : 'bg-zinc-50/60 dark:bg-zinc-900/20'}`}
                >
                  <td className="px-4 py-2.5 font-semibold text-zinc-900 dark:text-white">{doc.nombre}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{doc.tipo || '—'}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{doc.version || '—'}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{doc.fecha ? new Date(doc.fecha).toLocaleDateString('es-CL') : '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${statusBadge(doc.estado)}`}>
                      {doc.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Competencias Tab ─────────────────────────────────────────────────────────

function CompetenciasTab({ projectId }: { projectId: string }) {
  const { data: workers, loading } = useFirestoreCollection<Worker>(
    `projects/${projectId}/workers`
  );

  // Flatten workers with multiple competencias into rows
  const rows: { workerId: string; nombre: string; competencia: string; estado: string; vencimiento: string }[] = [];
  for (const w of workers) {
    if (w.competencias && w.competencias.length > 0) {
      for (const c of w.competencias) {
        rows.push({
          workerId: w.id,
          nombre: w.name,
          competencia: c.nombre,
          estado: c.estado,
          vencimiento: c.vencimiento ?? '',
        });
      }
    } else {
      rows.push({
        workerId: w.id,
        nombre: w.name,
        competencia: w.competencia ?? '—',
        estado: w.estado ?? '—',
        vencimiento: w.vencimiento ?? '—',
      });
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">Matriz de Competencias</h3>
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: TEAL }} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} message="No hay registros de competencias" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                {['Trabajador', 'Competencia', 'Estado', 'Fecha Vencimiento'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-zinc-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={`${row.workerId}-${i}`}
                  className={`border-t border-zinc-100 dark:border-zinc-800/50 ${i % 2 === 0 ? 'bg-white/60 dark:bg-zinc-900/40' : 'bg-zinc-50/60 dark:bg-zinc-900/20'}`}
                >
                  <td className="px-4 py-2.5 font-semibold text-zinc-900 dark:text-white">{row.nombre}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{row.competencia}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${statusBadge(row.estado)}`}>
                      {row.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {row.vencimiento && row.vencimiento !== '—'
                      ? new Date(row.vencimiento).toLocaleDateString('es-CL')
                      : row.vencimiento}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Riesgos Tab ──────────────────────────────────────────────────────────────

function RiesgosTab() {
  const { nodes, loading } = useRiskEngine();
  const isoRisks = nodes.filter(
    n =>
      n.type === NodeType.RISK &&
      (n.tags?.some(t => t.toLowerCase().includes('iso')) ||
        (n.metadata?.standard ?? '').toLowerCase().includes('iso') ||
        (n.metadata?.norm ?? '').toLowerCase().includes('iso') ||
        (n.title ?? '').toLowerCase().includes('iso') ||
        (n.description ?? '').toLowerCase().includes('iso 45001'))
  );

  const severityColor = (level: string) => {
    const l = level?.toLowerCase();
    if (l === 'alto' || l === 'crítico' || l === 'critico') return 'bg-red-500/10 text-red-600 dark:text-red-400';
    if (l === 'medio') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    return 'bg-zinc-400/10 text-zinc-500';
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">
        Registro de Riesgos — ISO 45001
        <span className="ml-2 text-[9px] font-bold text-zinc-400">({isoRisks.length} registros)</span>
      </h3>
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: TEAL }} />
        </div>
      ) : isoRisks.length === 0 ? (
        <EmptyState icon={AlertTriangle} message="No hay riesgos etiquetados con ISO 45001" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                {['Riesgo', 'Descripción', 'Nivel', 'Estado'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-zinc-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isoRisks.map((risk, i) => (
                <tr
                  key={risk.id}
                  className={`border-t border-zinc-100 dark:border-zinc-800/50 ${i % 2 === 0 ? 'bg-white/60 dark:bg-zinc-900/40' : 'bg-zinc-50/60 dark:bg-zinc-900/20'}`}
                >
                  <td className="px-4 py-2.5 font-semibold text-zinc-900 dark:text-white max-w-[180px] truncate">{risk.title}</td>
                  <td className="px-4 py-2.5 text-zinc-500 max-w-[220px] truncate">{risk.description || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${severityColor(risk.metadata?.severity ?? risk.metadata?.nivel ?? '')}`}>
                      {risk.metadata?.severity ?? risk.metadata?.nivel ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{risk.metadata?.status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Mejora Continua Tab ──────────────────────────────────────────────────────

const PDCA_PHASES: ISOImprovement['phase'][] = ['Planear', 'Hacer', 'Verificar', 'Actuar'];

const PHASE_COLORS: Record<ISOImprovement['phase'], string> = {
  Planear:   'border-blue-500/40 dark:border-blue-500/30',
  Hacer:     'border-amber-500/40 dark:border-amber-500/30',
  Verificar: 'border-[#4db6ac]/40 dark:border-[#4db6ac]/30',
  Actuar:    'border-purple-500/40 dark:border-purple-500/30',
};

const PHASE_HEADER: Record<ISOImprovement['phase'], string> = {
  Planear:   'text-blue-500',
  Hacer:     'text-amber-500',
  Verificar: 'text-[#4db6ac]',
  Actuar:    'text-purple-500',
};

function MejoraTab({ projectId }: { projectId: string }) {
  const { data: improvements, loading } = useFirestoreCollection<ISOImprovement>(
    `projects/${projectId}/iso_improvements`
  );

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<ISOImprovement['phase']>('Planear');

  async function handleAdd() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, `projects/${projectId}/iso_improvements`), {
        title: title.trim(),
        phase,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setTitle('');
      setPhase('Planear');
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">Ciclo PDCA — Mejora Continua</h3>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: TEAL }}
        >
          <Plus className="w-3 h-3" />
          Nueva Mejora
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white/80 dark:bg-zinc-900/80 rounded-2xl p-4 border border-zinc-200/50 dark:border-zinc-800/50 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: TEAL }}>Nueva Mejora PDCA</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Título *</label>
                  <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/30"
                    placeholder="Descripción de la mejora..."
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Fase PDCA</label>
                  <select
                    value={phase}
                    onChange={e => setPhase(e.target.value as ISOImprovement['phase'])}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none"
                  >
                    {PDCA_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAdd}
                  disabled={saving || !title.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ backgroundColor: TEAL }}
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Guardar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: TEAL }} />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {PDCA_PHASES.map(p => {
            const items = improvements.filter(i => i.phase === p);
            return (
              <div
                key={p}
                className={`rounded-2xl border-2 ${PHASE_COLORS[p]} bg-white/60 dark:bg-zinc-900/50 p-3 space-y-2 min-h-[160px]`}
              >
                <p className={`text-[9px] font-black uppercase tracking-widest ${PHASE_HEADER[p]}`}>{p}</p>
                <p className="text-[8px] text-zinc-400">{items.length} elemento{items.length !== 1 ? 's' : ''}</p>
                {items.length === 0 ? (
                  <p className="text-[9px] text-zinc-300 dark:text-zinc-600 italic pt-2">Sin mejoras</p>
                ) : (
                  items.map(item => (
                    <div
                      key={item.id}
                      className="bg-white dark:bg-zinc-800 rounded-xl p-2.5 border border-zinc-100 dark:border-zinc-700 shadow-sm space-y-1.5"
                    >
                      <p className="text-[10px] font-semibold text-zinc-900 dark:text-white leading-snug">{item.title}</p>
                      <div className="flex items-center gap-1">
                        {item.status === 'done' ? (
                          <CheckCircle2 className="w-3 h-3 text-[#4db6ac]" />
                        ) : item.status === 'in_progress' ? (
                          <Clock className="w-3 h-3 text-blue-400" />
                        ) : (
                          <XCircle className="w-3 h-3 text-zinc-300" />
                        )}
                        <span className={`text-[8px] font-bold uppercase tracking-wider ${statusBadge(item.status)}`}>
                          {item.status === 'pending' ? 'Pendiente' : item.status === 'in_progress' ? 'En Progreso' : 'Completado'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Shared Empty State ───────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: IconType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 bg-white/50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800 gap-3">
      <Icon className="w-10 h-10 text-zinc-200 dark:text-zinc-700" />
      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{message}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ISOManagement() {
  const [activeTab, setActiveTab] = useState<ISOTab>('dashboard');
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const projectId = selectedProject?.id ?? '';

  // Data for dashboard KPIs
  const { data: docs } = useFirestoreCollection<ISODocument>(
    projectId ? `projects/${projectId}/iso_documents` : null
  );
  const { data: improvements } = useFirestoreCollection<ISOImprovement>(
    projectId ? `projects/${projectId}/iso_improvements` : null
  );
  const { nodes } = useRiskEngine();

  const completedAudits = nodes.filter(
    n => n.type === NodeType.AUDIT &&
      (!selectedProject || n.projectId === selectedProject.id) &&
      (n.metadata?.status === 'Completada' || n.metadata?.status === 'Completado')
  ).length;

  const isoHighRisks = nodes.filter(
    n =>
      n.type === NodeType.RISK &&
      (!selectedProject || n.projectId === selectedProject.id) &&
      (n.tags?.some(t => t.toLowerCase().includes('iso')) ||
        (n.metadata?.standard ?? '').toLowerCase().includes('iso')) &&
      ['alto', 'crítico', 'critico'].includes((n.metadata?.severity ?? n.metadata?.nivel ?? '').toLowerCase())
  ).length;

  if (!user || !projectId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-400">
        <ShieldCheck className="w-10 h-10 text-zinc-200 dark:text-zinc-700" />
        <p className="text-[10px] font-black uppercase tracking-widest">
          Selecciona un proyecto para gestionar ISO 45001
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Inner Tab Bar */}
      <div className="flex gap-1 overflow-x-auto bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-xl">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                isActive
                  ? 'text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
              style={isActive ? { backgroundColor: TEAL } : undefined}
            >
              <tab.icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'dashboard' && (
            <DashboardTab
              docs={docs}
              improvements={improvements}
              auditCount={completedAudits}
              isoRiskCount={isoHighRisks}
            />
          )}
          {activeTab === 'documentos' && <DocumentosTab projectId={projectId} />}
          {activeTab === 'competencias' && <CompetenciasTab projectId={projectId} />}
          {activeTab === 'auditorias' && <ISOAudit />}
          {activeTab === 'riesgos' && <RiesgosTab />}
          {activeTab === 'mejora' && <MejoraTab projectId={projectId} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

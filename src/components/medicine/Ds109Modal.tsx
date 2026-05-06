// Praeventio Guard — DS 109 form modal.
//
// Sprint 21 (Bucket E). UX colapsable por secciones. Botón "Generar DS 109 PDF"
// invoca `downloadDs109Pdf`, persiste un nodo en Zettelkasten y registra audit
// log con el RUT hasheado (PII jamás sale plano).

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  FileCheck,
  Download,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import {
  downloadDs109Pdf,
  hashRut,
  type Ds109Input,
  type Ds109OccupationalHistoryEntry,
  type Ds109Origin,
} from '../../utils/ds109Certificate';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { logAuditAction } from '../../services/auditService';
import { useProject } from '../../contexts/ProjectContext';
import { logger } from '../../utils/logger';

interface Ds109ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ORIGIN_OPTIONS: { value: Ds109Origin; label: string; color: string }[] = [
  { value: 'laboral', label: 'Laboral', color: 'text-rose-600 dark:text-rose-400' },
  { value: 'comun', label: 'Común', color: 'text-teal-600 dark:text-teal-400' },
  { value: 'mixto', label: 'Mixto', color: 'text-amber-600 dark:text-amber-400' },
  { value: 'pendiente', label: 'Pendiente', color: 'text-zinc-500 dark:text-zinc-400' },
];

function emptyHistory(): Ds109OccupationalHistoryEntry {
  return { yearFrom: new Date().getFullYear() - 5, yearTo: new Date().getFullYear(), employer: '', jobTitle: '', riskAgents: [] };
}

function emptyInput(): Ds109Input {
  const today = new Date().toISOString().slice(0, 10);
  return {
    workerName: '',
    workerRut: '',
    workerBirthDate: '',
    workerGender: 'M',
    workerAddress: '',
    employerName: '',
    employerRut: '',
    jobTitle: '',
    hireDate: '',
    workplaceAddress: '',
    occupationalHistory: [],
    diagnosis: '',
    cieCode: '',
    symptomsOnsetDate: '',
    clinicalFindings: '',
    origin: 'pendiente',
    causalAgent: '',
    evidenceBasis: '',
    attributablePercent: undefined,
    evaluatorName: '',
    evaluatorRut: '',
    evaluatorRegistration: '',
    evaluationDate: today,
    citation: '',
  };
}

const REQUIRED_FIELDS: (keyof Ds109Input)[] = [
  'workerName',
  'workerRut',
  'workerBirthDate',
  'employerName',
  'jobTitle',
  'diagnosis',
  'symptomsOnsetDate',
  'clinicalFindings',
  'causalAgent',
  'evidenceBasis',
  'evaluatorName',
  'evaluatorRut',
  'evaluatorRegistration',
  'evaluationDate',
];

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        // Audit P0 §1.1 — WCAG 2.5.5 + Apple HIG 44pt + Material 48dp: min 44x44 touch target.
        className="w-full min-h-11 flex items-center justify-between px-5 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
      >
        <span className="text-xs font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-200">
          {title}
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-zinc-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-4 border-t border-zinc-200 dark:border-white/10 space-y-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const inputClass =
  'px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 w-full';

function Required() {
  return <span className="text-rose-500 ml-0.5">*</span>;
}

export function Ds109Modal({ isOpen, onClose }: Ds109ModalProps) {
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();

  const [data, setData] = useState<Ds109Input>(emptyInput());
  const [openSections, setOpenSections] = useState({
    identification: true,
    employment: true,
    history: false,
    clinical: false,
    qualification: false,
    evaluator: false,
  });
  const [agentDraft, setAgentDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyAgentDrafts, setHistoryAgentDrafts] = useState<Record<number, string>>({});

  if (!isOpen) return null;

  const update = <K extends keyof Ds109Input>(key: K, value: Ds109Input[K]) =>
    setData(prev => ({ ...prev, [key]: value }));

  const toggle = (s: keyof typeof openSections) =>
    setOpenSections(prev => ({ ...prev, [s]: !prev[s] }));

  // ── Anamnesis helpers ─────────────────────────────────────────────────────
  const addHistoryEntry = () =>
    update('occupationalHistory', [...data.occupationalHistory, emptyHistory()]);

  const updateHistoryEntry = (
    idx: number,
    patch: Partial<Ds109OccupationalHistoryEntry>,
  ) => {
    update(
      'occupationalHistory',
      data.occupationalHistory.map((h, i) => (i === idx ? { ...h, ...patch } : h)),
    );
  };

  const removeHistoryEntry = (idx: number) =>
    update(
      'occupationalHistory',
      data.occupationalHistory.filter((_, i) => i !== idx),
    );

  const addRiskAgent = (idx: number) => {
    const draft = (historyAgentDrafts[idx] || '').trim();
    if (!draft) return;
    updateHistoryEntry(idx, {
      riskAgents: [...data.occupationalHistory[idx].riskAgents, draft],
    });
    setHistoryAgentDrafts(prev => ({ ...prev, [idx]: '' }));
  };

  const removeRiskAgent = (idx: number, agentIdx: number) =>
    updateHistoryEntry(idx, {
      riskAgents: data.occupationalHistory[idx].riskAgents.filter((_, i) => i !== agentIdx),
    });

  // ── Submit ───────────────────────────────────────────────────────────────
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate required fields
    const missing = REQUIRED_FIELDS.filter(f => {
      const v = data[f];
      return v === undefined || v === null || (typeof v === 'string' && v.trim().length === 0);
    });
    if (missing.length > 0) {
      setError(
        `Completa los campos obligatorios marcados con *: ${missing.join(', ')}`,
      );
      // Open all sections so user sees what's missing
      setOpenSections({
        identification: true, employment: true, history: true,
        clinical: true, qualification: true, evaluator: true,
      });
      return;
    }

    setGenerating(true);
    try {
      // 1. Generate + download PDF
      downloadDs109Pdf(data);

      // 2. Persist Zettelkasten node
      try {
        await addNode({
          type: NodeType.MEDICINE,
          title: `DS 109: ${data.diagnosis}`,
          description: `Calificación enfermedad profesional - origin: ${data.origin}. Agente: ${data.causalAgent}`,
          tags: [
            'ds109',
            data.origin,
            ...(data.cieCode ? [data.cieCode] : []),
            ...data.occupationalHistory.flatMap(h => h.riskAgents),
          ].filter((v, i, arr) => arr.indexOf(v) === i),
          metadata: {
            workerRut: data.workerRut,
            cieCode: data.cieCode || null,
            evaluationDate: data.evaluationDate,
            attributablePercent: data.attributablePercent ?? null,
            origin: data.origin,
            diagnosis: data.diagnosis,
            evaluatorRegistration: data.evaluatorRegistration,
          },
          connections: [],
          projectId: selectedProject?.id,
        });
      } catch (zkErr) {
        // Don't break PDF generation if ZK persistence fails
        logger.warn('DS 109 ZK persistence failed', { err: String(zkErr) });
      }

      // 3. Audit log with HASHED rut (no PII to server logs)
      try {
        const rutHash = await hashRut(data.workerRut);
        await logAuditAction(
          'medicine.ds109.generated',
          'medicine',
          {
            workerRutHash: rutHash,
            origin: data.origin,
            cieCode: data.cieCode || null,
            evaluationDate: data.evaluationDate,
          },
          selectedProject?.id,
        );
      } catch (auditErr) {
        logger.warn('DS 109 audit log failed', { err: String(auditErr) });
      }

      // 4. Reset + close
      setData(emptyInput());
      onClose();
    } catch (err) {
      setError(`Error al generar DS 109: ${String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ds109-title">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-white/10 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-teal-400/10 dark:bg-gold-400/10">
            <FileCheck className="w-5 h-5 text-teal-500 dark:text-gold-400" />
          </div>
          <div className="flex-1">
            <h2 id="ds109-title" className="text-base font-black text-zinc-900 dark:text-white">
              Calificación DS 109
            </h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Enfermedad profesional · Ley 16.744 art. 7 + DS 109/1968
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            // Audit P0 §1.1 — WCAG 2.5.5 + Apple HIG 44pt + Material 48dp: min 44x44 touch target.
            className="min-h-11 min-w-11 inline-flex items-center justify-center p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-3">
          {/* ── Identificación ── */}
          <Section title="1. Identificación del trabajador" open={openSections.identification} onToggle={() => toggle('identification')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Nombre completo<Required /></span>
                <input className={inputClass} value={data.workerName} onChange={e => update('workerName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">RUT<Required /></span>
                <input className={inputClass} value={data.workerRut} onChange={e => update('workerRut', e.target.value)} placeholder="12.345.678-9" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Fecha nacimiento<Required /></span>
                <input type="date" className={inputClass} value={data.workerBirthDate} onChange={e => update('workerBirthDate', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Género</span>
                <select className={inputClass} value={data.workerGender} onChange={e => update('workerGender', e.target.value as Ds109Input['workerGender'])}>
                  <option value="M">Masculino</option>
                  <option value="F">Femenino</option>
                  <option value="X">No binario / Otro</option>
                </select>
              </label>
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Domicilio</span>
                <input className={inputClass} value={data.workerAddress} onChange={e => update('workerAddress', e.target.value)} />
              </label>
            </div>
          </Section>

          {/* ── Datos laborales ── */}
          <Section title="2. Datos laborales actuales" open={openSections.employment} onToggle={() => toggle('employment')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Razón social empleador<Required /></span>
                <input className={inputClass} value={data.employerName} onChange={e => update('employerName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">RUT empleador</span>
                <input className={inputClass} value={data.employerRut} onChange={e => update('employerRut', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Cargo<Required /></span>
                <input className={inputClass} value={data.jobTitle} onChange={e => update('jobTitle', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Fecha ingreso</span>
                <input type="date" className={inputClass} value={data.hireDate} onChange={e => update('hireDate', e.target.value)} />
              </label>
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Dirección lugar de trabajo</span>
                <input className={inputClass} value={data.workplaceAddress} onChange={e => update('workplaceAddress', e.target.value)} />
              </label>
            </div>
          </Section>

          {/* ── Anamnesis ── */}
          <Section title="3. Anamnesis ocupacional" open={openSections.history} onToggle={() => toggle('history')}>
            <div className="space-y-3">
              {data.occupationalHistory.length === 0 && (
                <p className="text-xs italic text-zinc-500">Sin períodos registrados.</p>
              )}
              {data.occupationalHistory.map((h, i) => (
                <div key={i} className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 space-y-2 bg-zinc-50/50 dark:bg-zinc-800/30">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600 dark:text-zinc-300">Período #{i + 1}</span>
                    {/* Audit P0 §1.1 — WCAG 2.5.5 + Apple HIG 44pt + Material 48dp: min 44x44 touch target. */}
                    <button type="button" onClick={() => removeHistoryEntry(i)} className="min-h-11 min-w-11 inline-flex items-center justify-center p-1 rounded-lg text-rose-500 hover:bg-rose-500/10" aria-label="Eliminar período">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input type="number" className={inputClass} value={h.yearFrom} onChange={e => updateHistoryEntry(i, { yearFrom: parseInt(e.target.value, 10) || 0 })} placeholder="Desde" />
                    <input type="number" className={inputClass} value={h.yearTo} onChange={e => updateHistoryEntry(i, { yearTo: parseInt(e.target.value, 10) || 0 })} placeholder="Hasta" />
                    <input className={`${inputClass} sm:col-span-2`} value={h.employer} onChange={e => updateHistoryEntry(i, { employer: e.target.value })} placeholder="Empleador" />
                    <input className={`${inputClass} sm:col-span-2`} value={h.jobTitle} onChange={e => updateHistoryEntry(i, { jobTitle: e.target.value })} placeholder="Cargo" />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Agentes de riesgo</span>
                    <div className="flex gap-2">
                      <input
                        className={inputClass}
                        value={historyAgentDrafts[i] || ''}
                        onChange={e => setHistoryAgentDrafts(prev => ({ ...prev, [i]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRiskAgent(i); } }}
                        placeholder="Ej: Sílice, Ruido, Plomo"
                      />
                      {/* Audit P0 §1.1 — WCAG 2.5.5 + Apple HIG 44pt + Material 48dp: min 44x44 touch target. */}
                      <button type="button" onClick={() => addRiskAgent(i)} className="min-h-11 min-w-11 inline-flex items-center justify-center px-3 rounded-xl bg-teal-400/10 text-teal-600 dark:text-gold-400 border border-teal-400/20 hover:bg-teal-400/20" aria-label="Agregar agente de riesgo">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {h.riskAgents.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {h.riskAgents.map((a, ai) => (
                          <span key={ai} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                            {a}
                            {/* WCAG 2.5.5 exception: dense inline tag chip — UX intentional for compact agent list; agent list also has Trash2 button covering bulk-delete. */}
                            <button type="button" onClick={() => removeRiskAgent(i, ai)} className="hover:text-amber-900 dark:hover:text-amber-300" aria-label="Quitar agente">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addHistoryEntry}
                className="w-full py-2 rounded-xl border-2 border-dashed border-zinc-300 dark:border-white/10 text-xs font-bold text-zinc-500 hover:border-teal-400 hover:text-teal-600 dark:hover:text-gold-400 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Agregar período
              </button>
            </div>
          </Section>

          {/* ── Evaluación clínica ── */}
          <Section title="4. Evaluación clínica" open={openSections.clinical} onToggle={() => toggle('clinical')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Diagnóstico principal<Required /></span>
                <input className={inputClass} value={data.diagnosis} onChange={e => update('diagnosis', e.target.value)} placeholder="Ej: Silicosis crónica simple" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Código CIE-10</span>
                <input className={inputClass} value={data.cieCode} onChange={e => update('cieCode', e.target.value)} placeholder="J62.8" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Inicio síntomas<Required /></span>
                <input type="date" className={inputClass} value={data.symptomsOnsetDate} onChange={e => update('symptomsOnsetDate', e.target.value)} />
              </label>
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Hallazgos clínicos<Required /></span>
                <textarea className={`${inputClass} resize-y`} rows={4} value={data.clinicalFindings} onChange={e => update('clinicalFindings', e.target.value)} />
              </label>
            </div>
          </Section>

          {/* ── Calificación ── */}
          <Section title="5. Calificación de origen" open={openSections.qualification} onToggle={() => toggle('qualification')}>
            <div className="space-y-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Origen<Required /></span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  {ORIGIN_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => update('origin', o.value)}
                      className={`py-3 rounded-xl text-xs font-black uppercase tracking-widest border transition-all ${
                        data.origin === o.value
                          ? `${o.color} bg-teal-400/5 dark:bg-gold-400/5 border-teal-400/40 dark:border-gold-400/40 shadow-sm`
                          : 'text-zinc-500 border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="space-y-1 block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Agente causal<Required /></span>
                <input className={inputClass} value={data.causalAgent} onChange={e => update('causalAgent', e.target.value)} placeholder="Ej: Exposición a sílice cristalina (cuarzo)" />
              </label>

              <label className="space-y-1 block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Fundamentación médica<Required /></span>
                <textarea className={`${inputClass} resize-y`} rows={4} value={data.evidenceBasis} onChange={e => update('evidenceBasis', e.target.value)} placeholder="Razonamiento clínico + ocupacional que respalda la calificación" />
              </label>

              {data.origin === 'mixto' && (
                <label className="space-y-1 block">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">% atribuible al trabajo</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={inputClass}
                    value={data.attributablePercent ?? ''}
                    onChange={e => update('attributablePercent', e.target.value ? Math.max(0, Math.min(100, parseInt(e.target.value, 10))) : undefined)}
                    placeholder="0-100"
                  />
                </label>
              )}

              <label className="space-y-1 block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Cita normativa</span>
                <input className={inputClass} value={data.citation} onChange={e => update('citation', e.target.value)} placeholder="Default: Ley 16.744 art. 7 + DS 109/1968 MINSEGPRES" />
              </label>
            </div>
          </Section>

          {/* ── Médico evaluador ── */}
          <Section title="6. Médico evaluador" open={openSections.evaluator} onToggle={() => toggle('evaluator')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Nombre del médico<Required /></span>
                <input className={inputClass} value={data.evaluatorName} onChange={e => update('evaluatorName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">RUT médico<Required /></span>
                <input className={inputClass} value={data.evaluatorRut} onChange={e => update('evaluatorRut', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">N° Reg. SuperSalud<Required /></span>
                <input className={inputClass} value={data.evaluatorRegistration} onChange={e => update('evaluatorRegistration', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Fecha evaluación<Required /></span>
                <input type="date" className={inputClass} value={data.evaluationDate} onChange={e => update('evaluationDate', e.target.value)} />
              </label>
            </div>
          </Section>

          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-sm text-rose-700 dark:text-rose-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={generating}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-400 hover:bg-teal-500 text-white text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-teal-400/20 disabled:opacity-60"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {generating ? 'Generando…' : 'Generar DS 109 PDF'}
          </button>

          <p className="text-[9px] text-zinc-400 text-center flex items-center justify-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            Documento sujeto a revisión COMPIN o Mutualidad — Ley 16.744 art. 7 + DS 109/1968
          </p>
        </form>
      </motion.div>
    </div>
  );
}

// Praeventio Guard — DS 67 form modal.
//
// Sprint 24 (Bucket II). Form colapsable por secciones para capturar la
// notificación de accidente del trabajo a la mutual de seguridad. Reutiliza
// el patrón visual de `Ds109Modal.tsx` (mismo Section, mismo botón, mismo
// flujo de submit + audit log con RUT hasheado).

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
  downloadDs67Pdf,
  type Ds67Input,
  type Ds67Severity,
  type Ds67Witness,
} from '../../utils/ds67Notification';
import { hashRut } from '../../utils/ds109Certificate';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { logAuditAction } from '../../services/auditService';
import { useProject } from '../../contexts/ProjectContext';
import { logger } from '../../utils/logger';

interface Ds67ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SEVERITY_OPTIONS: { value: Ds67Severity; label: string; color: string }[] = [
  { value: 'leve', label: 'Leve', color: 'text-teal-600 dark:text-teal-400' },
  { value: 'grave', label: 'Grave', color: 'text-amber-600 dark:text-amber-400' },
  { value: 'fatal', label: 'Fatal', color: 'text-rose-600 dark:text-rose-400' },
];

function emptyWitness(): Ds67Witness {
  return { name: '', rut: '', contact: '' };
}

function emptyInput(): Ds67Input {
  const today = new Date().toISOString().slice(0, 10);
  return {
    workerName: '',
    workerRut: '',
    workerBirthDate: '',
    workerJobTitle: '',
    workerSeniorityYears: 0,
    employerName: '',
    employerRut: '',
    employerAddress: '',
    mutualName: '',
    accidentDate: today,
    accidentTime: '',
    accidentLocation: '',
    accidentDescription: '',
    accidentType: '',
    cieCode: '',
    bodyPart: '',
    severity: 'leve',
    estimatedDisabilityDays: 0,
    witnesses: [],
    immediateActions: '',
    attendingDoctorName: '',
    attendingDoctorRut: '',
    attendingDoctorRegistration: '',
    reportDate: today,
    citation: '',
  };
}

const REQUIRED_FIELDS: (keyof Ds67Input)[] = [
  'workerName',
  'workerRut',
  'workerJobTitle',
  'employerName',
  'employerRut',
  'mutualName',
  'accidentDate',
  'accidentTime',
  'accidentLocation',
  'accidentDescription',
  'accidentType',
  'bodyPart',
  'immediateActions',
  'attendingDoctorName',
  'attendingDoctorRut',
  'attendingDoctorRegistration',
  'reportDate',
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
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
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

export function Ds67Modal({ isOpen, onClose }: Ds67ModalProps) {
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();

  const [data, setData] = useState<Ds67Input>(emptyInput());
  const [openSections, setOpenSections] = useState({
    worker: true,
    employer: true,
    accident: false,
    injury: false,
    witnesses: false,
    actions: false,
    doctor: false,
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const update = <K extends keyof Ds67Input>(key: K, value: Ds67Input[K]) =>
    setData(prev => ({ ...prev, [key]: value }));

  const toggle = (s: keyof typeof openSections) =>
    setOpenSections(prev => ({ ...prev, [s]: !prev[s] }));

  const addWitness = () => update('witnesses', [...data.witnesses, emptyWitness()]);
  const updateWitness = (idx: number, patch: Partial<Ds67Witness>) =>
    update('witnesses', data.witnesses.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  const removeWitness = (idx: number) =>
    update('witnesses', data.witnesses.filter((_, i) => i !== idx));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const missing = REQUIRED_FIELDS.filter(f => {
      const v = data[f];
      return v === undefined || v === null || (typeof v === 'string' && v.trim().length === 0);
    });
    if (missing.length > 0) {
      setError(`Completa los campos obligatorios marcados con *: ${missing.join(', ')}`);
      setOpenSections({
        worker: true, employer: true, accident: true, injury: true,
        witnesses: true, actions: true, doctor: true,
      });
      return;
    }

    setGenerating(true);
    try {
      downloadDs67Pdf(data);

      try {
        await addNode({
          type: NodeType.INCIDENT,
          title: `DS 67: ${data.accidentType} — ${data.workerName}`,
          description: `Notificación accidente trabajo. Mutual: ${data.mutualName}. Gravedad: ${data.severity}.`,
          tags: [
            'ds67',
            data.severity,
            ...(data.cieCode ? [data.cieCode] : []),
          ].filter((v, i, arr) => arr.indexOf(v) === i),
          metadata: {
            workerRut: data.workerRut,
            cieCode: data.cieCode || null,
            accidentDate: data.accidentDate,
            severity: data.severity,
            mutualName: data.mutualName,
            estimatedDisabilityDays: data.estimatedDisabilityDays,
          },
          connections: [],
          projectId: selectedProject?.id,
        });
      } catch (zkErr) {
        logger.warn('DS 67 ZK persistence failed', { err: String(zkErr) });
      }

      try {
        const rutHash = await hashRut(data.workerRut);
        await logAuditAction(
          'medicine.ds67.generated',
          'medicine',
          {
            workerRutHash: rutHash,
            severity: data.severity,
            accidentDate: data.accidentDate,
            mutualName: data.mutualName,
          },
          selectedProject?.id,
        );
      } catch (auditErr) {
        logger.warn('DS 67 audit log failed', { err: String(auditErr) });
      }

      setData(emptyInput());
      onClose();
    } catch (err) {
      setError(`Error al generar DS 67: ${String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ds67-title">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 shadow-2xl"
      >
        <div className="sticky top-0 z-10 px-6 py-4 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-white/10 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-teal-400/10 dark:bg-gold-400/10">
            <FileCheck className="w-5 h-5 text-teal-500 dark:text-gold-400" />
          </div>
          <div className="flex-1">
            <h2 id="ds67-title" className="text-base font-black text-zinc-900 dark:text-white">
              Notificación DS 67
            </h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Accidente del trabajo a Mutualidad · Ley 16.744 art. 76 + DS 67/1999
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-3">
          <Section title="1. Trabajador accidentado" open={openSections.worker} onToggle={() => toggle('worker')}>
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
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Fecha nacimiento</span>
                <input type="date" className={inputClass} value={data.workerBirthDate} onChange={e => update('workerBirthDate', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Cargo / Oficio<Required /></span>
                <input className={inputClass} value={data.workerJobTitle} onChange={e => update('workerJobTitle', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Antigüedad (años)</span>
                <input type="number" min={0} className={inputClass} value={data.workerSeniorityYears} onChange={e => update('workerSeniorityYears', parseInt(e.target.value, 10) || 0)} />
              </label>
            </div>
          </Section>

          <Section title="2. Empleador y mutual" open={openSections.employer} onToggle={() => toggle('employer')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Razón social<Required /></span>
                <input className={inputClass} value={data.employerName} onChange={e => update('employerName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">RUT empleador<Required /></span>
                <input className={inputClass} value={data.employerRut} onChange={e => update('employerRut', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Mutual asociada<Required /></span>
                <select className={inputClass} value={data.mutualName} onChange={e => update('mutualName', e.target.value)}>
                  <option value="">Selecciona…</option>
                  <option value="ACHS">ACHS</option>
                  <option value="IST">IST</option>
                  <option value="Mutual CChC">Mutual CChC</option>
                  <option value="ISL">ISL</option>
                </select>
              </label>
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Dirección</span>
                <input className={inputClass} value={data.employerAddress} onChange={e => update('employerAddress', e.target.value)} />
              </label>
            </div>
          </Section>

          <Section title="3. Datos del accidente" open={openSections.accident} onToggle={() => toggle('accident')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Fecha<Required /></span>
                <input type="date" className={inputClass} value={data.accidentDate} onChange={e => update('accidentDate', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Hora<Required /></span>
                <input type="time" className={inputClass} value={data.accidentTime} onChange={e => update('accidentTime', e.target.value)} />
              </label>
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Lugar específico<Required /></span>
                <input className={inputClass} value={data.accidentLocation} onChange={e => update('accidentLocation', e.target.value)} placeholder="Faena Norte — sector chancado, plataforma 3" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Tipo de accidente<Required /></span>
                <input className={inputClass} value={data.accidentType} onChange={e => update('accidentType', e.target.value)} placeholder="Caída a distinto nivel, atrapamiento, etc." />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Código CIE-10</span>
                <input className={inputClass} value={data.cieCode} onChange={e => update('cieCode', e.target.value)} placeholder="S52.5" />
              </label>
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Descripción narrativa<Required /></span>
                <textarea className={`${inputClass} resize-y`} rows={4} value={data.accidentDescription} onChange={e => update('accidentDescription', e.target.value)} />
              </label>
            </div>
          </Section>

          <Section title="4. Lesión" open={openSections.injury} onToggle={() => toggle('injury')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Parte del cuerpo afectada<Required /></span>
                <input className={inputClass} value={data.bodyPart} onChange={e => update('bodyPart', e.target.value)} placeholder="Mano derecha — dedo índice" />
              </label>
              <div className="sm:col-span-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Gravedad<Required /></span>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {SEVERITY_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => update('severity', o.value)}
                      className={`py-3 rounded-xl text-xs font-black uppercase tracking-widest border transition-all ${
                        data.severity === o.value
                          ? `${o.color} bg-teal-400/5 dark:bg-gold-400/5 border-teal-400/40 dark:border-gold-400/40 shadow-sm`
                          : 'text-zinc-500 border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Días incapacidad estimados</span>
                <input type="number" min={0} className={inputClass} value={data.estimatedDisabilityDays} onChange={e => update('estimatedDisabilityDays', parseInt(e.target.value, 10) || 0)} />
              </label>
            </div>
          </Section>

          <Section title="5. Testigos presenciales" open={openSections.witnesses} onToggle={() => toggle('witnesses')}>
            <div className="space-y-3">
              {data.witnesses.length === 0 && (
                <p className="text-xs italic text-zinc-500">Sin testigos registrados.</p>
              )}
              {data.witnesses.map((w, i) => (
                <div key={i} className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 space-y-2 bg-zinc-50/50 dark:bg-zinc-800/30">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600 dark:text-zinc-300">Testigo #{i + 1}</span>
                    <button type="button" onClick={() => removeWitness(i)} className="p-1 rounded-lg text-rose-500 hover:bg-rose-500/10" aria-label="Eliminar testigo">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input className={inputClass} value={w.name} onChange={e => updateWitness(i, { name: e.target.value })} placeholder="Nombre" />
                    <input className={inputClass} value={w.rut} onChange={e => updateWitness(i, { rut: e.target.value })} placeholder="RUT" />
                    <input className={inputClass} value={w.contact || ''} onChange={e => updateWitness(i, { contact: e.target.value })} placeholder="Contacto (opc.)" />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addWitness}
                className="w-full py-2 rounded-xl border-2 border-dashed border-zinc-300 dark:border-white/10 text-xs font-bold text-zinc-500 hover:border-teal-400 hover:text-teal-600 dark:hover:text-gold-400 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Agregar testigo
              </button>
            </div>
          </Section>

          <Section title="6. Acciones inmediatas" open={openSections.actions} onToggle={() => toggle('actions')}>
            <label className="space-y-1 block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Respuesta inmediata<Required /></span>
              <textarea className={`${inputClass} resize-y`} rows={4} value={data.immediateActions} onChange={e => update('immediateActions', e.target.value)} placeholder="Primeros auxilios, traslado, evacuación, autoridades notificadas…" />
            </label>
          </Section>

          <Section title="7. Médico tratante" open={openSections.doctor} onToggle={() => toggle('doctor')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Nombre del médico<Required /></span>
                <input className={inputClass} value={data.attendingDoctorName} onChange={e => update('attendingDoctorName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">RUT médico<Required /></span>
                <input className={inputClass} value={data.attendingDoctorRut} onChange={e => update('attendingDoctorRut', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">N° Reg. SuperSalud<Required /></span>
                <input className={inputClass} value={data.attendingDoctorRegistration} onChange={e => update('attendingDoctorRegistration', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Fecha del reporte<Required /></span>
                <input type="date" className={inputClass} value={data.reportDate} onChange={e => update('reportDate', e.target.value)} />
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
            {generating ? 'Generando…' : 'Generar DS 67 PDF'}
          </button>

          <p className="text-[9px] text-zinc-400 text-center flex items-center justify-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            Plazo legal: 24 horas desde el accidente — Ley 16.744 art. 76 + DS 67/1999
          </p>
        </form>
      </motion.div>
    </div>
  );
}

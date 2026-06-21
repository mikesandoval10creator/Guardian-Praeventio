// Praeventio Guard — DS 76 Mining Contractors management page.
//
// Sprint 24 (Bucket II). Listado de contratistas mineros acreditados bajo el
// DS 76/2007 + acción "Generar DS 76 PDF" para emitir el documento que se
// entrega a la empresa principal y la mutualidad.
//
// Datos persistidos en Firestore en `projects/{id}/miningContractors`.
// Para evitar acoplar este sprint al esquema completo, esta vista trabaja
// sobre un estado local seedeado con un contratista de ejemplo + permite
// generar PDFs reales contra `downloadDs76Pdf`.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Mountain,
  Download,
  Plus,
  Trash2,
  ShieldCheck,
  Building2,
  Users,
} from 'lucide-react';
import {
  downloadDs76Pdf,
  DS76_PROCEDURE_LABELS,
  DS76_STANDARD_LABELS,
  type Ds76Input,
  type Ds76CriticalProcedure,
  type Ds76SgsstStandard,
} from '../utils/ds76MiningContractor';
import { useProject } from '../contexts/ProjectContext';
import { ContractorPerformanceDashboard } from '../components/contractors/ContractorPerformanceDashboard';
import { ContractorRiskRanking } from '../components/contractors/ContractorRiskRanking';

function emptyContractor(): Ds76Input {
  const today = new Date().toISOString().slice(0, 10);
  return {
    worksiteName: '',
    worksiteLocation: '',
    sernageominCode: '',
    principalCompanyName: '',
    principalCompanyRut: '',
    contractorCompanyName: '',
    contractorCompanyRut: '',
    contractName: '',
    contractStartDate: today,
    contractEndDate: today,
    workers: [],
    sgsstStandard: 'iso45001',
    sgsstCertificateNumber: '',
    sgsstCertificateExpiry: '',
    criticalProcedures: [],
    trainings: [],
    contractorRepresentativeName: '',
    contractorRepresentativeRut: '',
    mutualAuditorName: '',
    mutualAuditorRut: '',
    reportDate: today,
    citation: '',
  };
}

const inputClass =
  'px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 w-full';

const ALL_PROCEDURES: Ds76CriticalProcedure[] = [
  'trabajo_altura',
  'espacios_confinados',
  'electrico',
  'caliente',
  'tronadura',
  'izaje',
  'manejo_explosivos',
  'sustancias_peligrosas',
];

const ALL_STANDARDS: Ds76SgsstStandard[] = [
  'iso45001',
  'ohsas18001',
  'inn2393',
  'ninguno',
];

export function MiningContractors() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const [contractors, setContractors] = useState<Ds76Input[]>([emptyContractor()]);
  const [activeIdx, setActiveIdx] = useState(0);

  const active = contractors[activeIdx];

  const updateActive = <K extends keyof Ds76Input>(key: K, value: Ds76Input[K]) =>
    setContractors(prev =>
      prev.map((c, i) => (i === activeIdx ? { ...c, [key]: value } : c)),
    );

  const addContractor = () => {
    setContractors(prev => [...prev, emptyContractor()]);
    setActiveIdx(contractors.length);
  };

  const removeContractor = (idx: number) => {
    setContractors(prev => prev.filter((_, i) => i !== idx));
    setActiveIdx(0);
  };

  const toggleProcedure = (proc: Ds76CriticalProcedure) => {
    const current = active.criticalProcedures;
    updateActive(
      'criticalProcedures',
      current.includes(proc) ? current.filter(p => p !== proc) : [...current, proc],
    );
  };

  const onGenerate = () => {
    if (!active.contractorCompanyName.trim() || !active.worksiteName.trim()) {
      return;
    }
    downloadDs76Pdf(active);
  };

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
          <Mountain className="w-6 h-6 text-amber-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white">
            {t('mining.title', 'Contratistas Mineros')}
          </h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
            {t('mining.subtitle', 'DS 76/2007 · Ley 16.744 art. 66 bis · SERNAGEOMIN')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar list */}
        <div className="lg:col-span-1 space-y-3">
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">
                {t('mining.contractorsHeading', 'Contratistas')}
              </h3>
              <button
                onClick={addContractor}
                className="p-1.5 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20"
                aria-label="Agregar contratista"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {contractors.map((c, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 p-3 rounded-2xl border cursor-pointer transition-all ${
                    activeIdx === i
                      ? 'bg-teal-500/10 border-teal-500/40'
                      : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-white/5 hover:border-teal-300'
                  }`}
                  onClick={() => setActiveIdx(i)}
                >
                  <Building2 className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span className="flex-1 text-xs font-bold text-zinc-900 dark:text-white truncate">
                    {c.contractorCompanyName.trim() || `Contratista #${i + 1}`}
                  </span>
                  {contractors.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeContractor(i); }}
                      className="p-1 text-rose-500 hover:bg-rose-500/10 rounded"
                      aria-label="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Edit form */}
        <motion.div
          key={activeIdx}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="lg:col-span-3 space-y-4"
        >
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">
              {t('mining.worksite', 'Faena minera')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('mining.worksiteName', 'Nombre faena')}</span>
                <input className={inputClass} value={active.worksiteName} onChange={e => updateActive('worksiteName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('mining.sernageominCode', 'Código SERNAGEOMIN')}</span>
                <input className={inputClass} value={active.sernageominCode} onChange={e => updateActive('sernageominCode', e.target.value)} />
              </label>
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('mining.location', 'Ubicación')}</span>
                <input className={inputClass} value={active.worksiteLocation} onChange={e => updateActive('worksiteLocation', e.target.value)} />
              </label>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">
              {t('mining.companies', 'Empresas')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Mandante</span>
                <input className={inputClass} value={active.principalCompanyName} onChange={e => updateActive('principalCompanyName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">RUT mandante</span>
                <input className={inputClass} value={active.principalCompanyRut} onChange={e => updateActive('principalCompanyRut', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Contratista</span>
                <input className={inputClass} value={active.contractorCompanyName} onChange={e => updateActive('contractorCompanyName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">RUT contratista</span>
                <input className={inputClass} value={active.contractorCompanyRut} onChange={e => updateActive('contractorCompanyRut', e.target.value)} />
              </label>
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Contrato (nombre + N°)</span>
                <input className={inputClass} value={active.contractName} onChange={e => updateActive('contractName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Inicio</span>
                <input type="date" className={inputClass} value={active.contractStartDate} onChange={e => updateActive('contractStartDate', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Término</span>
                <input type="date" className={inputClass} value={active.contractEndDate} onChange={e => updateActive('contractEndDate', e.target.value)} />
              </label>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-500" />
              SGSST acreditado
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Estándar</span>
                <select className={inputClass} value={active.sgsstStandard} onChange={e => updateActive('sgsstStandard', e.target.value as Ds76SgsstStandard)}>
                  {ALL_STANDARDS.map(s => (
                    <option key={s} value={s}>{DS76_STANDARD_LABELS[s]}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">N° Certificado</span>
                <input className={inputClass} value={active.sgsstCertificateNumber || ''} onChange={e => updateActive('sgsstCertificateNumber', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Vencimiento</span>
                <input type="date" className={inputClass} value={active.sgsstCertificateExpiry || ''} onChange={e => updateActive('sgsstCertificateExpiry', e.target.value)} />
              </label>
            </div>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Procedimientos críticos</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                {ALL_PROCEDURES.map(p => {
                  const on = active.criticalProcedures.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => toggleProcedure(p)}
                      className={`py-2 px-3 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${
                        on
                          ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400'
                          : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      {DS76_PROCEDURE_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              Firmas
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Representante contratista</span>
                <input className={inputClass} value={active.contractorRepresentativeName} onChange={e => updateActive('contractorRepresentativeName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">RUT representante</span>
                <input className={inputClass} value={active.contractorRepresentativeRut} onChange={e => updateActive('contractorRepresentativeRut', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Auditor mutualidad</span>
                <input className={inputClass} value={active.mutualAuditorName} onChange={e => updateActive('mutualAuditorName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">RUT auditor</span>
                <input className={inputClass} value={active.mutualAuditorRut} onChange={e => updateActive('mutualAuditorRut', e.target.value)} />
              </label>
            </div>
          </div>

          <button
            onClick={onGenerate}
            disabled={!active.contractorCompanyName.trim() || !active.worksiteName.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-amber-500/20 disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            Generar DS 76 PDF
          </button>
        </motion.div>
      </div>

      {/* Per-contractor safety performance (TRIR/LTIFR) from REAL incidents +
          captured contractor man-hours. Scoped to the selected project. */}
      <ContractorPerformanceDashboard projectId={selectedProject?.id ?? null} />

      {/* Executive risk ranking: ranks the SAME real per-contractor injury
          rates worst-first for the contract manager's renewal decision. */}
      <ContractorRiskRanking projectId={selectedProject?.id ?? null} />
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCheck, Download, X, Plus, ShieldCheck } from 'lucide-react';
import { MedicalIcon } from '../medical/MedicalIcon';
import { generateAptitudeCertificate, AptitudeData } from '../../utils/aptitudeCertificate';

const RESULT_OPTION_KEYS: { value: AptitudeData['result']; key: string; fallback: string; color: string }[] = [
  { value: 'apto', key: 'aptitude_certificate.result_apto', fallback: 'Apto', color: 'text-teal-400 dark:text-teal-400' },
  { value: 'apto_con_restricciones', key: 'aptitude_certificate.result_apto_restrictions', fallback: 'Apto con restricciones', color: 'text-amber-600 dark:text-amber-400' },
  { value: 'no_apto', key: 'aptitude_certificate.result_no_apto', fallback: 'No apto', color: 'text-rose-600 dark:text-rose-400' },
];

const EXAM_OPTION_KEYS: { value: AptitudeData['examType']; key: string; fallback: string }[] = [
  { value: 'pre_empleo', key: 'aptitude_certificate.exam_pre_empleo', fallback: 'Pre-empleo' },
  { value: 'periodico', key: 'aptitude_certificate.exam_periodico', fallback: 'Periódico' },
  { value: 'reintegro', key: 'aptitude_certificate.exam_reintegro', fallback: 'Reintegro laboral' },
  { value: 'egreso', key: 'aptitude_certificate.exam_egreso', fallback: 'Egreso' },
  { value: 'otro', key: 'aptitude_certificate.exam_otro', fallback: 'Otro' },
];

export function AptitudeCertificateForm() {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [data, setData] = useState<AptitudeData>({
    workerName: '',
    workerRut: '',
    workerOccupation: '',
    projectName: '',
    examType: 'pre_empleo',
    examDate: today,
    result: 'apto',
    restrictions: [],
    validUntil: oneYear,
    doctorName: '',
    doctorRut: '',
    doctorRegistry: '',
    observations: '',
  });
  const [restrictionDraft, setRestrictionDraft] = useState('');

  const update = <K extends keyof AptitudeData>(key: K, value: AptitudeData[K]) =>
    setData(prev => ({ ...prev, [key]: value }));

  const addRestriction = () => {
    const v = restrictionDraft.trim();
    if (!v) return;
    update('restrictions', [...(data.restrictions ?? []), v]);
    setRestrictionDraft('');
  };

  const removeRestriction = (i: number) =>
    update('restrictions', (data.restrictions ?? []).filter((_, idx) => idx !== i));

  const onGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    generateAptitudeCertificate(data);
  };

  const showRestrictions = data.result === 'apto_con_restricciones';

  return (
    <form onSubmit={onGenerate} className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200/50 dark:border-white/5 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-teal-400/10 dark:bg-gold-400/10">
          <FileCheck className="w-4 h-4 text-teal-400 dark:text-gold-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-zinc-900 dark:text-white">{t('aptitude_certificate.title', 'Certificado de Aptitud DS 109')}</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{t('aptitude_certificate.subtitle', 'Genera PDF firmable conforme Ley 16.744')}</p>
        </div>
        {/* Sprint 17c — Bioicons exam-type cluster (vision / spirometry / audiometry). */}
        <div className="hidden sm:flex items-center gap-2 text-teal-600 dark:text-gold-400" aria-hidden="true">
          <MedicalIcon name="eye" size={20} alt={t('aptitude_certificate.icon_alt_eye', 'Examen visual')} />
          <MedicalIcon name="spirometer" size={20} alt={t('aptitude_certificate.icon_alt_spirometer', 'Espirometría')} />
          <MedicalIcon name="audiometer" size={20} alt={t('aptitude_certificate.icon_alt_audiometer', 'Audiometría')} />
        </div>
        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest bg-teal-400/10 dark:bg-gold-400/10 text-teal-600 dark:text-gold-400 border border-teal-400/20 dark:border-gold-400/20 uppercase">
          {t('aptitude_certificate.badge_medical', 'Médico')}
        </span>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">{t('aptitude_certificate.section_worker', 'Trabajador')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input required value={data.workerName} onChange={e => update('workerName', e.target.value)} placeholder={t('aptitude_certificate.field_full_name_placeholder', 'Nombre completo *')} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
            <input required value={data.workerRut} onChange={e => update('workerRut', e.target.value)} placeholder={t('aptitude_certificate.field_rut_placeholder', 'RUT *')} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
            <input required value={data.workerOccupation} onChange={e => update('workerOccupation', e.target.value)} placeholder={t('aptitude_certificate.field_occupation_placeholder', 'Ocupación *')} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
            <input type="number" value={data.workerAge ?? ''} onChange={e => update('workerAge', e.target.value ? parseInt(e.target.value, 10) : undefined)} placeholder={t('aptitude_certificate.field_age_placeholder', 'Edad')} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
            <input required value={data.projectName} onChange={e => update('projectName', e.target.value)} placeholder={t('aptitude_certificate.field_project_placeholder', 'Proyecto / Empresa *')} className="sm:col-span-2 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
          </div>
        </div>

        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">{t('aptitude_certificate.section_exam', 'Examen')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={data.examType} onChange={e => update('examType', e.target.value as AptitudeData['examType'])} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40">
              {EXAM_OPTION_KEYS.map(o => <option key={o.value} value={o.value}>{t(o.key, o.fallback)}</option>)}
            </select>
            <input type="date" value={data.examDate} onChange={e => update('examDate', e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
            <input type="date" value={data.validUntil ?? ''} onChange={e => update('validUntil', e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
          </div>
        </div>

        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">{t('aptitude_certificate.section_dictamen', 'Dictamen *')}</p>
          <div className="grid grid-cols-3 gap-2">
            {RESULT_OPTION_KEYS.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => update('result', o.value)}
                className={`py-3 rounded-xl text-xs font-black uppercase tracking-widest border transition-all ${
                  data.result === o.value
                    ? `${o.color} bg-teal-400/5 dark:bg-gold-400/5 border-teal-400/40 dark:border-gold-400/40 shadow-sm`
                    : 'text-zinc-500 border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                {t(o.key, o.fallback)}
              </button>
            ))}
          </div>
        </div>

        {showRestrictions && (
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">{t('aptitude_certificate.section_restrictions', 'Restricciones laborales')}</p>
            <div className="flex gap-2">
              <input
                value={restrictionDraft}
                onChange={e => setRestrictionDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRestriction(); } }}
                placeholder={t('aptitude_certificate.field_restriction_placeholder', 'Ej: No exposición a ruido >85dB')}
                className="flex-1 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40"
              />
              <button type="button" onClick={addRestriction} className="px-4 rounded-xl bg-teal-400/10 text-teal-600 dark:text-gold-400 border border-teal-400/20 hover:bg-teal-400/20 transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {(data.restrictions?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {data.restrictions!.map((r, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                    {r}
                    <button type="button" onClick={() => removeRestriction(i)} className="hover:text-amber-900 dark:hover:text-amber-300">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">{t('aptitude_certificate.section_doctor', 'Médico responsable')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input required value={data.doctorName} onChange={e => update('doctorName', e.target.value)} placeholder={t('aptitude_certificate.field_doctor_name_placeholder', 'Nombre Dr. *')} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
            <input required value={data.doctorRut} onChange={e => update('doctorRut', e.target.value)} placeholder={t('aptitude_certificate.field_doctor_rut_placeholder', 'RUT médico *')} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
            <input required value={data.doctorRegistry} onChange={e => update('doctorRegistry', e.target.value)} placeholder={t('aptitude_certificate.field_doctor_registry_placeholder', 'N° Reg. SuperSalud *')} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40" />
          </div>
        </div>

        <textarea
          value={data.observations ?? ''}
          onChange={e => update('observations', e.target.value)}
          placeholder={t('aptitude_certificate.field_observations_placeholder', 'Observaciones clínicas (opcional)…')}
          rows={2}
          className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/40 resize-none"
        />

        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-400 hover:bg-teal-500 text-white text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-teal-400/20"
        >
          <Download className="w-4 h-4" />
          {t('aptitude_certificate.btn_generate', 'Generar y descargar certificado PDF')}
        </button>

        <p className="text-[9px] text-zinc-400 text-center flex items-center justify-center gap-1">
          <ShieldCheck className="w-3 h-3" />
          {t('aptitude_certificate.legal_footer', 'Conforme DS 109 Reglamento Ley 16.744 — Vigilancia médica ocupacional')}
        </p>
      </div>
    </form>
  );
}

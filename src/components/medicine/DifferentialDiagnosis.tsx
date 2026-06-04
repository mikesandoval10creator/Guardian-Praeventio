// Praeventio Guard — B7 / ADR 0012 (2026-06).
//
// This tab used to POST symptoms to Gemini (`differentialDiagnosis`) and render
// a ranked list of conditions with probabilities + a "suggested treatment" —
// i.e. it diagnosed. ADR 0012 forbids that, and the action was already
// de-whitelisted in ALLOWED_GEMINI_ACTIONS (so the form was a dead, rejected
// diagnostic surface).
//
// Reconverted to what it should be: an EDUCATIONAL CIE-10 reference the worker
// (or prevencionista) BROWSES to learn vocabulary and find "what does this
// resemble?" — so they can articulate their symptoms to a REAL doctor. The app
// never infers a condition from the worker's symptoms; the worker explores a
// curated, CC0-licensed catalog. Keeps the (already-conforming) CatalogBrowser.

import { useTranslation } from 'react-i18next';
import { BookOpen, Stethoscope } from 'lucide-react';
import { MedicalIcon } from '../medical/MedicalIcon';
import { CatalogBrowser } from './CatalogBrowser';
import { diagnoses, diagnosesMeta, type DiagnosisEntry } from '../../data/medical';
import { MedicalDisclaimer } from '../health/MedicalDisclaimer';

export function DifferentialDiagnosis() {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200/50 dark:border-white/5 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-teal-400/10 dark:bg-gold-400/10">
          <BookOpen className="w-4 h-4 text-teal-500 dark:text-gold-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-zinc-900 dark:text-white">
            {t('differential_dx.title', 'Referencia clínica CIE-10')}
          </p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            {t('differential_dx.subtitle', 'Explora a qué se parece lo que sientes — para conversarlo con tu médico. No es un diagnóstico.')}
          </p>
        </div>
        {/* Bioicons system glyphs — decorative. */}
        <div className="hidden sm:flex items-center gap-1.5 text-teal-600 dark:text-gold-400" aria-hidden="true">
          <MedicalIcon name="lung-pair" size={20} alt={t('differential_dx.icon_alt_lungs', 'Pulmones')} />
          <MedicalIcon name="heart-anatomical" size={20} alt={t('differential_dx.icon_alt_heart', 'Corazón')} />
          <MedicalIcon name="brain" size={20} alt={t('differential_dx.icon_alt_brain', 'Cerebro')} />
        </div>
        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest bg-teal-400/10 dark:bg-gold-400/10 text-teal-600 dark:text-gold-400 border border-teal-400/20 dark:border-gold-400/20 uppercase">
          {t('differential_dx.badge_reference', 'Referencia')}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* ADR 0012 — referencia educativa, la app no diagnostica. */}
        <MedicalDisclaimer variant="compact" />

        <div className="flex items-start gap-2 p-3 rounded-xl bg-teal-400/5 dark:bg-gold-400/5 border border-teal-400/10 dark:border-gold-400/10">
          <Stethoscope className="w-4 h-4 text-teal-500 dark:text-gold-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
            {t(
              'differential_dx.education_help',
              'Busca el agente de riesgo o la zona afectada para conocer las enfermedades ocupacionales relacionadas. Úsalo para entender y describir lo que sientes — la evaluación la hace siempre un profesional de salud.',
            )}
          </p>
        </div>

        {/* CIE-10 SST catalog — CC0 reference data (educational, offline-first). */}
        <CatalogBrowser<DiagnosisEntry>
          title={t('differential_dx.catalog_title', 'Catálogo CIE-10 SST')}
          badge="CC0"
          items={diagnoses}
          searchKeys={['code', 'name', 'category', 'riskAgents', 'description']}
          getPrimary={(d) => d.code}
          getLabel={(d) => d.name}
          placeholder={t('differential_dx.catalog_placeholder', 'Buscar código, síntoma o agente (ej: sílice, J62, lumbago)')}
          metaFooter={`${diagnosesMeta.license} · ${diagnosesMeta.source}`}
          renderDetail={(d) => (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px] font-mono font-black tracking-widest border border-violet-500/20">
                  {d.code}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700/60 text-[9px] font-bold text-zinc-600 dark:text-zinc-300 uppercase">
                  {d.category}
                </span>
                {d.occupational && (
                  <span className="px-1.5 py-0.5 rounded bg-teal-400/10 text-teal-600 dark:text-gold-400 text-[9px] font-bold border border-teal-400/20 uppercase">
                    {t('differential_dx.catalog_occupational', 'Ocupacional')}
                  </span>
                )}
              </div>
              <p className="text-sm font-black text-zinc-900 dark:text-white">{d.name}</p>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">{d.description}</p>
              {d.riskAgents.length > 0 && (
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
                    {t('differential_dx.catalog_risk_agents', 'Agentes de riesgo')}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {d.riskAgents.map((r) => (
                      <span key={r} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-bold border border-amber-500/20">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        />
      </div>
    </div>
  );
}

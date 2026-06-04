// Praeventio Guard — B7 / ADR 0012 (2026-06).
//
// This tab used to POST a drug list + patient context to Gemini
// (`checkDrugInteractions`) and render clinical decision support — severity per
// pair, "safe to administer?", "review with specialist". That is clinical
// advice, which ADR 0012 forbids; and `checkDrugInteractions` was already
// de-whitelisted in ALLOWED_GEMINI_ACTIONS (dead, rejected surface).
//
// Reconverted to an EDUCATIONAL pharmacology reference: keep the
// already-conforming Vademécum ATC CatalogBrowser (CC0) so the worker learns
// how the compounds they're exposed to at work act and interact in the body.
// For indications about their own medication, the user is pointed to a doctor /
// químico farmacéutico — the app never tells anyone what is safe to take.

import { useTranslation } from 'react-i18next';
import { AlertCircle, BookOpen } from 'lucide-react';
import { MedicalIcon } from '../medical/MedicalIcon';
import { CatalogBrowser } from './CatalogBrowser';
import { drugs as drugsCatalog, drugsMeta, type DrugEntry } from '../../data/medical';
import { MedicalDisclaimer } from '../health/MedicalDisclaimer';

export function DrugInteractions() {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200/50 dark:border-white/5 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-teal-400/10 dark:bg-gold-400/10">
          <BookOpen className="w-4 h-4 text-teal-400 dark:text-gold-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-zinc-900 dark:text-white">
            {t('drug_interactions.title', 'Vademécum ATC — referencia farmacológica')}
          </p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            {t('drug_interactions.subtitle', 'Conoce cómo los compuestos actúan e interactúan en el cuerpo. No es indicación médica.')}
          </p>
        </div>
        {/* Bioicons pharma glyphs — decorative. */}
        <div className="hidden sm:flex items-center gap-1.5 text-teal-600 dark:text-gold-400" aria-hidden="true">
          <MedicalIcon name="pill" size={20} alt={t('medicine.icon_alt_pill', 'Pastilla')} />
          <MedicalIcon name="syringe" size={20} alt={t('drug_interactions.icon_alt_injectable', 'Inyectable')} />
          <MedicalIcon name="iv-bag" size={20} alt={t('drug_interactions.icon_alt_iv_bag', 'Suero IV')} />
        </div>
        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest bg-teal-400/10 dark:bg-gold-400/10 text-teal-600 dark:text-gold-400 border border-teal-400/20 dark:border-gold-400/20 uppercase">
          {t('drug_interactions.badge_reference', 'Referencia')}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* ADR 0012 — referencia educativa, la app no indica medicación. */}
        <MedicalDisclaimer variant="compact" />

        <div className="flex items-start gap-2 p-3 rounded-xl bg-teal-400/5 dark:bg-gold-400/5 border border-teal-400/10 dark:border-gold-400/10">
          <AlertCircle className="w-4 h-4 text-teal-500 dark:text-gold-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
            {t(
              'drug_interactions.education_help',
              'Aprende cómo los medicamentos y los compuestos a los que te expones en el trabajo actúan en tu cuerpo. Para indicaciones sobre tus propios medicamentos, consulta siempre a un médico o químico farmacéutico.',
            )}
          </p>
        </div>

        {/* Vademécum ATC SST — CC0 reference data (educational, offline-first). */}
        <CatalogBrowser<DrugEntry>
          title={t('drug_interactions.catalog_title', 'Vademécum ATC SST')}
          badge="CC0"
          items={drugsCatalog}
          searchKeys={['name', 'atc', 'category', 'occupationalRelevance', 'interactions']}
          getPrimary={(d) => d.atc}
          getLabel={(d) => d.name}
          placeholder={t('drug_interactions.catalog_placeholder', 'Buscar fármaco, código ATC o categoría (ej: salbutamol, broncodilatador)')}
          metaFooter={`${drugsMeta.license} · ${drugsMeta.source}`}
          renderDetail={(d) => (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px] font-mono font-black tracking-widest border border-violet-500/20">
                  {d.atc}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700/60 text-[9px] font-bold text-zinc-600 dark:text-zinc-300 uppercase">
                  {d.category}
                </span>
              </div>
              <p className="text-sm font-black text-zinc-900 dark:text-white">{d.name}</p>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">{d.occupationalRelevance}</p>
              {d.interactions && d.interactions.length > 0 && (
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
                    {t('drug_interactions.catalog_interactions', 'Interacciones clínicas relevantes')}
                  </p>
                  <ul className="space-y-1">
                    {d.interactions.map((it) => (
                      <li key={it} className="text-[10px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        />
      </div>
    </div>
  );
}

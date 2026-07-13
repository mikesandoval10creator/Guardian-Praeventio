// Praeventio Guard — Wire UI #76: <OccupationalContextBundleCard />
//
// Renderiza el bundle ocupacional informativo destinado al MÉDICO
// TRATANTE. La app NO diagnostica — solo organiza. Disclaimer
// obligatorio siempre visible.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Stethoscope, Briefcase, Activity } from 'lucide-react';
import {
  summarizeBundle,
  type OccupationalContextBundle,
} from '../../services/health/occupationalContextClient.js';
import { MedicalDisclaimer } from './MedicalDisclaimer';

interface OccupationalContextBundleCardProps {
  bundle: OccupationalContextBundle;
}

export function OccupationalContextBundleCard({
  bundle,
}: OccupationalContextBundleCardProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeBundle(bundle), [bundle]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`occ-bundle-${bundle.workerUid}`}
      aria-label={t('occBundle.aria', 'Bundle contexto ocupacional') as string}
    >
      <header className="flex items-center gap-2">
        <Stethoscope className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('occBundle.title', 'Contexto ocupacional')}
        </h2>
        <span className="ml-auto text-[10px] uppercase text-secondary-token tabular-nums">
          {bundle.workerUid}
        </span>
      </header>

      <div data-testid={`occ-bundle-disclaimer-${bundle.workerUid}`}>
        <MedicalDisclaimer variant="compact" />
        <p className="text-[10px] text-secondary-token italic bg-sky-500/5 p-2 rounded mt-1">
          {bundle.disclaimer}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface-elevated rounded p-2" data-testid={`occ-years-${bundle.workerUid}`}>
          <p className="text-[10px] uppercase text-secondary-token flex items-center gap-1">
            <Briefcase className="w-3 h-3" aria-hidden="true" />
            {t('occBundle.years', 'Años laborales')}
          </p>
          <p className="text-xl font-black tabular-nums">{summary.yearsOfLaborHistory}</p>
        </div>
        <div
          className="bg-surface-elevated rounded p-2"
          data-testid={`occ-symptoms-${bundle.workerUid}`}
        >
          <p className="text-[10px] uppercase text-secondary-token flex items-center gap-1">
            <Activity className="w-3 h-3" aria-hidden="true" />
            {t('occBundle.symptoms', 'Síntomas reportados')}
          </p>
          <p className="text-xl font-black tabular-nums">
            {bundle.selfReportedSymptoms.length}
          </p>
        </div>
      </div>

      {summary.uniqueRiskAgents.length > 0 && (
        <div data-testid={`occ-risks-${bundle.workerUid}`}>
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('occBundle.riskAgents', 'Agentes de riesgo declarados')}
          </h3>
          <div className="flex flex-wrap gap-1">
            {summary.uniqueRiskAgents.map((a) => (
              <span
                key={a}
                className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300"
                data-testid={`occ-risk-${bundle.workerUid}-${a}`}
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      {summary.ergonomicHotspots.length > 0 && (
        <div data-testid={`occ-hotspots-${bundle.workerUid}`}>
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('occBundle.hotspots', 'Zonas ergonómicas afectadas')}
          </h3>
          <ul className="space-y-1">
            {summary.ergonomicHotspots.slice(0, 5).map((h) => (
              <li
                key={h.zone}
                data-testid={`occ-hotspot-${bundle.workerUid}-${h.zone}`}
                className="flex justify-between text-[11px] bg-surface-elevated rounded px-2 py-1"
              >
                <span className="uppercase font-bold">{h.zone}</span>
                <span className="tabular-nums text-secondary-token">
                  REBA {h.avgReba.toFixed(1)} ({h.observationCount}x)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.symptomBodyPartFrequency.length > 0 && (
        <div data-testid={`occ-symptom-freq-${bundle.workerUid}`}>
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('occBundle.symptomFreq', 'Frecuencia síntomas por zona')}
          </h3>
          <ul className="space-y-1">
            {summary.symptomBodyPartFrequency.slice(0, 5).map((s) => (
              <li
                key={s.bodyPart}
                data-testid={`occ-symptom-${bundle.workerUid}-${s.bodyPart}`}
                className="flex justify-between text-[11px] bg-surface-elevated rounded px-2 py-1"
              >
                <span className="uppercase font-bold">{s.bodyPart}</span>
                <span className="tabular-nums text-secondary-token">
                  {s.count}x · severidad {s.avgSeverity.toFixed(1)}/5
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

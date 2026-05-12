// Praeventio Guard — Wire UI #24: <ShiftQualityCard />
//
// Card que muestra calidad del handover del turno: score, categorías
// faltantes, urgent notes count. Use case: dashboard supervisor.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, AlertTriangle } from 'lucide-react';
import {
  computeHandoverQuality,
} from '../../services/shiftHandover/shiftHandoverInsights.js';
import type {
  ShiftRecord,
  HandoverCategory,
} from '../../services/shiftHandover/shiftHandoverService.js';

interface ShiftQualityCardProps {
  shift: ShiftRecord;
  onAddNote?: (category: HandoverCategory) => void;
}

const LEVEL_CLASS = {
  excellent: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  good: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  fair: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  poor: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
};

const CATEGORY_LABEL: Record<HandoverCategory, string> = {
  open_incidents: 'Incidentes abiertos',
  equipment_down: 'Equipos detenidos',
  pending_controls: 'Controles pendientes',
  absent_workers: 'Trabajadores ausentes',
  restricted_zones: 'Zonas restringidas',
  active_permits: 'Permisos activos',
  admin_pending: 'Pendientes admin',
  weather_alert: 'Alerta climática',
  observation: 'Observación',
};

export function ShiftQualityCard({ shift, onAddNote }: ShiftQualityCardProps) {
  const { t } = useTranslation();
  const quality = useMemo(() => computeHandoverQuality(shift), [shift]);

  return (
    <section
      className={`rounded-2xl border-2 p-4 shadow-mode ${LEVEL_CLASS[quality.level]}`}
      data-testid="shift-quality-card"
      aria-label={t('shiftQuality.aria', 'Calidad del handover') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wide">
          {t('shiftQuality.title', 'Calidad Handover')}
        </h2>
        <span className="ml-auto text-2xl font-black tabular-nums" data-testid="shift-quality-score">
          {quality.qualityScore}
        </span>
      </header>

      <p className="text-[10px] uppercase opacity-80 mb-2">
        {t('shiftQuality.level', 'Nivel')}: <strong>{quality.level}</strong> ·{' '}
        {quality.totalNotes} {t('shiftQuality.notes', 'notas')} · {quality.urgentNotes}{' '}
        {t('shiftQuality.urgent', 'urgentes')}
      </p>

      {quality.missingCriticalCategories.length > 0 && (
        <div data-testid="shift-missing-critical">
          <p className="text-xs font-bold mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {t('shiftQuality.missingCritical', 'Categorías críticas faltantes')}
          </p>
          <ul className="flex flex-wrap gap-1">
            {quality.missingCriticalCategories.map((cat) => (
              <li key={cat}>
                <button
                  type="button"
                  onClick={() => onAddNote?.(cat)}
                  disabled={!onAddNote}
                  data-testid={`shift-add-note-${cat}`}
                  className="text-[10px] px-2 py-0.5 rounded bg-current/15 hover:brightness-110 disabled:cursor-default"
                >
                  + {CATEGORY_LABEL[cat]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

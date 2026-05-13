// Praeventio Guard — Wire UI: <RaciHealthCard />
//
// Sprint 53 §50-58: visualiza salud RACI a nivel proyecto. Consume
// `summarizeRaciHealth()` + opcionalmente `findCriticalGaps()` upstream
// y deja al caller cablear datos + persistencia.
//
// Muestra:
//   - Resumen agregado (matrices total, válidas, gaps críticos, uids overloaded)
//   - Lista priorizada de matrices con violaciones (la primera línea de
//     defensa para que el prevencionista vea por qué algo está rojo)
//   - Quick action por violación: revisar matriz / asignar accountable

import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  AlertTriangle,
  Users,
  ShieldAlert,
  GitMerge,
} from 'lucide-react';
import type {
  RaciMatrix,
  ValidationKind,
} from '../../services/raciMatrix/raciMatrixEngine.js';

interface RaciHealthCardProps {
  /** Resumen agregado (de `summarizeRaciHealth()`). */
  summary: {
    totalMatrices: number;
    validMatrices: number;
    criticalGapCount: number;
    overloadedUids: string[];
  };
  /** Matrices completas — solo se muestran las inválidas. */
  matrices: RaciMatrix[];
  /** Lookup uid → nombre humano (para badges overload). */
  uidNameLookup?: Record<string, string>;
  /** Callback al hacer click "Revisar" sobre una matrix con violaciones. */
  onReviewMatrix?: (matrix: RaciMatrix) => void;
}

const VIOLATION_LABEL: Record<ValidationKind, string> = {
  no_accountable: 'Sin Accountable',
  multiple_accountable: 'Múltiples Accountables',
  no_responsible: 'Sin Responsible',
  role_overload_single_uid: 'UID con roles excesivos',
  consulted_missing_for_critical: 'Consulted faltante en tarea crítica',
  informed_too_many: 'Informed list demasiado larga',
};

export function RaciHealthCard({
  summary,
  matrices,
  uidNameLookup = {},
  onReviewMatrix,
}: RaciHealthCardProps) {
  const { t } = useTranslation();

  const invalidMatrices = matrices.filter((m) => !m.valid);
  const allHealthy =
    summary.totalMatrices > 0 &&
    summary.validMatrices === summary.totalMatrices &&
    summary.criticalGapCount === 0 &&
    summary.overloadedUids.length === 0;

  return (
    <section
      className="rounded-2xl border border-stone-500/30 bg-white/60 dark:bg-stone-900/40 p-4"
      data-testid="raci-health-card"
      aria-label={t('raci.cardAria', 'Estado de salud RACI del proyecto') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <GitMerge className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-200">
          {t('raci.title', 'Salud RACI del proyecto')}
        </h2>
        {allHealthy && (
          <span
            data-testid="raci-all-healthy"
            className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold text-emerald-700 dark:text-emerald-300"
          >
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            {t('raci.healthy', 'Saludable')}
          </span>
        )}
      </header>

      {/* Summary tiles */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3"
        data-testid="raci-summary-tiles"
      >
        <SummaryTile
          label={t('raci.totalMatrices', 'Matrices') as string}
          value={summary.totalMatrices}
          accent="default"
          testId="raci-tile-total"
        />
        <SummaryTile
          label={t('raci.validMatrices', 'Válidas') as string}
          value={summary.validMatrices}
          accent="success"
          testId="raci-tile-valid"
        />
        <SummaryTile
          label={t('raci.criticalGaps', 'Gaps críticos') as string}
          value={summary.criticalGapCount}
          accent={summary.criticalGapCount > 0 ? 'danger' : 'default'}
          testId="raci-tile-gaps"
        />
        <SummaryTile
          label={t('raci.overloadedUids', 'Sobrecargados') as string}
          value={summary.overloadedUids.length}
          accent={summary.overloadedUids.length > 0 ? 'warning' : 'default'}
          testId="raci-tile-overloaded"
        />
      </div>

      {/* Overloaded uids badges */}
      {summary.overloadedUids.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1 mb-3"
          data-testid="raci-overloaded-list"
        >
          <Users className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
          <span className="text-[10px] uppercase tracking-wide font-bold text-amber-700 dark:text-amber-300 mr-1">
            {t('raci.overloadedLabel', 'Roles excesivos')}:
          </span>
          {summary.overloadedUids.map((uid) => (
            <span
              key={uid}
              data-testid={`raci-overloaded-${uid}`}
              className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-[10px] font-mono text-amber-700 dark:text-amber-300"
            >
              {uidNameLookup[uid] ?? uid}
            </span>
          ))}
        </div>
      )}

      {/* Invalid matrices list */}
      {invalidMatrices.length === 0 ? (
        <p
          className="text-xs italic text-stone-600 dark:text-stone-400 flex items-center gap-1.5"
          data-testid="raci-no-invalid"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
          {t('raci.noInvalid', 'Ninguna matriz con violaciones')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="raci-invalid-list">
          {invalidMatrices.map((m) => (
            <li
              key={m.taskId}
              data-testid={`raci-invalid-${m.taskId}`}
              className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="w-4 h-4 text-rose-600 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-stone-800 dark:text-stone-100 leading-tight truncate">
                    {m.taskTitle}
                    {m.critical && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wide font-bold text-rose-700 dark:text-rose-300">
                        <ShieldAlert className="w-2.5 h-2.5" aria-hidden="true" />
                        crit
                      </span>
                    )}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {m.violations.map((v, i) => (
                      <li
                        key={i}
                        data-testid={`raci-violation-${m.taskId}-${v.kind}`}
                        className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug"
                      >
                        • {VIOLATION_LABEL[v.kind]} — {v.detail}
                      </li>
                    ))}
                  </ul>
                </div>
                {onReviewMatrix && (
                  <button
                    type="button"
                    onClick={() => onReviewMatrix(m)}
                    data-testid={`raci-review-${m.taskId}`}
                    className="px-2 py-1 rounded-md bg-rose-600 text-white text-[11px] font-bold hover:brightness-110 shrink-0"
                  >
                    {t('raci.review', 'Revisar')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Internal: summary tile
// ────────────────────────────────────────────────────────────────────────

interface SummaryTileProps {
  label: string;
  value: number;
  accent: 'default' | 'success' | 'warning' | 'danger';
  testId: string;
}

const ACCENT_CLASS: Record<SummaryTileProps['accent'], string> = {
  default: 'bg-stone-500/10 border-stone-500/30 text-stone-700 dark:text-stone-200',
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
  danger: 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300',
};

function SummaryTile({ label, value, accent, testId }: SummaryTileProps) {
  return (
    <div
      data-testid={testId}
      className={`rounded-md border px-2 py-1.5 text-center ${ACCENT_CLASS[accent]}`}
    >
      <p className="text-lg font-black leading-none">{value}</p>
      <p className="text-[9px] uppercase tracking-wide font-bold mt-0.5">{label}</p>
    </div>
  );
}

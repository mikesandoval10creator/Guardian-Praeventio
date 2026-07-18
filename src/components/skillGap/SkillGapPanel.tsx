// Praeventio Guard — Bloque D Rama 2: <SkillGapPanel />
//
// Self-contained skill-gap analysis form over the pure-compute endpoint
// POST /api/sprint-k/:projectId/skills/analyze-gaps
// (src/server/routes/skillGap.ts), consumed via the previously-orphaned
// client hook src/hooks/useSkillGap.ts.
//
// Minimal v1 form: one worker skill level + one requirement → gap list.
// The other three endpoints (training plan, polyvalence matrix,
// substitutes) stay hook-only until their UI slice lands.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap, AlertTriangle } from 'lucide-react';
import { analyzeWorkerSkillGaps } from '../../hooks/useSkillGap';
import type {
  SkillGap,
  SkillProficiencyLevel,
} from '../../services/skillGap/skillGapAnalyzer';
import { humanErrorMessage } from '../../lib/humanError';


interface SkillGapPanelProps {
  projectId: string;
}

// Closed vocabulary — mirrors SkillProficiencyLevel in the calc engine.
const LEVEL_OPTIONS: Array<{ value: SkillProficiencyLevel; label: string }> = [
  { value: 'none', label: 'Sin conocimiento' },
  { value: 'aware', label: 'Conoce (solo charla)' },
  { value: 'novice', label: 'Capacitado con supervisión' },
  { value: 'competent', label: 'Autónomo autorizado' },
  { value: 'proficient', label: 'Puede enseñar' },
  { value: 'expert', label: 'Referente técnico' },
];

const LEVEL_LABELS: Record<SkillProficiencyLevel, string> = Object.fromEntries(
  LEVEL_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SkillProficiencyLevel, string>;

export function SkillGapPanel({ projectId }: SkillGapPanelProps) {
  const { t } = useTranslation();
  const [workerUid, setWorkerUid] = useState('');
  const [skillId, setSkillId] = useState('');
  const [currentLevel, setCurrentLevel] = useState<SkillProficiencyLevel>('none');
  const [requiredLevel, setRequiredLevel] = useState<SkillProficiencyLevel>('competent');
  const [critical, setCritical] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gaps, setGaps] = useState<SkillGap[] | null>(null);

  const canSubmit = workerUid.trim().length > 0 && skillId.trim().length > 0 && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeWorkerSkillGaps(projectId, {
        workerSkills: [
          {
            workerUid: workerUid.trim(),
            skillId: skillId.trim(),
            level: currentLevel,
            attainedAt: new Date().toISOString().slice(0, 10),
          },
        ],
        requirements: [
          { skillId: skillId.trim(), minLevel: requiredLevel, critical },
        ],
      });
      setGaps(res.gaps);
    } catch (err) {
      setGaps(null);
      setError(humanErrorMessage(err instanceof Error ? err.message : 'unknown_error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="skill-gap-panel"
      aria-label={t('skillGap.panel.aria', 'Análisis de brechas de competencias') as string}
    >
      <header className="flex items-center gap-2">
        <GraduationCap className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('skillGap.panel.title', 'Brecha de competencia por trabajador')}
        </h2>
      </header>

      <p className="text-[11px] text-secondary-token">
        {t(
          'skillGap.panel.description',
          'Compara el nivel actual del trabajador contra el nivel mínimo requerido para la tarea.',
        )}
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('skillGap.panel.workerUid', 'ID trabajador')}
          </span>
          <input
            type="text"
            value={workerUid}
            onChange={(e) => setWorkerUid(e.target.value)}
            data-testid="skill-gap-worker"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('skillGap.panel.workerUid', 'ID trabajador') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('skillGap.panel.skillId', 'ID competencia')}
          </span>
          <input
            type="text"
            value={skillId}
            onChange={(e) => setSkillId(e.target.value)}
            data-testid="skill-gap-skill"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('skillGap.panel.skillId', 'ID competencia') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('skillGap.panel.currentLevel', 'Nivel actual')}
          </span>
          <select
            value={currentLevel}
            onChange={(e) => setCurrentLevel(e.target.value as SkillProficiencyLevel)}
            data-testid="skill-gap-current-level"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {LEVEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('skillGap.panel.requiredLevel', 'Nivel mínimo requerido')}
          </span>
          <select
            value={requiredLevel}
            onChange={(e) => setRequiredLevel(e.target.value as SkillProficiencyLevel)}
            data-testid="skill-gap-required-level"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {LEVEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={critical}
            onChange={(e) => setCritical(e.target.checked)}
            data-testid="skill-gap-critical"
          />
          <span className="text-[10px] uppercase text-secondary-token">
            {t('skillGap.panel.critical', 'Competencia crítica (bloquea la operación)')}
          </span>
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="skill-gap-submit"
          className="col-span-2 rounded-xl bg-violet-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-2 disabled:opacity-50"
        >
          {loading
            ? t('common.loading', 'Cargando…')
            : t('skillGap.panel.submit', 'Analizar brechas')}
        </button>
      </form>

      {error && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid="skill-gap-error"
          role="alert"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('skillGap.panel.error', 'No se pudo analizar la brecha.')} ({humanErrorMessage(error)})</span>
        </div>
      )}

      {gaps && (
        <div
          className="bg-surface-elevated rounded p-3 space-y-2"
          data-testid="skill-gap-result"
        >
          {gaps.length === 0 ? (
            <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">
              {t('skillGap.panel.noGaps', 'Sin brechas: el trabajador cumple el nivel requerido.')}
            </p>
          ) : (
            <ul className="space-y-2">
              {gaps.map((gap) => (
                <li key={`${gap.workerUid}-${gap.skillId}`} className="text-xs text-secondary-token">
                  <p className="text-sm font-black text-rose-600 dark:text-rose-400">
                    {gap.skillId}: {LEVEL_LABELS[gap.currentLevel]} → {LEVEL_LABELS[gap.requiredLevel]}
                  </p>
                  <p>
                    {gap.gapLevels} {t('skillGap.panel.gapLevels', 'nivel(es) de brecha')}
                    {gap.critical && (
                      <span className="ml-2 font-bold uppercase text-rose-600 dark:text-rose-400">
                        {t('skillGap.panel.criticalBadge', 'Crítica')}
                      </span>
                    )}
                    {gap.expired && (
                      <span className="ml-2 font-bold uppercase text-amber-600 dark:text-amber-400">
                        {t('skillGap.panel.expired', 'Certificación vencida')}
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

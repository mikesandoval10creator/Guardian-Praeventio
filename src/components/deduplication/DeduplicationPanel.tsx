// Praeventio Guard — Bloque D Rama 2: <DeduplicationPanel />
//
// Self-contained duplicate-detection form over the pure-compute endpoint
// POST /api/sprint-k/:projectId/deduplication/detect
// (src/server/routes/deduplication.ts), consumed via the previously-orphaned
// client hook src/hooks/useDeduplication.ts.
//
// Minimal v1 form: two records of the same kind (name + optional email) →
// duplicate candidates with confidence + recommended action. The
// build-merge-plan endpoint stays hook-only until its UI slice lands.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, AlertTriangle } from 'lucide-react';
import { detectRecordDuplicates } from '../../hooks/useDeduplication';
import type {
  DuplicateCandidate,
  MatchReason,
  RecordKind,
} from '../../services/deduplication/recordDeduplicator';

interface DeduplicationPanelProps {
  projectId: string;
}

// Closed vocabulary — mirrors RecordKind in the deduplication engine.
const KIND_OPTIONS: Array<{ value: RecordKind; label: string }> = [
  { value: 'worker', label: 'Trabajador' },
  { value: 'equipment', label: 'Equipo' },
  { value: 'project', label: 'Proyecto' },
  { value: 'contractor', label: 'Contratista' },
];

const REASON_LABELS: Record<MatchReason, string> = {
  canonical_key_exact: 'Clave canónica exacta',
  email_exact: 'Email exacto',
  phone_exact: 'Teléfono exacto',
  name_fuzzy: 'Nombre similar',
  name_initials: 'Iniciales del nombre',
  name_exact_case_insensitive: 'Nombre exacto (ignora mayúsculas)',
};

const ACTION_LABELS: Record<DuplicateCandidate['recommendedAction'], string> = {
  auto_merge: 'Fusionar automáticamente',
  suggest_merge: 'Sugerir fusión',
  review_only: 'Solo revisión manual',
};

const ACTION_TONES: Record<DuplicateCandidate['recommendedAction'], string> = {
  auto_merge: 'text-emerald-600 dark:text-emerald-400',
  suggest_merge: 'text-amber-600 dark:text-amber-400',
  review_only: 'text-sky-600 dark:text-sky-400',
};

export function DeduplicationPanel({ projectId }: DeduplicationPanelProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<RecordKind>('worker');
  const [nameA, setNameA] = useState('');
  const [emailA, setEmailA] = useState('');
  const [nameB, setNameB] = useState('');
  const [emailB, setEmailB] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);

  const canSubmit = nameA.trim().length > 0 && nameB.trim().length > 0 && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const now = Date.now();
      const res = await detectRecordDuplicates(projectId, {
        records: [
          {
            id: 'record-a',
            kind,
            name: nameA.trim(),
            email: emailA.trim() ? emailA.trim().toLowerCase() : undefined,
            // Older record → deterministic primary/anchor.
            createdAt: new Date(now - 86_400_000).toISOString(),
          },
          {
            id: 'record-b',
            kind,
            name: nameB.trim(),
            email: emailB.trim() ? emailB.trim().toLowerCase() : undefined,
            createdAt: new Date(now).toISOString(),
          },
        ],
      });
      setCandidates(res.candidates);
    } catch (err) {
      setCandidates(null);
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="deduplication-panel"
      aria-label={t('deduplication.panel.aria', 'Detección de registros duplicados') as string}
    >
      <header className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-teal-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('deduplication.panel.title', 'Detectar duplicados')}
        </h2>
      </header>

      <p className="text-[11px] text-secondary-token">
        {t(
          'deduplication.panel.description',
          'Compara dos registros del mismo tipo — el motor calcula la confianza de que sean el mismo.',
        )}
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('deduplication.panel.kind', 'Tipo de registro')}
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RecordKind)}
            data-testid="deduplication-kind"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('deduplication.panel.nameA', 'Registro A — nombre')}
          </span>
          <input
            type="text"
            value={nameA}
            onChange={(e) => setNameA(e.target.value)}
            data-testid="deduplication-name-a"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('deduplication.panel.nameA', 'Registro A — nombre') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('deduplication.panel.emailA', 'Registro A — email (opcional)')}
          </span>
          <input
            type="email"
            value={emailA}
            onChange={(e) => setEmailA(e.target.value)}
            data-testid="deduplication-email-a"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('deduplication.panel.emailA', 'Registro A — email (opcional)') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('deduplication.panel.nameB', 'Registro B — nombre')}
          </span>
          <input
            type="text"
            value={nameB}
            onChange={(e) => setNameB(e.target.value)}
            data-testid="deduplication-name-b"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('deduplication.panel.nameB', 'Registro B — nombre') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('deduplication.panel.emailB', 'Registro B — email (opcional)')}
          </span>
          <input
            type="email"
            value={emailB}
            onChange={(e) => setEmailB(e.target.value)}
            data-testid="deduplication-email-b"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('deduplication.panel.emailB', 'Registro B — email (opcional)') as string}
          />
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="deduplication-submit"
          className="col-span-2 rounded-xl bg-teal-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-2 disabled:opacity-50"
        >
          {loading
            ? t('common.loading', 'Cargando…')
            : t('deduplication.panel.submit', 'Detectar duplicados')}
        </button>
      </form>

      {error && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid="deduplication-error"
          role="alert"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('deduplication.panel.error', 'No se pudo ejecutar la detección.')} ({error})</span>
        </div>
      )}

      {candidates && (
        <div
          className="bg-surface-elevated rounded p-3 space-y-2"
          data-testid="deduplication-result"
        >
          {candidates.length === 0 ? (
            <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">
              {t('deduplication.panel.noDuplicates', 'Sin duplicados detectados entre los registros.')}
            </p>
          ) : (
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li key={c.primaryId} className="text-xs text-secondary-token space-y-1">
                  <p className={`text-sm font-black ${ACTION_TONES[c.recommendedAction]}`}>
                    {ACTION_LABELS[c.recommendedAction]}
                  </p>
                  <p>
                    {t('deduplication.panel.confidence', 'Confianza')}: {Math.round(c.confidence * 100)}%
                  </p>
                  <p>
                    {t('deduplication.panel.reasons', 'Coincidencias:')}{' '}
                    {c.reasons.map((r) => REASON_LABELS[r] ?? r).join(', ')}
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

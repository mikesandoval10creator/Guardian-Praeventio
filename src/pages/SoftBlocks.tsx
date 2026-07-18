// Praeventio Guard — Sprint 55 Fase F.17 page wrapper.
//
// Centro de Bloqueos Soft: lista los gates con requisitos no cumplidos
// (output de `softBlocking/requirementGate.evaluateGate`) y permite al
// supervisor ejecutar override con audit log obligatorio.
//
// Directiva 2 — NUNCA bloqueo duro automático:
//   - level='soft_block' = recomendación fuerte + override permitido
//     con razón ≥20 chars + UID autorizador documentado.
//   - level='cannot_override' = requiere intervención humana
//     (vida-en-riesgo); UI muestra alerta sin botón override.
//
// El audit log se entrega al caller (ack handler); la página sólo
// asiste al supervisor con visibilidad y formulario controlado.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ShieldAlert, WifiOff, CheckCircle2, PlugZap } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { RequirementGatePanel } from '../components/softBlocking/RequirementGatePanel';
import {
  evaluateGate,
  validateOverride,
  type GateDecision,
  type RequirementCheck,
  type GateLevel,
  type OverrideInput,
} from '../services/softBlocking/requirementGate';
import { humanErrorMessage } from '../lib/humanError';


export interface ActiveSoftBlock {
  /** Identifica el contexto del bloqueo (ej. una actividad / cuadrilla). */
  id: string;
  /** Título legible (ej. "Cuadrilla A — Altura"). */
  title: string;
  /** ISO-8601 cuando se evaluó por última vez. */
  evaluatedAt: string;
  /** Requirements + estado actual. */
  checks: RequirementCheck[];
}

interface SoftBlocksProps {
  /**
   * Lista de bloqueos activos del proyecto.
   *
   * Tres estados distintos (honesto ≠ cascarón):
   *   - `undefined` → el feed NO está conectado todavía (la ruta monta la
   *     página sin proveer datos). Se muestra un empty-state honesto que
   *     declara que la fuente no está cableada — NUNCA un falso "todo OK".
   *   - `[]`        → el feed SÍ se consultó y no hay bloqueos activos
   *     (todos los requisitos cumplidos) → empty-state verde de éxito.
   *   - `[...]`     → bloqueos reales evaluados por `evaluateGate`.
   *
   * TODO(soft-blocking-feed): no existe aún una fuente real de "active
   * soft-blocks" del proyecto. El router `src/server/routes/softBlocking.ts`
   * es PURO cómputo (evalúa `checks[]` provistos por el caller); no hay
   * colección Firestore de gates activos ni endpoint que liste, por
   * cuadrilla/actividad, los requisitos (capacitación/EPP/aptitud
   * médica/permisos) con su estado actual. Para cablear esto de verdad hace
   * falta una capa de agregación servidor-side que ensamble
   * `RequirementCheck[]` desde los registros reales (training/EPP/medical/
   * permits) por contexto y exponga p.ej.
   * `GET /api/sprint-k/:projectId/soft-blocking/active-gates`. Hasta que
   * exista, NO fabricamos bloqueos: la página declara el gap.
   */
  blocks?: ActiveSoftBlock[];
  /** Handler que registra el override. */
  onOverride?: (blockId: string, override: OverrideInput) => void;
}

const LEVEL_COLORS: Record<GateLevel, string> = {
  pass: 'text-teal-500',
  soft_block: 'text-amber-500',
  cannot_override: 'text-rose-500',
};

const LEVEL_BG: Record<GateLevel, string> = {
  pass: 'bg-teal-500/10 border-teal-500/20',
  soft_block: 'bg-amber-500/10 border-amber-500/20',
  cannot_override: 'bg-rose-500/10 border-rose-500/20',
};

export function SoftBlocks({ blocks, onOverride }: SoftBlocksProps) {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const [activeOverrideId, setActiveOverrideId] = useState<string | null>(null);

  // `undefined` = feed NO cableado (ver TODO en SoftBlocksProps.blocks).
  // No lo tratamos como "[] sin bloqueos" porque eso sería un falso "todo OK".
  const feedConnected = blocks !== undefined;
  const safeBlocks = blocks ?? [];

  // Evaluamos cada bloqueo upfront para tener decisión + nivel.
  const evaluated = safeBlocks.map((b) => ({
    block: b,
    decision: evaluateGate(b.checks),
  }));

  // Solo mostramos los que NO pasan; los 'pass' filtran.
  const visible = evaluated.filter((e) => e.decision.level !== 'pass');
  const passed = evaluated.length - visible.length;

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="soft-blocks-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ShieldAlert
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('softBlocks.page.title', 'Centro de Bloqueos Soft')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'softBlocks.page.selectProject',
              'Selecciona un proyecto para ver los bloqueos activos.',
            )}
          </p>
        </div>
      </div>
    );
  }

  // Feed NO cableado → empty-state honesto. NO mostramos el verde "todo OK"
  // (sería un falso all-clear: nunca se consultó una fuente real). Ver el
  // TODO(soft-blocking-feed) en SoftBlocksProps.blocks.
  if (!feedConnected) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="soft-blocks-page-feed-unavailable"
      >
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 text-center">
          <PlugZap
            className="w-12 h-12 mx-auto mb-4 text-amber-500"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('softBlocks.page.title', 'Centro de Bloqueos Soft')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'softBlocks.feedUnavailable',
              'El listado de bloqueos activos del proyecto aún no está conectado. Cuando la fuente de requisitos por cuadrilla/actividad esté disponible, los gates aparecerán aquí.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="soft-blocks-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
          <ShieldAlert className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('softBlocks.page.title', 'Centro de Bloqueos Soft')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'softBlocks.page.subtitle',
              '{{count}} bloqueo(s) activo(s) · {{passed}} cumple sin observaciones. Override requiere razón ≥20 chars + UID supervisor.',
              { count: visible.length, passed },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="soft-blocks-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {visible.length === 0 && (
        <div
          className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-6 text-center"
          data-testid="soft-blocks-empty-state"
        >
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-teal-500" aria-hidden="true" />
          <p className="text-sm font-bold text-teal-700 dark:text-teal-400">
            {t('softBlocks.empty', 'Sin bloqueos activos — todos los requisitos cumplidos.')}
          </p>
        </div>
      )}

      {visible.map(({ block, decision }) => (
        <article
          key={block.id}
          className={`rounded-2xl border p-4 space-y-3 ${LEVEL_BG[decision.level]}`}
          data-testid={`soft-block-card-${block.id}`}
        >
          <header className="flex items-start gap-3">
            <AlertTriangle
              className={`w-5 h-5 mt-0.5 ${LEVEL_COLORS[decision.level]}`}
              aria-hidden="true"
            />
            <div className="flex-1">
              <h2 className="font-bold text-primary-token">
                {block.title}
              </h2>
              <p className="text-xs text-secondary-token mt-0.5">
                {t(`softBlocks.level.${decision.level}`, decision.level)}
              </p>
            </div>
          </header>

          <RequirementGatePanel
            decision={decision}
            onRequestOverride={decision.canOverride ? () => setActiveOverrideId(block.id) : undefined}
          />

          <ul
            className="space-y-2 text-sm"
            data-testid={`soft-block-unsatisfied-${block.id}`}
          >
            {decision.unsatisfied.map((u) => (
              <li
                key={u.requirement.id}
                className="flex items-start gap-2 text-primary-token"
              >
                <span
                  className={`mt-1 inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                    u.requirement.isMandatory ? 'bg-rose-500' : 'bg-amber-500'
                  }`}
                  aria-hidden="true"
                />
                <span>
                  <strong>{u.requirement.label}</strong> · {u.status}
                  {u.requirement.citation && (
                    <span className="text-secondary-token text-xs ml-1">
                      ({u.requirement.citation})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {decision.canOverride && (
            <>
              <button
                type="button"
                onClick={() => setActiveOverrideId(block.id)}
                disabled={activeOverrideId === block.id}
                className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 hover:text-amber-900 underline disabled:opacity-50"
                data-testid={`soft-block-override-btn-${block.id}`}
              >
                {t('softBlocks.actions.override', 'Aplicar override (ack)')}
              </button>
              {activeOverrideId === block.id && (
                <OverrideForm
                  decision={decision}
                  onCancel={() => setActiveOverrideId(null)}
                  onConfirm={(input) => {
                    onOverride?.(block.id, input);
                    setActiveOverrideId(null);
                  }}
                />
              )}
            </>
          )}

          {!decision.canOverride && (
            <p
              className="text-xs font-bold text-rose-700 dark:text-rose-400 mt-2"
              data-testid={`soft-block-cannot-override-${block.id}`}
            >
              {t(
                'softBlocks.cannotOverride',
                'Bloqueo crítico no superable sin intervención supervisor.',
              )}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Override form
// ────────────────────────────────────────────────────────────────────────

interface OverrideFormProps {
  decision: GateDecision;
  onCancel: () => void;
  onConfirm: (override: OverrideInput) => void;
}

function OverrideForm({ decision, onCancel, onConfirm }: OverrideFormProps) {
  const { t } = useTranslation();
  const [authorizingUid, setAuthorizingUid] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const override: OverrideInput = {
      authorizingUid: authorizingUid.trim(),
      reason: reason.trim(),
      approvedAt: new Date().toISOString(),
    };
    const v = validateOverride({ decision, override });
    if (!v.valid) {
      setError(v.error ?? 'invalid');
      return;
    }
    setError(null);
    onConfirm(override);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 rounded-xl border border-default-token bg-surface p-3 space-y-2"
      data-testid="soft-block-override-form"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-uid" className="text-xs font-bold uppercase text-secondary-token">
          {t('softBlocks.form.authorizingUid', 'UID supervisor autorizador')}
        </label>
        <input
          id="auth-uid"
          type="text"
          value={authorizingUid}
          onChange={(e) => setAuthorizingUid(e.target.value)}
          required
          className="rounded-lg border border-default-token bg-surface px-3 py-1.5 text-sm text-primary-token"
          data-testid="soft-block-form-uid"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="reason" className="text-xs font-bold uppercase text-secondary-token">
          {t('softBlocks.form.reason', 'Razón (mín 20 chars)')}
        </label>
        <textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={3}
          className="rounded-lg border border-default-token bg-surface px-3 py-1.5 text-sm text-primary-token"
          data-testid="soft-block-form-reason"
        />
      </div>
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400" data-testid="soft-block-form-error">
          {humanErrorMessage(error)}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-bold uppercase px-3 py-1.5 text-secondary-token hover:text-primary-token"
          data-testid="soft-block-form-cancel"
        >
          {t('common.cancel', 'Cancelar')}
        </button>
        <button
          type="submit"
          className="text-xs font-bold uppercase px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
          data-testid="soft-block-form-submit"
        >
          {t('softBlocks.form.confirm', 'Confirmar override')}
        </button>
      </div>
    </form>
  );
}

export default SoftBlocks;

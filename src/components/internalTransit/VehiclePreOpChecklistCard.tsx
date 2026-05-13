// Praeventio Guard — Wire UI: <VehiclePreOpChecklistCard />
//
// Sprint L.10 §365: checklist pre-operación vehicular para camión grande,
// camioneta, cargador frontal, grúa móvil, minibus, bus.
// Front-line operator workflow: marcar pasa/no-pasa por item, ver
// bloqueantes detectados en vivo, registrar respuesta final.
//
// Componente controlado: el caller maneja el estado de `responses[]` y
// recibe el resultado vía `onSubmit(result, responses)`. El componente
// computa el resultado en vivo usando `validatePreOpChecklist()` del motor.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Truck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import {
  getPreOpChecklist,
  validatePreOpChecklist,
  type PreOpChecklistItem,
  type PreOpResponse,
  type PreOpResult,
  type VehicleKind,
} from '../../services/internalTransit/internalTransitService.js';

interface VehiclePreOpChecklistCardProps {
  /** Tipo de vehículo (selector arriba). */
  vehicleKind: VehicleKind;
  /** Estado controlado de respuestas (caller mantiene). */
  responses: PreOpResponse[];
  /** Update single item — caller persiste / queue offline si quiere. */
  onChangeResponse: (response: PreOpResponse) => void;
  /** Cuando el operador confirma el checklist completo. */
  onSubmit?: (result: PreOpResult, responses: PreOpResponse[]) => void;
  /**
   * Cuando `true` se ocultan los botones (modo solo-lectura para
   * supervisor que revisa un checklist ya firmado).
   */
  readOnly?: boolean;
}

const VEHICLE_LABEL: Record<VehicleKind, string> = {
  camion_grande: 'Camión grande (>7.5t)',
  camioneta: 'Camioneta',
  cargador_frontal: 'Cargador frontal',
  grua_movil: 'Grúa móvil',
  minibus_personal: 'Minibús personal',
  bus_personal: 'Bus personal',
};

export function VehiclePreOpChecklistCard({
  vehicleKind,
  responses,
  onChangeResponse,
  onSubmit,
  readOnly = false,
}: VehiclePreOpChecklistCardProps) {
  const { t } = useTranslation();
  const checklist = useMemo(() => getPreOpChecklist(vehicleKind), [vehicleKind]);
  const responseById = useMemo(
    () => new Map(responses.map((r) => [r.itemId, r])),
    [responses],
  );

  // Live validation for the live indicator. The motor computes
  // blockingFailures over the *current* response set — missing items
  // count as failures.
  const liveResult = useMemo(
    () => validatePreOpChecklist(vehicleKind, responses),
    [vehicleKind, responses],
  );

  const allItemsAnswered = checklist.every((c) => responseById.has(c.id));
  const canSubmit =
    !readOnly && allItemsAnswered && liveResult.passed && onSubmit;

  return (
    <section
      className="rounded-2xl border border-stone-500/30 bg-white/60 dark:bg-stone-900/40 p-4"
      data-testid="vehicle-preop-card"
      aria-label={t('preOp.aria', 'Checklist pre-operación vehicular') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <Truck className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
          {t('preOp.title', 'Pre-operación')} — {VEHICLE_LABEL[vehicleKind]}
        </h2>
        <LiveStatusBadge
          passed={liveResult.passed}
          allAnswered={allItemsAnswered}
          blockingFailures={liveResult.blockingFailures.length}
          warnings={liveResult.warnings.length}
        />
      </header>

      <ul className="space-y-2" data-testid="preop-items">
        {checklist.map((item) => {
          const resp = responseById.get(item.id);
          return (
            <ChecklistRow
              key={item.id}
              item={item}
              response={resp}
              readOnly={readOnly}
              onPass={() => onChangeResponse({ itemId: item.id, passed: true })}
              onFail={() => onChangeResponse({ itemId: item.id, passed: false })}
            />
          );
        })}
      </ul>

      {!readOnly && onSubmit && (
        <div className="mt-3 flex items-center justify-end gap-2">
          {!allItemsAnswered && (
            <span
              data-testid="preop-pending-count"
              className="text-[11px] italic text-amber-700 dark:text-amber-300"
            >
              {checklist.length - responses.length}{' '}
              {t('preOp.itemsPending', 'ítems pendientes')}
            </span>
          )}
          <button
            type="button"
            onClick={() => onSubmit(liveResult, responses)}
            disabled={!canSubmit}
            data-testid="preop-submit"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-bold hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            {t('preOp.submit', 'Firmar pre-op')}
          </button>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Internal: row per checklist item
// ────────────────────────────────────────────────────────────────────────

interface ChecklistRowProps {
  item: PreOpChecklistItem;
  response: PreOpResponse | undefined;
  readOnly: boolean;
  onPass: () => void;
  onFail: () => void;
}

function ChecklistRow({ item, response, readOnly, onPass, onFail }: ChecklistRowProps) {
  const { t } = useTranslation();
  const state =
    response === undefined ? 'pending' : response.passed ? 'pass' : 'fail';

  const stateClass = {
    pending:
      'border-stone-500/20 bg-stone-500/5 text-stone-700 dark:text-stone-300',
    pass: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    fail: 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  }[state];

  return (
    <li
      data-testid={`preop-item-${item.id}`}
      data-state={state}
      className={`rounded-md border p-2.5 ${stateClass}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight">{item.label}</p>
          {item.blocking && (
            <span
              data-testid={`preop-item-${item.id}-blocking`}
              className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wide font-bold opacity-80 mt-0.5"
            >
              <Lock className="w-2.5 h-2.5" aria-hidden="true" />
              {t('preOp.blocking', 'Bloqueante')}
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onPass}
              data-testid={`preop-item-${item.id}-pass`}
              aria-pressed={state === 'pass'}
              className={`p-1 rounded-md ${state === 'pass' ? 'bg-emerald-600 text-white' : 'bg-white/40 dark:bg-black/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'}`}
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only">{t('preOp.pass', 'Aprueba')}</span>
            </button>
            <button
              type="button"
              onClick={onFail}
              data-testid={`preop-item-${item.id}-fail`}
              aria-pressed={state === 'fail'}
              className={`p-1 rounded-md ${state === 'fail' ? 'bg-rose-600 text-white' : 'bg-white/40 dark:bg-black/20 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20'}`}
            >
              <XCircle className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only">{t('preOp.fail', 'No pasa')}</span>
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

interface LiveStatusBadgeProps {
  passed: boolean;
  allAnswered: boolean;
  blockingFailures: number;
  warnings: number;
}

function LiveStatusBadge({
  passed,
  allAnswered,
  blockingFailures,
  warnings,
}: LiveStatusBadgeProps) {
  const { t } = useTranslation();
  // Order matters: blocked > warning > pass > pending. The motor flags
  // `passed: true` even when non-blocking items failed, so we have to
  // check warnings BEFORE the green "pass" state — otherwise a vehicle
  // missing its first-aid kit (warning) shows as fully ready.
  if (blockingFailures > 0) {
    return (
      <span
        data-testid="preop-live-status"
        data-state="blocked"
        className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/40 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300"
      >
        <Lock className="w-3 h-3" aria-hidden="true" />
        {blockingFailures} {t('preOp.statusBlocked', 'bloqueantes')}
      </span>
    );
  }
  if (warnings > 0) {
    return (
      <span
        data-testid="preop-live-status"
        data-state="warning"
        className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300"
      >
        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
        {warnings} {t('preOp.statusWarnings', 'observaciones')}
      </span>
    );
  }
  if (passed && allAnswered) {
    return (
      <span
        data-testid="preop-live-status"
        data-state="pass"
        className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
        {t('preOp.statusPass', 'Apto')}
      </span>
    );
  }
  return (
    <span
      data-testid="preop-live-status"
      data-state="pending"
      className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-500/15 border border-stone-500/30 text-[10px] font-bold uppercase tracking-wide text-stone-700 dark:text-stone-300"
    >
      {t('preOp.statusPending', 'Pendiente')}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Uncontrolled wrapper helper for callers that don't want to manage state
// ────────────────────────────────────────────────────────────────────────

interface UncontrolledProps {
  vehicleKind: VehicleKind;
  onSubmit?: (result: PreOpResult, responses: PreOpResponse[]) => void;
  initialResponses?: PreOpResponse[];
}

/**
 * Variante "no controlada" para callers que no necesitan manejar el
 * estado de responses (ej. mobile pre-shift form). Mantiene el estado
 * internamente con `useState`. La variante controlada arriba sigue
 * disponible para integraciones con Firestore + sync offline.
 */
export function UncontrolledVehiclePreOpChecklist({
  vehicleKind,
  onSubmit,
  initialResponses = [],
}: UncontrolledProps) {
  const [responses, setResponses] = useState<PreOpResponse[]>(initialResponses);
  return (
    <VehiclePreOpChecklistCard
      vehicleKind={vehicleKind}
      responses={responses}
      onChangeResponse={(r) => {
        setResponses((prev) => {
          const idx = prev.findIndex((x) => x.itemId === r.itemId);
          if (idx >= 0) {
            const copy = prev.slice();
            copy[idx] = r;
            return copy;
          }
          return [...prev, r];
        });
      }}
      onSubmit={onSubmit}
    />
  );
}

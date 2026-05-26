// Praeventio Guard — <StoppageBanner />
//
// Sticky-top banner that surfaces an active stoppage recommendation.
//
// DIRECTIVA FOUNDER (no negociable):
//   • Praeventio NUNCA bloquea físicamente maquinaria.
//   • El copy es explícito: el sistema RECOMIENDA detener faena.
//   • La decisión de paro queda en el supervisor responsable.
//   • El botón "Acknowledge" registra que el supervisor recibió la
//     recomendación. El paro físico (cortar energía, etc.) es manual.
//
// Severidad mapping:
//   • active                 → rojo (rose) — recomendación urgente
//   • pending_resumption     → ámbar (amber) — preconditions cumplidas,
//                              esperando firma de reanudación
//
// Acepta dark mode (clases dark:* en el árbol). El padre wirea el
// fetch via useStoppage; este componente es presentacional + un
// callback hacia el padre para acknowledge / resume.

import { useState } from 'react';
import { AlertOctagon, Pause, Play, ShieldAlert } from 'lucide-react';
import type { Stoppage } from '../../services/stoppage/stoppageEngine';

export interface StoppageBannerProps {
  /**
   * Active or pending_resumption stoppage to surface. If undefined,
   * the banner renders nothing (graceful empty state).
   */
  stoppage?: Stoppage;
  /** Triggered when supervisor clicks "Acknowledge". */
  onAcknowledge?: (stoppage: Stoppage) => void;
  /** Triggered when supervisor clicks "Reanudar" → opens the resume modal. */
  onRequestResume?: (stoppage: Stoppage) => void;
  /** Disables both action buttons (e.g. while a request is in flight). */
  disabled?: boolean;
}

const CATEGORY_LABELS: Record<Stoppage['category'], string> = {
  incidente_grave: 'Incidente grave',
  hallazgo_critico: 'Hallazgo crítico',
  condicion_climatica: 'Condición climática extrema',
  falla_equipo_critico: 'Falla de equipo crítico',
  observacion_fiscalizador: 'Observación de fiscalizador',
  falta_supervision: 'Falta de supervisión',
  detencion_voluntaria: 'Detención voluntaria (stop-work)',
};

export function StoppageBanner({
  stoppage,
  onAcknowledge,
  onRequestResume,
  disabled = false,
}: StoppageBannerProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  if (!stoppage) return null;

  const isPending = stoppage.status === 'pending_resumption';
  const tone = isPending
    ? // ámbar — listo para reanudar
      'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100'
    : // rojo — recomendación activa
      'bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-100';

  const iconTone = isPending
    ? 'text-amber-600 dark:text-amber-300'
    : 'text-rose-600 dark:text-rose-300';

  const allFulfilled = stoppage.resumptionPreconditions.every((p) => p.fulfilled);
  const fulfilledCount = stoppage.resumptionPreconditions.filter((p) => p.fulfilled).length;
  const totalCount = stoppage.resumptionPreconditions.length;

  function handleAcknowledge() {
    if (disabled || !onAcknowledge) return;
    setAcknowledged(true);
    onAcknowledge(stoppage!);
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="stoppage.banner"
      className={`sticky top-0 z-50 w-full border-b-2 px-4 py-3 shadow-lg ${tone}`}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-shrink-0">
          {isPending ? (
            <ShieldAlert className={`h-7 w-7 ${iconTone}`} aria-hidden="true" />
          ) : (
            <AlertOctagon className={`h-7 w-7 ${iconTone}`} aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <h2
            className="text-sm font-black uppercase tracking-wide"
            data-testid="stoppage.banner.headline"
          >
            {isPending
              ? 'Paralización lista para reanudar'
              : 'Praeventio Guard RECOMIENDA detener faena'}
          </h2>

          <p
            className="text-xs leading-relaxed"
            data-testid="stoppage.banner.copy"
          >
            {isPending ? (
              <>
                Todas las condiciones de reanudación se cumplieron. La firma del
                supervisor responsable es necesaria para registrar la pausa
                como cerrada. <strong>El sistema no reanuda la faena por sí
                solo</strong> — la decisión y la firma son humanas.
              </>
            ) : (
              <>
                La decisión de paro es del supervisor responsable. Si está de
                acuerdo, marque la pausa para registro.{' '}
                <strong>
                  El sistema no corta energía ni detiene equipos físicamente
                </strong>{' '}
                — la acción operacional es manual.
              </>
            )}
          </p>

          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 pt-1 text-[11px] sm:grid-cols-2">
            <div>
              <dt className="inline font-bold">Categoría: </dt>
              <dd
                className="inline"
                data-testid="stoppage.banner.category"
              >
                {CATEGORY_LABELS[stoppage.category] ?? stoppage.category}
              </dd>
            </div>
            <div>
              <dt className="inline font-bold">Alcance: </dt>
              <dd className="inline" data-testid="stoppage.banner.scope">
                {stoppage.scope} · {stoppage.scopeTargetId}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="inline font-bold">Motivo: </dt>
              <dd className="inline" data-testid="stoppage.banner.reason">
                {stoppage.reason}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="inline font-bold">Condiciones de reanudación: </dt>
              <dd
                className="inline"
                data-testid="stoppage.banner.preconditions"
              >
                {fulfilledCount} / {totalCount} cumplidas
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={disabled || acknowledged || isPending}
            data-testid="stoppage.banner.acknowledge"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-700 bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500 dark:bg-rose-500 dark:hover:bg-rose-400"
          >
            <Pause className="h-4 w-4" aria-hidden="true" />
            {acknowledged ? 'Recomendación recibida' : 'Acknowledge'}
          </button>

          <button
            type="button"
            onClick={() => !disabled && onRequestResume?.(stoppage)}
            disabled={disabled || !allFulfilled}
            data-testid="stoppage.banner.resume"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-teal-700 bg-teal-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-teal-500 dark:bg-teal-500 dark:hover:bg-teal-400"
            title={
              allFulfilled
                ? 'Firmar reanudación'
                : 'Aún hay condiciones por cumplir'
            }
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Reanudar
          </button>
        </div>
      </div>
    </div>
  );
}

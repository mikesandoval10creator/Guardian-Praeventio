// Praeventio Guard — Sprint 39 wire #3.4: <ZoneEntryGate />
//
// Modal/dialog que aparece cuando el usuario INDICA que va a entrar a una
// zona restringida. Lista los requisitos faltantes (EPP / training /
// permit) y muestra una recomendación amable.
//
// Founder directive — NUNCA BLOQUEAR ENTRADA FÍSICA, sólo recomendar:
//   • La acción primaria SIEMPRE está habilitada: "Comprendo el riesgo y
//     entro". Incluso cuando el motor `checkZoneEntry` devuelve
//     `allowed: false`, el botón sigue activo. La obligación del sistema
//     es advertir + dejar registro, no impedir.
//   • Cuando hay requisitos faltantes, la UI los enumera con un tono
//     ámbar/rosa y agrega un sub-botón secundario "Volver" para fricción
//     reflexiva — pero el botón principal nunca se deshabilita.
//   • El callback `onAcknowledge` recibe el resultado del motor para que
//     el caller pueda loguear el evento (`useRestrictedZones.logZoneEntryEvent`).
//
// Tailwind + paleta teal/red/amber + dark mode. Iconos `ShieldAlert`,
// `AlertTriangle`, `DoorOpen`.

import { useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DoorOpen, ShieldAlert, AlertTriangle, X } from 'lucide-react';
import {
  checkZoneEntry,
  type ZoneEntryCheckInput,
  type ZoneEntryResult,
} from '../../services/zones/restrictedZonesEngine';

export interface ZoneEntryGateProps {
  /**
   * When true, the modal is mounted and visible. Caller controls open
   * state to fit any UX trigger (button, NFC tap, geofence cross, etc.).
   */
  open: boolean;
  /** Engine input (worker profile + zone). */
  input: ZoneEntryCheckInput;
  /**
   * Called when the user confirms informed entry. ALWAYS callable —
   * receives the engine result so callers can persist a record showing
   * exactly which requirements were missing at acknowledgement time.
   */
  onAcknowledge: (evaluation: ZoneEntryResult) => void;
  /** Called when the user cancels / dismisses the dialog. */
  onCancel?: () => void;
}

export function ZoneEntryGate({
  open,
  input,
  onAcknowledge,
  onCancel,
}: ZoneEntryGateProps) {
  const { t } = useTranslation();
  const result = useMemo(() => checkZoneEntry(input), [input]);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Escape-to-cancel for keyboard users.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && onCancel) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  // Auto-focus the primary action on open for screen-reader users.
  useEffect(() => {
    if (open && dialogRef.current) {
      const btn = dialogRef.current.querySelector<HTMLButtonElement>(
        '[data-testid="zone-gate-ack"]',
      );
      btn?.focus();
    }
  }, [open]);

  if (!open) return null;

  const hasMissing = result.missing.length > 0;
  const hasWarnings = result.warnings.length > 0;

  // Tone is INFORMATIONAL, not blocking. We never render an "ENTRADA
  // BLOQUEADA" badge — the most negative state we surface is "Requisitos
  // pendientes" so the worker still owns the choice.
  const tone = !hasMissing
    ? {
        Icon: DoorOpen,
        color: 'text-teal-500 dark:text-teal-300',
        bg: 'bg-teal-500/10',
        border: 'border-teal-500/30',
        label: t('zoneGate.allClear', 'Cumple requisitos'),
        badgeClass:
          'bg-teal-500/15 text-teal-700 dark:text-teal-300',
      }
    : {
        Icon: ShieldAlert,
        color: 'text-amber-500 dark:text-amber-300',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/30',
        label: t('zoneGate.pending', 'Requisitos pendientes'),
        badgeClass:
          'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      };

  const { Icon } = tone;

  return (
    <div
      // Backdrop
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="presentation"
      data-testid="zone-gate-backdrop"
      onClick={(e) => {
        // Click outside dialog dismisses. Click on dialog itself does not.
        if (e.target === e.currentTarget && onCancel) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`zone-gate-title-${input.zone.id}`}
        aria-describedby={`zone-gate-body-${input.zone.id}`}
        className={`relative w-full max-w-md rounded-2xl border shadow-mode space-y-4 p-5 bg-white dark:bg-zinc-900 ${tone.border}`}
        data-testid={`zone-gate-${input.zone.id}`}
      >
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('zoneGate.close', 'Cerrar') as string}
            data-testid="zone-gate-close"
            className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}

        <header className={`flex items-center gap-2 rounded-lg p-3 ${tone.bg}`}>
          <Icon className={`w-5 h-5 ${tone.color}`} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h2
              id={`zone-gate-title-${input.zone.id}`}
              className="text-sm font-black text-zinc-900 dark:text-zinc-100 truncate"
            >
              {input.zone.name}
            </h2>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              {t('zoneGate.kind', 'Tipo')}: {input.zone.kind}
            </p>
          </div>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded ${tone.badgeClass}`}
            data-testid={`zone-gate-status-${input.zone.id}`}
          >
            {tone.label}
          </span>
        </header>

        <div id={`zone-gate-body-${input.zone.id}`} className="space-y-3">
          {hasMissing && (
            <section data-testid={`zone-gate-missing-${input.zone.id}`}>
              <h3 className="flex items-center gap-1 text-[10px] uppercase font-bold text-amber-700 dark:text-amber-300 mb-1.5">
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                {t('zoneGate.missing', 'Falta para entrar con seguridad')}
              </h3>
              <ul className="space-y-1">
                {result.missing.map((m, i) => (
                  <li
                    key={`${m}-${i}`}
                    className="text-[12px] text-amber-800 dark:text-amber-200 bg-amber-500/5 rounded p-2"
                    data-testid={`zone-gate-missing-item-${i}`}
                  >
                    {m}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasWarnings && (
            <section data-testid={`zone-gate-warnings-${input.zone.id}`}>
              <h3 className="text-[10px] uppercase font-bold text-zinc-600 dark:text-zinc-400 mb-1">
                {t('zoneGate.warnings', 'Avisos')}
              </h3>
              <ul className="space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li
                    key={`${w}-${i}`}
                    className="text-[11px] text-zinc-700 dark:text-zinc-300"
                    data-testid={`zone-gate-warning-${i}`}
                  >
                    {w}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">
            {hasMissing
              ? t(
                  'zoneGate.recommendation',
                  'Recomendamos completar los requisitos antes de entrar. Si decides entrar de todos modos, dejaremos registro de tu decisión para acompañamiento de tu supervisor.',
                )
              : t(
                  'zoneGate.cleared',
                  'Cumples los requisitos definidos para esta zona. Recuerda mantener tu EPP visible durante toda la permanencia.',
                )}
          </p>
        </div>

        <footer className="flex flex-col gap-2 sm:flex-row sm:gap-2 pt-1">
          {/*
            Primary action is ALWAYS enabled per founder directive. The
            button label & color shift but disabled is never set, even when
            requirements are missing.
          */}
          <button
            type="button"
            onClick={() => onAcknowledge(result)}
            data-testid="zone-gate-ack"
            className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
              hasMissing
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-teal-600 hover:bg-teal-700 text-white'
            }`}
          >
            <DoorOpen className="w-4 h-4" aria-hidden="true" />
            {hasMissing
              ? t(
                  'zoneGate.ackRisk',
                  'Comprendo el riesgo y entro',
                )
              : t('zoneGate.enter', 'Entrar a la zona')}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              data-testid="zone-gate-cancel"
              className="px-3 py-2 rounded-lg text-xs font-bold border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {t('zoneGate.back', 'Volver')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export default ZoneEntryGate;

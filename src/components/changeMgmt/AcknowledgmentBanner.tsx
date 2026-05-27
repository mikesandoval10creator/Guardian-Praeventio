// Praeventio Guard — Bloque 3.17: <AcknowledgmentBanner />
//
// Banner para trabajador afectado por un MOC pendiente de acknowledge.
// Muestra el resumen del cambio (qué cambió, antes→después, vigencia,
// impacto), el racional, y un botón "Lo entendí y acepto" que dispara
// la firma biométrica vía `useBiometricAuth` con `purpose:
// 'claim-signing'` (fail-closed, server-issued challenge mandatorio).
//
// Si la firma falla, NO se envía el acknowledge — comportamiento aligned
// con la directiva #1 (huella Google = firma universal) y con el
// stoppage resume modal.
//
// Anti-blame: workerUid lo fuerza el server desde el token; el banner
// no permite acknowledgar para otro worker.

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import type { OperationalChange } from '../../services/changeMgmt/operationalChangeService';
import { useBiometricAuth } from '../../hooks/useBiometricAuth';
import { acknowledgeMoc } from '../../hooks/useOperationalChange';

const IMPACT_LABEL: Record<OperationalChange['impact'], string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
};

const IMPACT_TONE: Record<OperationalChange['impact'], string> = {
  low: 'bg-teal-50 border-teal-300 text-teal-900 dark:bg-teal-900/30 dark:border-teal-700 dark:text-teal-100',
  medium:
    'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100',
  high: 'bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-100',
};

const KIND_LABEL: Record<OperationalChange['kind'], string> = {
  supervisor: 'Supervisor',
  procedure: 'Procedimiento',
  equipment: 'Equipo',
  shift: 'Turno',
  work_zone: 'Zona de trabajo',
  mandatory_epp: 'EPP obligatorio',
  applicable_norm: 'Norma aplicable',
  critical_control: 'Control crítico',
  other: 'Otro',
};

export interface AcknowledgmentBannerProps {
  projectId: string;
  change: OperationalChange;
  /** Notifica al padre con el cambio actualizado (incluyendo el nuevo ack). */
  onAcknowledged?: (change: OperationalChange) => void;
  /** Reporta errores para toast/log. */
  onError?: (message: string) => void;
}

export function AcknowledgmentBanner({
  projectId,
  change,
  onAcknowledged,
  onError,
}: AcknowledgmentBannerProps) {
  const { isSupported, authenticate } = useBiometricAuth();
  const [signing, setSigning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tone = IMPACT_TONE[change.impact];

  async function handleAck() {
    setError(null);

    if (!isSupported) {
      const msg =
        'Tu dispositivo no soporta firma biométrica. La confirmación de lectura requiere firma.';
      setError(msg);
      onError?.(msg);
      return;
    }

    setSigning(true);
    let signed = false;
    try {
      signed = await authenticate(
        `Confirmar lectura del cambio: ${change.whatChanged}`,
        'claim-signing',
      );
    } finally {
      setSigning(false);
    }

    if (!signed) {
      const msg = 'Firma biométrica rechazada o cancelada.';
      setError(msg);
      onError?.(msg);
      return;
    }

    setSubmitting(true);
    try {
      const { change: updated } = await acknowledgeMoc(projectId, change.id);
      setDone(true);
      onAcknowledged?.(updated);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error al registrar confirmación';
      setError(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section
        className="rounded-2xl border border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-900/30 text-teal-900 dark:text-teal-100 p-4 flex items-center gap-2"
        role="status"
        data-testid="moc.banner.confirmed"
      >
        <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
        <span className="text-sm font-bold">
          Confirmación registrada. Gracias.
        </span>
      </section>
    );
  }

  return (
    <section
      className={`rounded-2xl border p-4 space-y-3 ${tone}`}
      aria-label="Cambio operacional pendiente de confirmación"
      data-testid="moc.banner"
    >
      <header className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5" aria-hidden="true" />
        <h2
          className="text-sm font-bold flex-1"
          data-testid="moc.banner.title"
        >
          Cambio operacional pendiente de tu confirmación
        </h2>
        <span
          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/70 dark:bg-slate-900/40"
          data-testid="moc.banner.impact"
        >
          Impacto {IMPACT_LABEL[change.impact]}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="uppercase opacity-70">Tipo</dt>
          <dd className="font-bold" data-testid="moc.banner.kind">
            {KIND_LABEL[change.kind]}
          </dd>
        </div>
        <div>
          <dt className="uppercase opacity-70">Vigencia desde</dt>
          <dd data-testid="moc.banner.effectiveFrom">
            {new Date(change.effectiveFrom).toLocaleDateString()}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase opacity-70">¿Qué cambió?</dt>
          <dd className="font-bold" data-testid="moc.banner.whatChanged">
            {change.whatChanged}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase opacity-70">Antes → Después</dt>
          <dd data-testid="moc.banner.delta">
            <span className="line-through opacity-60">{change.previousValue}</span>
            {' → '}
            <span className="font-bold">{change.newValue}</span>
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase opacity-70">Justificación</dt>
          <dd className="italic" data-testid="moc.banner.rationale">
            {change.rationale}
          </dd>
        </div>
      </dl>

      <div className="rounded bg-white/70 dark:bg-slate-900/40 p-2 text-[11px] flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" aria-hidden="true" />
        <span>
          Al confirmar firmas con tu huella/biométrica que comprendiste el
          cambio. Tu firma queda registrada con timestamp.
        </span>
      </div>

      {error && (
        <p
          className="rounded border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 text-xs px-3 py-2"
          role="alert"
          data-testid="moc.banner.error"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleAck}
        disabled={signing || submitting || !isSupported}
        className="w-full rounded bg-teal-600 hover:bg-teal-700 disabled:bg-slate-400 dark:disabled:bg-slate-700 text-white text-sm font-bold py-2 inline-flex items-center justify-center gap-2"
        data-testid="moc.banner.ackButton"
      >
        {signing ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : submitting ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <Fingerprint className="w-4 h-4" aria-hidden="true" />
        )}
        {signing
          ? 'Esperando firma…'
          : submitting
          ? 'Registrando…'
          : 'Lo entendí y acepto'}
      </button>
    </section>
  );
}

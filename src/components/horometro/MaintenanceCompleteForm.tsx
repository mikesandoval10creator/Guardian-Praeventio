// Praeventio Guard — Bloque 4.1: <MaintenanceCompleteForm />
//
// Formulario de cierre de una tarea de mantenimiento preventivo.
// Captura notas tecnicas, lectura final del horometro (opcional pero
// recomendada), y lanza el ceremonial WebAuthn via useBiometricAuth
// con `purpose: 'claim-signing'`. Fail-closed: si la firma falla, NO
// cerramos. Esto cumple la directiva founder "firma biometrica = sello
// legal" + ADR Round 18 R6 (sensitive flows).

import { randomId } from '../../utils/randomId';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wrench,
  ShieldCheck,
  Fingerprint,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useBiometricAuth } from '../../hooks/useBiometricAuth';
import {
  completeMaintenanceTaskRequest,
  type CompleteMaintenanceTaskResponse,
} from '../../hooks/useHorometro';
import type {
  MaintenanceTask,
} from '../../services/maintenance/maintenanceScheduler';
import { humanErrorMessage } from '../../lib/humanError';


const TEAL = '#4db6ac';
const MIN_NOTES_CHARS = 20;

export interface MaintenanceCompleteFormProps {
  projectId: string;
  task: MaintenanceTask;
  /** Llamado tras un cierre exitoso. */
  onCompleted?: (result: CompleteMaintenanceTaskResponse) => void;
  /** Cancelar y volver. */
  onCancel?: () => void;
  /** Override para tests. */
  generateIdempotencyKey?: () => string;
  /** Hash hex precomputado de la firma (tests). */
  precomputedSignatureHash?: string;
}

export function MaintenanceCompleteForm({
  projectId,
  task,
  onCompleted,
  onCancel,
  generateIdempotencyKey,
  precomputedSignatureHash,
}: MaintenanceCompleteFormProps) {
  const { t } = useTranslation();
  const { isSupported, authenticate } = useBiometricAuth();
  const [notes, setNotes] = useState('');
  const [hoursStr, setHoursStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompleteMaintenanceTaskResponse | null>(null);

  const hoursNum = Number.parseFloat(hoursStr.replace(',', '.'));
  const hoursValid =
    hoursStr.length === 0 ||
    (Number.isFinite(hoursNum) && hoursNum >= 0);
  const notesValid = notes.trim().length >= MIN_NOTES_CHARS;
  const canSubmit = hoursValid && notesValid && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Firma biometrica fail-closed (Round 18 R6: claim-signing).
      let signatureHash = precomputedSignatureHash;
      if (!signatureHash) {
        setSigning(true);
        const ok = await authenticate(
          t(
            'maintenance.signaturePrompt',
            'Firma para cerrar la tarea de mantencion',
          ) as string,
          'claim-signing',
        );
        setSigning(false);
        if (!ok) {
          setError(
            t(
              'maintenance.signatureFailed',
              'No se pudo verificar la firma biometrica. Reintentalo.',
            ) as string,
          );
          setBusy(false);
          return;
        }
        // El hook no devuelve el assertionHash hoy; usamos un fingerprint
        // local como audit trail provisional. El backend persiste el hash
        // pero la verificacion real es la atomic challenge consume del
        // /webauthn/verify endpoint que el hook ya ejecuto.
        signatureHash = `local-${task.id}-${Date.now().toString(16)}`;
      }
      // 2. POST al backend.
      const idemKey = generateIdempotencyKey
        ? generateIdempotencyKey()
        : `${task.id}-complete-${Date.now()}-${randomId()}`;
      const res = await completeMaintenanceTaskRequest(
        projectId,
        task.id,
        {
          notes: notes.trim(),
          biometricSignatureHash: signatureHash,
          horometroAtCompletion:
            hoursStr.length > 0 && Number.isFinite(hoursNum) ? hoursNum : undefined,
        },
        idemKey,
      );
      setResult(res);
      onCompleted?.(res);
    } catch (err) {
      setError(humanErrorMessage((err as Error).message ?? 'unknown_error'));
    } finally {
      setBusy(false);
      setSigning(false);
    }
  }

  if (result) {
    return (
      <section
        className="min-h-screen bg-zinc-950 text-white p-4 flex flex-col gap-4"
        data-testid={`maintenance-complete-result-${task.id}`}
      >
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-100 p-6 space-y-3">
          <header className="flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 shrink-0" aria-hidden="true" />
            <h2
              className="text-lg font-black uppercase tracking-tight"
              data-testid="maintenance-complete-success-title"
            >
              {t('maintenance.completedTitle', 'Mantencion cerrada')}
            </h2>
          </header>
          <p className="text-sm leading-relaxed">
            {t(
              'maintenance.completedBody',
              'La tarea quedo registrada con firma biometrica y la cadena ZK fue actualizada.',
            )}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-[11px] pt-3 border-t border-white/10">
            <div>
              <dt className="uppercase tracking-widest opacity-70">
                {t('maintenance.taskId', 'Tarea')}
              </dt>
              <dd className="font-mono break-all">{task.id}</dd>
            </div>
            <div>
              <dt className="uppercase tracking-widest opacity-70">
                {t('maintenance.completion.horometro', 'Horometro al cierre')}
              </dt>
              <dd className="font-bold">
                {result.task.completion?.horometroAtCompletion ?? '—'}
              </dd>
            </div>
          </dl>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            data-testid="maintenance-complete-close"
            className="mt-auto w-full py-3 rounded-2xl bg-zinc-800 text-white text-sm font-bold uppercase tracking-widest hover:bg-zinc-700"
          >
            {t('common.done', 'Listo')}
          </button>
        )}
      </section>
    );
  }

  return (
    <section
      className="min-h-screen bg-zinc-950 text-white pb-32"
      data-testid={`maintenance-complete-${task.id}`}
      aria-label={t('maintenance.aria', 'Cerrar tarea de mantencion') as string}
    >
      <header
        className="sticky top-0 z-10 p-4 border-b border-white/5 shrink-0"
        style={{
          background: `linear-gradient(180deg, ${TEAL}26 0%, rgb(9 9 11) 100%)`,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${TEAL}33`, color: TEAL }}
          >
            <Wrench className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-black text-white uppercase tracking-tight truncate">
              {t('maintenance.headerTitle', 'Cerrar mantencion')}
            </h1>
            <p
              className="text-[10px] font-bold uppercase tracking-widest truncate"
              style={{ color: TEAL }}
            >
              {task.equipmentType} · {task.thresholdHours}h x{task.multiplier}
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="p-2 rounded-xl transition-colors text-zinc-400 hover:text-white hover:bg-white/10 shrink-0"
              aria-label={t('common.cancel', 'Cancelar') as string}
              data-testid="maintenance-complete-cancel"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <div className="px-4 pt-4 space-y-4">
        <article className="p-4 rounded-2xl border border-white/10 bg-zinc-900 space-y-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-zinc-300">
              {t('maintenance.notesLabel', 'Notas tecnicas (mantencion realizada)')}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="maintenance-complete-notes"
              rows={5}
              maxLength={5_000}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-sm border border-white/10 focus:outline-none focus:border-teal-400"
              placeholder={
                t(
                  'maintenance.notesPlaceholder',
                  'Describe los repuestos, observaciones y mediciones realizadas…',
                ) as string
              }
            />
            <span className="text-[10px] text-zinc-500 mt-1 block">
              {t(
                'maintenance.notesMinHint',
                'Minimo {{n}} caracteres.',
                { n: MIN_NOTES_CHARS } as Record<string, number>,
              )}
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-zinc-300">
              {t(
                'maintenance.completionHoursLabel',
                'Horas del horometro al cierre (opcional)',
              )}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={hoursStr}
              onChange={(e) => setHoursStr(e.target.value)}
              data-testid="maintenance-complete-hours"
              maxLength={10}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-sm font-mono border border-white/10 focus:outline-none focus:border-teal-400"
              placeholder={String(task.triggeredAtHours)}
            />
          </label>
          {isSupported === false && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t(
                  'maintenance.biometricUnsupported',
                  'Este dispositivo no soporta firma biometrica. Pide al supervisor que cierre la tarea desde un equipo con soporte WebAuthn.',
                )}
              </span>
            </div>
          )}
        </article>

        {error && (
          <div
            className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-sm flex items-start gap-2"
            data-testid="maintenance-complete-error"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{humanErrorMessage(error)}</span>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-zinc-950/95 backdrop-blur border-t border-white/5">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          data-testid="maintenance-complete-submit"
          className={
            'w-full py-3 rounded-2xl font-black text-sm uppercase tracking-widest transition-colors flex items-center justify-center gap-2 ' +
            (!canSubmit
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-teal-500 text-zinc-950 hover:bg-teal-400')
          }
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {!busy && signing && <Fingerprint className="w-4 h-4" aria-hidden="true" />}
          {!busy && !signing && <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
          {signing
            ? t('maintenance.signing', 'Firmando…')
            : t('maintenance.submit', 'Firmar y cerrar')}
        </button>
      </div>
    </section>
  );
}

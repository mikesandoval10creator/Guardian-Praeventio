// Praeventio Guard — Bloque 4.1: <HorometroEntryForm />
//
// Mobile-first form que el trabajador usa tras escanear el QR del
// equipo (mismo entry point que PreUseChecklistMobile, pero esta vez
// para reportar las horas actuales del horometro). El submit dispara
// el flow ZK completo en backend: horometro-reading -> threshold ->
// task-created (si cruza umbral).
//
// Paleta teal #4db6ac primary + dark-mode first. Mirror del estilo de
// PreUseChecklistMobile.

import { randomId } from '../../utils/randomId';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Loader2, AlertTriangle, Wrench } from 'lucide-react';
import {
  recordHorometroReading,
  type RecordHorometroReadingResponse,
} from '../../hooks/useHorometro';
import type { Equipment } from '../../services/equipment/equipmentQrService';
import { humanErrorMessage } from '../../lib/humanError';


const TEAL = '#4db6ac';

export interface HorometroEntryFormProps {
  projectId: string;
  /** Equipo resuelto via el QR scanner (mismo que PreUse). */
  equipment: Equipment;
  /** Callback tras envio exitoso (sea cruce o no). */
  onSubmitted?: (result: RecordHorometroReadingResponse) => void;
  /** Cancelar y volver. */
  onCancel?: () => void;
  /** Override para tests. */
  generateIdempotencyKey?: () => string;
}

export function HorometroEntryForm({
  projectId,
  equipment,
  onSubmitted,
  onCancel,
  generateIdempotencyKey,
}: HorometroEntryFormProps) {
  const { t } = useTranslation();
  const [hoursStr, setHoursStr] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordHorometroReadingResponse | null>(null);

  const hoursNum = Number.parseFloat(hoursStr.replace(',', '.'));
  const hoursValid =
    hoursStr.length > 0 && Number.isFinite(hoursNum) && hoursNum >= 0;

  async function handleSubmit() {
    if (!hoursValid) return;
    setBusy(true);
    setError(null);
    try {
      const idemKey = generateIdempotencyKey
        ? generateIdempotencyKey()
        : `${equipment.id}-${hoursNum}-${Date.now()}-${randomId()}`;
      const res = await recordHorometroReading(
        projectId,
        {
          equipmentId: equipment.id,
          hours: hoursNum,
          source: 'qr_entry',
          notes: notes.trim().length > 0 ? notes.trim() : undefined,
        },
        idemKey,
      );
      setResult(res);
      onSubmitted?.(res);
    } catch (err) {
      setError(humanErrorMessage((err as Error).message ?? 'unknown_error'));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const flow = result.flow;
    const crossesDetected =
      flow.ok && 'crossesDetected' in flow ? flow.crossesDetected : 0;
    return (
      <section
        className="min-h-screen bg-zinc-950 text-white p-4 flex flex-col gap-4"
        data-testid={`horometro-result-${equipment.id}`}
      >
        <div
          className={
            'rounded-2xl border p-6 space-y-3 ' +
            (crossesDetected > 0
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-100'
              : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-100')
          }
        >
          <header className="flex items-center gap-3">
            {crossesDetected > 0 ? (
              <Wrench className="w-7 h-7 shrink-0" aria-hidden="true" />
            ) : (
              <Gauge className="w-7 h-7 shrink-0" aria-hidden="true" />
            )}
            <h2
              className="text-lg font-black uppercase tracking-tight"
              data-testid="horometro-result-title"
            >
              {crossesDetected > 0
                ? t('horometro.result.thresholdsCrossed', 'Umbrales cruzados')
                : t('horometro.result.ok', 'Lectura registrada')}
            </h2>
          </header>
          <p className="text-sm leading-relaxed">
            {t(
              'horometro.result.equipment',
              'Equipo {{code}} ({{type}})',
              { code: equipment.code, type: equipment.type } as Record<string, string>,
            )}
            {' · '}
            {result.reading.hours} h
          </p>
          {crossesDetected > 0 && (
            <p className="text-sm leading-relaxed" data-testid="horometro-crosses-count">
              {t(
                'horometro.result.tasksCreated',
                'Se crearon {{count}} tarea(s) de mantencion preventiva.',
                { count: crossesDetected } as Record<string, number>,
              )}
            </p>
          )}
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            data-testid="horometro-result-close"
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
      data-testid={`horometro-entry-${equipment.id}`}
      aria-label={t('horometro.aria', 'Reportar horometro') as string}
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
            <Gauge className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-black text-white uppercase tracking-tight truncate">
              {t('horometro.title', 'Horometro')} · {equipment.code}
            </h1>
            <p
              className="text-[10px] font-bold uppercase tracking-widest truncate"
              style={{ color: TEAL }}
            >
              {equipment.type}
              {equipment.brand ? ` · ${equipment.brand}` : ''}
              {equipment.model ? ` ${equipment.model}` : ''}
            </p>
          </div>
        </div>
      </header>

      <div className="px-4 pt-4 space-y-4">
        <article className="p-4 rounded-2xl border border-white/10 bg-zinc-900 space-y-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-zinc-300">
              {t('horometro.hoursLabel', 'Horas acumuladas (lectura actual)')}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={hoursStr}
              onChange={(e) => setHoursStr(e.target.value)}
              data-testid="horometro-hours-input"
              maxLength={10}
              className="mt-1 w-full px-3 py-3 rounded-lg bg-zinc-800 text-white text-lg font-mono border border-white/10 focus:outline-none focus:border-teal-400"
              placeholder="1234"
            />
            <span className="text-[10px] text-zinc-500 mt-1 block">
              {t(
                'horometro.hoursHint',
                'Anota la cifra exacta que muestra el panel del equipo en este momento.',
              )}
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-zinc-300">
              {t('horometro.notesLabel', 'Notas (opcional)')}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="horometro-notes-input"
              rows={2}
              maxLength={2_000}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-sm border border-white/10 focus:outline-none focus:border-teal-400"
              placeholder={
                t(
                  'horometro.notesPlaceholder',
                  'Cualquier observacion relevante…',
                ) as string
              }
            />
          </label>
        </article>

        {error && (
          <div
            className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-sm flex items-start gap-2"
            data-testid="horometro-server-error"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{humanErrorMessage(error)}</span>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-zinc-950/95 backdrop-blur border-t border-white/5 flex gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            data-testid="horometro-cancel"
            className="px-4 py-3 rounded-2xl bg-zinc-800 text-white text-sm font-bold uppercase tracking-widest hover:bg-zinc-700"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hoursValid || busy}
          data-testid="horometro-submit"
          className={
            'flex-1 py-3 rounded-2xl font-black text-sm uppercase tracking-widest transition-colors flex items-center justify-center gap-2 ' +
            (!hoursValid || busy
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-teal-500 text-zinc-950 hover:bg-teal-400')
          }
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {!busy && <Gauge className="w-4 h-4" aria-hidden="true" />}
          {t('horometro.submit', 'Registrar horas')}
        </button>
      </div>
    </section>
  );
}

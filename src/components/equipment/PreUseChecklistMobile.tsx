// Praeventio Guard — Bloque 3 wire huérfanos (3.11) <PreUseChecklistMobile />.
//
// Mobile-first vertical checklist that a worker completes BEFORE operating
// the equipment they just scanned. Submits to the server via the
// `submitPreUseChecklist` hook. Each checklist item lets the worker:
//   • Mark passed / failed.
//   • Add a short note (textarea).
//   • Attach a photo URL (we accept a string; the URL comes from a separate
//     uploader integrated upstream — we keep this component focused on the
//     checklist itself).
//
// Founder directive — "Nunca bloquear maquinaria, solo recomendar":
//   When the server response says `recommendation.action === 'recommend_not_operate'`,
//   we render the copy "RECOMENDAMOS NO operar — reporta al supervisor".
//   We do NOT show any "blocked" / "rejected" wording. The worker can
//   physically choose to operate the machine; our role is to record what
//   they saw and surface a strong recommendation.
//
// Paleta: teal #4db6ac primary + dark-mode-first. Mirrors EvacuationQRScanner.

import { randomId } from '../../utils/randomId';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck,
  Check,
  X,
  AlertTriangle,
  ShieldCheck,
  Camera,
  Loader2,
} from 'lucide-react';
import {
  submitPreUseChecklist,
  type PreUseRecommendation,
  type SubmitPreUseResponse,
} from '../../hooks/useEquipmentQr';
import type {
  Equipment,
  PreUseChecklistItem,
  PreUseResponse,
} from '../../services/equipment/equipmentQrService';

const TEAL = '#4db6ac';

export interface PreUseChecklistMobileProps {
  projectId: string;
  equipment: Equipment;
  checklist: PreUseChecklistItem[];
  /** Llamado tras un submit exitoso (sea passed o failed). */
  onSubmitted?: (result: SubmitPreUseResponse) => void;
  /** Cancelar y volver al scanner / lista. */
  onCancel?: () => void;
  /** Override (tests). */
  generateIdempotencyKey?: () => string;
}

interface ItemState {
  result: 'unset' | 'passed' | 'failed';
  notes: string;
  photoUrl: string;
}

function defaultItemState(): ItemState {
  return { result: 'unset', notes: '', photoUrl: '' };
}

export function PreUseChecklistMobile({
  projectId,
  equipment,
  checklist,
  onSubmitted,
  onCancel,
  generateIdempotencyKey,
}: PreUseChecklistMobileProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Record<string, ItemState>>(() => {
    const seed: Record<string, ItemState> = {};
    for (const c of checklist) seed[c.id] = defaultItemState();
    return seed;
  });
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitPreUseResponse | null>(null);

  const allAnswered = useMemo(
    () => checklist.every((c) => items[c.id]?.result !== 'unset'),
    [checklist, items],
  );
  const anyFailed = useMemo(
    () => checklist.some((c) => items[c.id]?.result === 'failed'),
    [checklist, items],
  );

  function setResultFor(id: string, r: 'passed' | 'failed') {
    setItems((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? defaultItemState()), result: r },
    }));
  }

  function setNotesFor(id: string, notes: string) {
    setItems((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? defaultItemState()), notes },
    }));
  }

  function setPhotoFor(id: string, photoUrl: string) {
    setItems((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? defaultItemState()), photoUrl },
    }));
  }

  async function handleSubmit() {
    if (!allAnswered || confirmName.trim().length === 0) return;
    setBusy(true);
    setServerError(null);
    try {
      const responses: PreUseResponse[] = checklist.map((c) => {
        const s = items[c.id] ?? defaultItemState();
        const r: PreUseResponse = {
          itemId: c.id,
          result: s.result === 'passed' ? 'passed' : 'failed',
        };
        if (s.notes.trim().length > 0) r.notes = s.notes.trim();
        if (s.photoUrl.trim().length > 0) r.photoUrl = s.photoUrl.trim();
        return r;
      });
      const idemKey = generateIdempotencyKey
        ? generateIdempotencyKey()
        : `${equipment.id}-${Date.now()}-${randomId()}`;
      const res = await submitPreUseChecklist(
        projectId,
        equipment.id,
        { responses },
        idemKey,
      );
      setResult(res);
      onSubmitted?.(res);
    } catch (err) {
      setServerError((err as Error).message ?? 'unknown_error');
    } finally {
      setBusy(false);
    }
  }

  // Result view — shows the recommendation banner. Critical detail:
  // we never say "BLOQUEADO". The copy uses "RECOMENDAMOS".
  if (result) {
    return (
      <RecommendationView
        result={result}
        equipment={equipment}
        onClose={onCancel}
      />
    );
  }

  return (
    <section
      className="min-h-screen bg-zinc-950 text-white pb-32"
      data-testid={`preuse-checklist-${equipment.id}`}
      aria-label={t('preUse.aria', 'Checklist pre-uso') as string}
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
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-black text-white uppercase tracking-tight truncate">
              {t('preUse.title', 'Pre-uso')} · {equipment.code}
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
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="p-2 rounded-xl transition-colors text-zinc-400 hover:text-white hover:bg-white/10 shrink-0"
              aria-label={t('common.cancel', 'Cancelar') as string}
              data-testid="preuse-cancel"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <div className="px-4 pt-4 space-y-3">
        {checklist.length === 0 && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
            {t(
              'preUse.noChecklist',
              'Este equipo no tiene un checklist pre-uso registrado. Reporta al supervisor antes de operar.',
            )}
          </div>
        )}
        {checklist.map((item) => {
          const s = items[item.id] ?? defaultItemState();
          return (
            <article
              key={item.id}
              data-testid={`preuse-item-${item.id}`}
              className={
                'p-4 rounded-2xl border space-y-3 ' +
                (s.result === 'failed'
                  ? 'border-rose-500/40 bg-rose-500/5'
                  : s.result === 'passed'
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-white/10 bg-zinc-900')
              }
            >
              <header>
                <p className="text-sm font-bold text-white">{item.label}</p>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                  {item.expectedAnswer === 'ok'
                    ? t('preUse.expected.ok', 'Esperado: OK')
                    : t('preUse.expected.noAnomaly', 'Esperado: sin anomalía')}
                </p>
              </header>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setResultFor(item.id, 'passed')}
                  data-testid={`preuse-item-${item.id}-pass`}
                  aria-pressed={s.result === 'passed'}
                  className={
                    'flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm transition-colors ' +
                    (s.result === 'passed'
                      ? 'bg-emerald-500 text-zinc-950'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')
                  }
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  {t('preUse.passed', 'OK')}
                </button>
                <button
                  type="button"
                  onClick={() => setResultFor(item.id, 'failed')}
                  data-testid={`preuse-item-${item.id}-fail`}
                  aria-pressed={s.result === 'failed'}
                  className={
                    'flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm transition-colors ' +
                    (s.result === 'failed'
                      ? 'bg-rose-500 text-white'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')
                  }
                >
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  {t('preUse.failed', 'Anomalía')}
                </button>
              </div>
              {s.result === 'failed' && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-widest text-zinc-400">
                      {t('preUse.notes', 'Notas (opcional)')}
                    </span>
                    <textarea
                      value={s.notes}
                      onChange={(e) => setNotesFor(item.id, e.target.value)}
                      data-testid={`preuse-item-${item.id}-notes`}
                      rows={2}
                      maxLength={1_000}
                      className="mt-1 w-full px-2 py-1.5 rounded-lg bg-zinc-800 text-white text-sm border border-white/10 focus:outline-none focus:border-teal-400"
                      placeholder={
                        t(
                          'preUse.notesPlaceholder',
                          'Describe la anomalía...',
                        ) as string
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-widest text-zinc-400 flex items-center gap-1">
                      <Camera className="w-3 h-3" aria-hidden="true" />
                      {t('preUse.photo', 'Foto (URL opcional)')}
                    </span>
                    <input
                      type="text"
                      value={s.photoUrl}
                      onChange={(e) => setPhotoFor(item.id, e.target.value)}
                      data-testid={`preuse-item-${item.id}-photo`}
                      maxLength={2_000}
                      className="mt-1 w-full px-2 py-1.5 rounded-lg bg-zinc-800 text-white text-sm border border-white/10 focus:outline-none focus:border-teal-400"
                      placeholder="https://..."
                    />
                  </label>
                </div>
              )}
            </article>
          );
        })}

        <div
          className="p-4 rounded-2xl border space-y-2"
          style={{ borderColor: `${TEAL}33`, backgroundColor: `${TEAL}10` }}
        >
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-zinc-300">
              {t('preUse.signature', 'Firma — escribe tu nombre completo')}
            </span>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              data-testid="preuse-signature-name"
              maxLength={200}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-900 text-white text-sm border border-white/10 focus:outline-none"
              style={{ borderColor: `${TEAL}55` }}
              placeholder={
                t('preUse.signaturePlaceholder', 'Tu nombre completo') as string
              }
            />
          </label>
          {anyFailed && (
            <p
              className="text-[11px] text-amber-300 leading-relaxed"
              data-testid="preuse-anomaly-warning"
            >
              {t(
                'preUse.anomalyDetected',
                'Detectaste anomalías. Recomendamos NO operar el equipo y reportarlo al supervisor antes de continuar.',
              )}
            </p>
          )}
        </div>

        {serverError && (
          <div
            className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-sm"
            data-testid="preuse-server-error"
          >
            {serverError}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-zinc-950/95 backdrop-blur border-t border-white/5">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAnswered || confirmName.trim().length === 0 || busy}
          data-testid="preuse-submit"
          className={
            'w-full py-3 rounded-2xl font-black text-sm uppercase tracking-widest transition-colors flex items-center justify-center gap-2 ' +
            (!allAnswered || confirmName.trim().length === 0 || busy
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-teal-500 text-zinc-950 hover:bg-teal-400')
          }
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {!busy && <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
          {t('preUse.confirm', 'Confirmar pre-uso')}
        </button>
      </div>
    </section>
  );
}

// ── Recommendation result view ────────────────────────────────────────

function RecommendationView({
  result,
  equipment,
  onClose,
}: {
  result: SubmitPreUseResponse;
  equipment: Equipment;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const rec: PreUseRecommendation = result.recommendation;
  const tone = (() => {
    if (rec.action === 'proceed') {
      return {
        bg: 'bg-emerald-500/15 border-emerald-500/40',
        text: 'text-emerald-200',
        icon: ShieldCheck,
        title: t('preUse.result.proceed', 'Puedes operar') as string,
      };
    }
    if (rec.action === 'recommend_not_operate') {
      return {
        bg: 'bg-rose-500/15 border-rose-500/40',
        text: 'text-rose-100',
        icon: AlertTriangle,
        title: t('preUse.result.notOperate', 'RECOMENDAMOS NO OPERAR') as string,
      };
    }
    return {
      bg: 'bg-amber-500/15 border-amber-500/40',
      text: 'text-amber-100',
      icon: AlertTriangle,
      title: t(
        'preUse.result.reportSupervisor',
        'Recomendamos reportar al supervisor',
      ) as string,
    };
  })();
  const Icon = tone.icon;
  return (
    <section
      className="min-h-screen bg-zinc-950 text-white p-4 flex flex-col gap-4"
      data-testid={`preuse-recommendation-${result.validation.id}`}
    >
      <div
        className={`rounded-2xl border p-6 space-y-3 ${tone.bg} ${tone.text}`}
      >
        <header className="flex items-center gap-3">
          <Icon className="w-7 h-7 shrink-0" aria-hidden="true" />
          <h2
            className="text-lg font-black uppercase tracking-tight"
            data-testid="preuse-rec-title"
          >
            {tone.title}
          </h2>
        </header>
        <p
          className="text-sm leading-relaxed"
          data-testid="preuse-rec-message"
        >
          {rec.message}
        </p>
        <dl className="grid grid-cols-2 gap-2 text-[11px] pt-3 border-t border-white/10">
          <div>
            <dt className="uppercase tracking-widest opacity-70">
              {t('preUse.result.equipment', 'Equipo')}
            </dt>
            <dd className="font-bold">{equipment.code}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-widest opacity-70">
              {t('preUse.result.appliedStatus', 'Estado aplicado')}
            </dt>
            <dd
              className="font-bold uppercase"
              data-testid="preuse-rec-applied-status"
            >
              {result.appliedStatus}
            </dd>
          </div>
          <div className="col-span-2 break-all">
            <dt className="uppercase tracking-widest opacity-70">
              {t('preUse.result.auditHash', 'Hash auditoría')}
            </dt>
            <dd
              className="font-mono text-[10px] opacity-80"
              data-testid="preuse-rec-audit-hash"
            >
              {result.auditHash.slice(0, 32)}…
            </dd>
          </div>
        </dl>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          data-testid="preuse-rec-close"
          className="mt-auto w-full py-3 rounded-2xl bg-zinc-800 text-white text-sm font-bold uppercase tracking-widest hover:bg-zinc-700"
        >
          {t('common.done', 'Listo')}
        </button>
      )}
    </section>
  );
}

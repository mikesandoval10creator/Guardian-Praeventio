// Praeventio Guard — §201-210 page wrapper.
//
// Agenda con Bloques de Foco. Vista semanal simple sobre el modelo
// `services/focusBlocks/focusBlocks.ts`. El prevencionista bloquea tiempo
// protegido para inspección, capacitación, auditoría o tareas admin.
//
// Diseño deliberadamente austero — esto es el "core" del módulo. Futuras
// olas agregan: drag-resize, recurrencia, color por tipo y vista mensual.
//
// Esta página:
//   1. Calcula la semana actual (lunes-domingo, UTC) con `weekDates`.
//   2. Lee bloques upcoming del usuario con `listUpcoming(uid)`.
//   3. Filtra los de la semana visible y los renderiza por día.
//   4. Botón "Nuevo bloque" abre un modal con form mínimo
//      (start/end/kind/note) que valida con `validateInputs` y persiste
//      vía `createFocusBlock`.
//
// i18n: todas las strings van por `t('focusAgenda.X', 'fallback ES')`. El
// fallback en ES garantiza render legible aunque la key no esté en el
// bundle todavía — patrón establecido en el resto del repo (AnnualReview,
// ResidualRisk, etc.).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar as CalendarIcon,
  Plus,
  Loader2,
  Sparkles,
  Search,
  ShieldCheck,
  FileText,
  Wrench,
  X,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  createFocusBlock,
  listUpcoming,
  validateInputs,
  weekDates,
  type FocusBlock,
  type FocusBlockKind,
} from '../services/focusBlocks/focusBlocks';
import { logger } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────
// Kind metadata
// ────────────────────────────────────────────────────────────────────────

const KIND_META: Record<
  FocusBlockKind,
  { icon: typeof Search; bgClass: string; textClass: string }
> = {
  inspection: {
    icon: Search,
    bgClass: 'bg-teal-500/15 border-teal-500/40',
    textClass: 'text-teal-700 dark:text-teal-300',
  },
  training: {
    icon: Sparkles,
    bgClass: 'bg-indigo-500/15 border-indigo-500/40',
    textClass: 'text-indigo-700 dark:text-indigo-300',
  },
  audit: {
    icon: ShieldCheck,
    bgClass: 'bg-amber-500/15 border-amber-500/40',
    textClass: 'text-amber-700 dark:text-amber-300',
  },
  admin: {
    icon: FileText,
    bgClass: 'bg-zinc-500/15 border-zinc-500/40',
    textClass: 'text-secondary-token',
  },
};

function kindLabel(kind: FocusBlockKind, t: ReturnType<typeof useTranslation>['t']): string {
  switch (kind) {
    case 'inspection':
      return t('focusAgenda.kind.inspection', 'Inspección') as string;
    case 'training':
      return t('focusAgenda.kind.training', 'Capacitación') as string;
    case 'audit':
      return t('focusAgenda.kind.audit', 'Auditoría') as string;
    case 'admin':
      return t('focusAgenda.kind.admin', 'Administrativo') as string;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Date helpers (UTC-safe, no extra deps)
// ────────────────────────────────────────────────────────────────────────

function formatDayHeader(d: Date, t: ReturnType<typeof useTranslation>['t']): string {
  const weekday = d.toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const dayNum = d.getUTCDate();
  const month = d.toLocaleDateString(undefined, {
    month: 'short',
    timeZone: 'UTC',
  });
  void t; // reserved for future locale-aware overrides.
  return `${weekday} ${dayNum} ${month}`;
}

function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = (d: Date) =>
    `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

function isoYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toLocalInput(d: Date): string {
  // Format for <input type="datetime-local"> in UTC. We treat all values as
  // UTC here; users in other zones may rebuild with timezone awareness in a
  // later wave.
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromLocalInput(value: string): string {
  // Interpret `value` (yyyy-MM-ddTHH:mm) as UTC and return ISO.
  const d = new Date(`${value}:00Z`);
  return d.toISOString();
}

// ────────────────────────────────────────────────────────────────────────
// New block modal
// ────────────────────────────────────────────────────────────────────────

interface NewBlockDraft {
  startsAt: string; // local input value
  endsAt: string; // local input value
  kind: FocusBlockKind;
  note: string;
}

function defaultDraft(): NewBlockDraft {
  // Default: tomorrow 09:00–11:00 UTC.
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(9, 0, 0, 0);
  const end = new Date(tomorrow.getTime() + 2 * 3_600_000);
  return {
    startsAt: toLocalInput(tomorrow),
    endsAt: toLocalInput(end),
    kind: 'inspection',
    note: '',
  };
}

interface NewBlockModalProps {
  open: boolean;
  uid: string;
  onClose: () => void;
  onCreated: (block: FocusBlock) => void;
}

function NewBlockModal({ open, uid, onClose, onCreated }: NewBlockModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<NewBlockDraft>(() => defaultDraft());
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setDraft(defaultDraft());
      setErrors([]);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async () => {
    setErrors([]);
    const input = {
      uid,
      startsAt: fromLocalInput(draft.startsAt),
      endsAt: fromLocalInput(draft.endsAt),
      kind: draft.kind,
      note: draft.note.trim() === '' ? undefined : draft.note.trim(),
    };
    const v = validateInputs(input);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setSubmitting(true);
    try {
      const created = await createFocusBlock(input);
      onCreated(created);
      onClose();
    } catch (err) {
      logger.warn('FocusAgenda: createFocusBlock failed', { err: String(err) });
      setErrors([(err as Error).message ?? 'Error desconocido']);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="focus-agenda-new-block-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="focus-agenda-new-block-title"
            className="text-lg font-semibold text-primary-token"
          >
            {t('focusAgenda.newBlock.title', 'Nuevo bloque de foco')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('focusAgenda.newBlock.close', 'Cerrar') as string}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="focus-agenda-kind"
              className="mb-1 block text-sm font-medium text-secondary-token"
            >
              {t('focusAgenda.newBlock.kind', 'Tipo de bloque')}
            </label>
            <select
              id="focus-agenda-kind"
              value={draft.kind}
              onChange={(e) =>
                setDraft((d) => ({ ...d, kind: e.target.value as FocusBlockKind }))
              }
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="inspection">{kindLabel('inspection', t)}</option>
              <option value="training">{kindLabel('training', t)}</option>
              <option value="audit">{kindLabel('audit', t)}</option>
              <option value="admin">{kindLabel('admin', t)}</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="focus-agenda-starts"
                className="mb-1 block text-sm font-medium text-secondary-token"
              >
                {t('focusAgenda.newBlock.startsAt', 'Inicio (UTC)')}
              </label>
              <input
                id="focus-agenda-starts"
                type="datetime-local"
                value={draft.startsAt}
                onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
            <div>
              <label
                htmlFor="focus-agenda-ends"
                className="mb-1 block text-sm font-medium text-secondary-token"
              >
                {t('focusAgenda.newBlock.endsAt', 'Fin (UTC)')}
              </label>
              <input
                id="focus-agenda-ends"
                type="datetime-local"
                value={draft.endsAt}
                onChange={(e) => setDraft((d) => ({ ...d, endsAt: e.target.value }))}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="focus-agenda-note"
              className="mb-1 block text-sm font-medium text-secondary-token"
            >
              {t('focusAgenda.newBlock.note', 'Nota (opcional)')}
            </label>
            <input
              id="focus-agenda-note"
              type="text"
              maxLength={280}
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              placeholder={
                t('focusAgenda.newBlock.notePlaceholder', 'Ej: Inspección zona A, izaje crítico') as string
              }
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>

          {errors.length > 0 && (
            <ul
              role="alert"
              className="rounded-md border border-rose-400 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
            >
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            disabled={submitting}
          >
            {t('focusAgenda.newBlock.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('focusAgenda.newBlock.save', 'Crear bloque')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────

export function FocusAgenda() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const uid = user?.uid ?? '';

  const [blocks, setBlocks] = useState<FocusBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const week = useMemo(() => weekDates(new Date()), []);
  const weekStartYmd = isoYmd(week[0]);
  const weekEndYmd = isoYmd(week[6]);

  const reload = useCallback(async () => {
    if (!uid) {
      setBlocks([]);
      return;
    }
    setLoading(true);
    try {
      const upcoming = await listUpcoming(uid);
      setBlocks(upcoming);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Filtra a la semana visible (start..endOfWeek+1day).
  const blocksByDay = useMemo(() => {
    const out = new Map<string, FocusBlock[]>();
    for (const d of week) {
      out.set(isoYmd(d), []);
    }
    for (const b of blocks) {
      const day = b.startsAt.slice(0, 10);
      if (day >= weekStartYmd && day <= weekEndYmd) {
        const list = out.get(day);
        if (list) list.push(b);
      }
    }
    for (const list of out.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return out;
  }, [blocks, week, weekStartYmd, weekEndYmd]);

  const totalThisWeek = useMemo(() => {
    let n = 0;
    for (const list of blocksByDay.values()) n += list.length;
    return n;
  }, [blocksByDay]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-primary-token">
            <CalendarIcon className="h-6 w-6 text-teal-600" aria-hidden="true" />
            {t('focusAgenda.title', 'Agenda de bloques de foco')}
          </h1>
          <p className="mt-1 text-sm text-secondary-token">
            {t(
              'focusAgenda.subtitle',
              'Tiempo protegido para inspección, capacitación, auditoría o tareas críticas.',
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {t('focusAgenda.weekCount', '{{count}} esta semana', { count: totalThisWeek })}
          </span>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={!uid}
            className="flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {t('focusAgenda.newBlockButton', 'Nuevo bloque')}
          </button>
        </div>
      </header>

      {!uid && (
        <p
          role="status"
          className="rounded-md border border-amber-400 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {t('focusAgenda.signInPrompt', 'Inicia sesión para gestionar tus bloques de foco.')}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-secondary-token">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('focusAgenda.loading', 'Cargando agenda…')}
        </p>
      )}

      <section
        aria-label={t('focusAgenda.weekViewAria', 'Vista semanal') as string}
        className="grid grid-cols-1 gap-3 md:grid-cols-7"
      >
        {week.map((day) => {
          const ymd = isoYmd(day);
          const list = blocksByDay.get(ymd) ?? [];
          const isToday = ymd === isoYmd(new Date());
          return (
            <div
              key={ymd}
              className={`rounded-lg border p-3 ${
                isToday
                  ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/20'
                  : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
              }`}
            >
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-token">
                {formatDayHeader(day, t)}
              </div>
              {list.length === 0 ? (
                <p className="text-xs italic text-zinc-400 dark:text-zinc-600">
                  {t('focusAgenda.emptyDay', 'Día libre')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {list.map((b) => {
                    const meta = KIND_META[b.kind];
                    const Icon = meta.icon;
                    return (
                      <li
                        key={b.id}
                        className={`rounded-md border p-2 text-xs ${meta.bgClass} ${meta.textClass}`}
                      >
                        <div className="flex items-center gap-1.5 font-semibold">
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                          {kindLabel(b.kind, t)}
                        </div>
                        <div className="mt-0.5 text-[11px] opacity-80">
                          {formatTimeRange(b.startsAt, b.endsAt)}
                        </div>
                        {b.note && <div className="mt-1 line-clamp-2">{b.note}</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {totalThisWeek === 0 && !loading && uid && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <Wrench className="mx-auto mb-3 h-8 w-8 text-zinc-400" aria-hidden="true" />
          <p className="text-sm text-secondary-token">
            {t(
              'focusAgenda.emptyWeek',
              'No tienes bloques de foco esta semana. Crea uno con el botón "Nuevo bloque".',
            )}
          </p>
        </div>
      )}

      <NewBlockModal
        open={modalOpen}
        uid={uid}
        onClose={() => setModalOpen(false)}
        onCreated={() => void reload()}
      />
    </div>
  );
}

export default FocusAgenda;

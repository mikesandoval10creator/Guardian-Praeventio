// Praeventio Guard — <ShiftHandoverPanel />
//
// Bloque 3.18 — Adaptive panel para gestión del cambio de turno (ADR 0019).
//
// Modo 1 — Saliente:
//   • No hay `shift` prop (o el shift no está cerrado).
//   • Form para registrar estado: kind del turno, log entries (pendientes
//     con followUp), notas por categoría canónica (incidentes, EPP,
//     equipos, etc), severidad.
//   • Submit → POST /create + transición a "pending acknowledgement".
//
// Modo 2 — Entrante (acknowledge):
//   • Recibe un `shift` cerrado pero sin `acknowledgedByUid`.
//   • Muestra todo lo que el saliente registró (log + notas).
//   • Campo de notas del entrante + botón "Acusar recibo".
//   • Submit → POST /:hoId/acknowledge.
//
// Modo 3 — Entrante (discrepancia post-ack):
//   • El shift ya tiene `acknowledgedByUid` igual al currentUid.
//   • Permite agregar una discrepancia detectada después del acuse.
//   • Submit → POST /:hoId/add-discrepancy.
//
// Tailwind + teal + dark mode. data-testid en raíz y submit para tests.

import { useMemo, useState } from 'react';
import {
  ClipboardCheck,
  ClipboardList,
  AlertTriangle,
  Send,
  Plus,
  Trash2,
  FileWarning,
} from 'lucide-react';
import type {
  ShiftRecord,
  ShiftKind,
  HandoverCategory,
  ShiftHandoverNote,
  ShiftLogEntry,
} from '../../services/shiftHandover/shiftHandoverService';
import {
  createShiftHandover,
  acknowledgeShiftHandover,
  addShiftHandoverDiscrepancy,
} from '../../hooks/useShiftHandover';

const CATEGORY_LABEL: Record<HandoverCategory, string> = {
  open_incidents: 'Incidentes abiertos',
  equipment_down: 'Equipos detenidos',
  pending_controls: 'Controles pendientes',
  absent_workers: 'Trabajadores ausentes',
  restricted_zones: 'Zonas restringidas',
  active_permits: 'Permisos activos',
  admin_pending: 'Pendientes admin',
  weather_alert: 'Alerta climática',
  observation: 'Observación / EPP',
};

const KIND_LABEL: Record<ShiftKind, string> = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  night: 'Noche',
  extended: 'Extendido',
};

const SEVERITY_TONE: Record<ShiftHandoverNote['severity'], string> = {
  info: 'bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200 border-teal-300/60 dark:border-teal-700/60',
  attention:
    'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border-amber-300/60 dark:border-amber-700/60',
  urgent:
    'bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 border-rose-300/60 dark:border-rose-700/60',
};

export interface ShiftHandoverPanelProps {
  projectId: string;
  /** uid del usuario actual (caller). Determina el rol saliente vs entrante. */
  currentUid: string;
  /** rol del usuario actual (supervisor / prevencionista / gerente). */
  currentRole: string;
  /**
   * Handover existente. Si está ausente → modo saliente.
   * Si está presente sin `acknowledgedByUid` → modo entrante (ack).
   * Si está presente con `acknowledgedByUid === currentUid` → modo discrepancia.
   */
  shift?: ShiftRecord;
  /** Callback cuando se completa una mutación. */
  onShiftUpdated?: (next: ShiftRecord) => void;
  /** Callback para errores. */
  onError?: (message: string) => void;
}

type Mode = 'outgoing' | 'incoming-ack' | 'incoming-discrepancy';

function deriveMode(
  shift: ShiftRecord | undefined,
  currentUid: string,
): Mode {
  if (!shift) return 'outgoing';
  if (!shift.acknowledgedByUid) return 'incoming-ack';
  if (shift.acknowledgedByUid === currentUid) return 'incoming-discrepancy';
  // Si ya fue acusado por otro, fallback a discrepancy-readonly (no muta).
  return 'incoming-discrepancy';
}

interface DraftNote {
  category: HandoverCategory;
  text: string;
  severity: ShiftHandoverNote['severity'];
}

interface DraftEntry {
  text: string;
  requiresFollowUp: boolean;
}

export function ShiftHandoverPanel({
  projectId,
  currentUid,
  currentRole,
  shift,
  onShiftUpdated,
  onError,
}: ShiftHandoverPanelProps) {
  const mode = useMemo(() => deriveMode(shift, currentUid), [shift, currentUid]);

  // ── Modo Saliente: state local del formulario ──────────────────────
  const [kind, setKind] = useState<ShiftKind>('morning');
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [newEntry, setNewEntry] = useState<DraftEntry>({
    text: '',
    requiresFollowUp: true,
  });
  const [notes, setNotes] = useState<DraftNote[]>([]);
  const [newNote, setNewNote] = useState<DraftNote>({
    category: 'open_incidents',
    text: '',
    severity: 'info',
  });

  // ── Modo Entrante: notas de acuse / discrepancia ───────────────────
  const [ackNotes, setAckNotes] = useState('');
  const [discrepancyText, setDiscrepancyText] = useState('');

  const [submitting, setSubmitting] = useState(false);

  function addEntry() {
    if (newEntry.text.trim().length < 5) return;
    setEntries((prev) => [...prev, newEntry]);
    setNewEntry({ text: '', requiresFollowUp: true });
  }

  function removeEntry(idx: number) {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  }

  function addNote() {
    if (newNote.text.trim().length < 5) return;
    setNotes((prev) => [...prev, newNote]);
    setNewNote({ category: newNote.category, text: '', severity: 'info' });
  }

  function removeNote(idx: number) {
    setNotes((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmitOutgoing() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const startedAt = new Date(Date.now() - 8 * 3600 * 1000).toISOString();
      const id = `ho-${currentUid}-${Date.now()}`;
      const logEntries: Array<Omit<ShiftLogEntry, 'at'> & { at?: string }> =
        entries.map((e) => ({
          authorUid: currentUid,
          authorRole: currentRole,
          text: e.text,
          requiresFollowUp: e.requiresFollowUp,
        }));
      const handoverNotes: ShiftHandoverNote[] = notes.map((n) => ({
        category: n.category,
        text: n.text,
        severity: n.severity,
      }));
      const idk = `ho-create-${id}`;
      const res = await createShiftHandover(
        projectId,
        {
          id,
          kind,
          startedAt,
          supervisorUid: currentUid,
          logEntries,
          handoverNotes,
        },
        idk,
      );
      onShiftUpdated?.(res.shift);
      setEntries([]);
      setNotes([]);
    } catch (err) {
      onError?.((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAcknowledge() {
    if (submitting || !shift) return;
    setSubmitting(true);
    try {
      const idk = `ho-ack-${shift.id}-${Date.now()}`;
      const res = await acknowledgeShiftHandover(
        projectId,
        shift.id,
        { notes: ackNotes.trim() || undefined },
        idk,
      );
      onShiftUpdated?.(res.shift);
      setAckNotes('');
    } catch (err) {
      onError?.((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddDiscrepancy() {
    if (submitting || !shift) return;
    if (discrepancyText.trim().length < 10) return;
    setSubmitting(true);
    try {
      const idk = `ho-disc-${shift.id}-${Date.now()}`;
      const res = await addShiftHandoverDiscrepancy(
        projectId,
        shift.id,
        { text: discrepancyText.trim() },
        idk,
      );
      onShiftUpdated?.(res.shift);
      setDiscrepancyText('');
    } catch (err) {
      onError?.((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-5 shadow-sm"
      data-testid="shift-handover-panel"
      data-mode={mode}
      aria-label="Cambio de turno"
    >
      <header className="flex items-center gap-2">
        {mode === 'outgoing' ? (
          <ClipboardList className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        ) : mode === 'incoming-ack' ? (
          <ClipboardCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        ) : (
          <FileWarning className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        )}
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
          {mode === 'outgoing' && 'Cierre de turno (saliente)'}
          {mode === 'incoming-ack' && 'Recepción de turno (entrante)'}
          {mode === 'incoming-discrepancy' && 'Registrar discrepancia'}
        </h2>
      </header>

      {/* ── MODE: OUTGOING ── */}
      {mode === 'outgoing' && (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="ho-kind"
              className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1"
            >
              Tipo de turno
            </label>
            <select
              id="ho-kind"
              data-testid="shift-handover-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ShiftKind)}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            >
              {(Object.keys(KIND_LABEL) as ShiftKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          {/* Log entries */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Pendientes / Eventos del turno
            </legend>
            <ul className="space-y-1" data-testid="shift-handover-entries">
              {entries.map((e, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded px-2 py-1"
                >
                  <span className="flex-1 text-zinc-800 dark:text-zinc-200">
                    {e.requiresFollowUp ? 'Pendiente: ' : 'Evento: '}
                    {e.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeEntry(i)}
                    aria-label="Eliminar entrada"
                    className="text-rose-500 hover:text-rose-700"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Describe el evento o pendiente (>= 5 chars)"
                value={newEntry.text}
                onChange={(e) =>
                  setNewEntry((prev) => ({ ...prev, text: e.target.value }))
                }
                data-testid="shift-handover-entry-input"
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
              <label className="flex items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={newEntry.requiresFollowUp}
                  onChange={(e) =>
                    setNewEntry((prev) => ({
                      ...prev,
                      requiresFollowUp: e.target.checked,
                    }))
                  }
                  className="accent-teal-600"
                />
                Pendiente
              </label>
              <button
                type="button"
                onClick={addEntry}
                data-testid="shift-handover-entry-add"
                className="rounded-lg bg-teal-500 hover:bg-teal-600 text-white px-3 py-2 text-xs font-bold flex items-center gap-1"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
                Añadir
              </button>
            </div>
          </fieldset>

          {/* Handover notes */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Notas de handover (EPP, incidentes, equipos)
            </legend>
            <ul className="space-y-1" data-testid="shift-handover-notes">
              {notes.map((n, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2 text-xs border rounded px-2 py-1 ${SEVERITY_TONE[n.severity]}`}
                >
                  <span className="font-bold uppercase text-[10px]">
                    {CATEGORY_LABEL[n.category]}
                  </span>
                  <span className="flex-1">{n.text}</span>
                  <button
                    type="button"
                    onClick={() => removeNote(i)}
                    aria-label="Eliminar nota"
                    className="text-rose-500 hover:text-rose-700"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-12 gap-2">
              <select
                value={newNote.category}
                onChange={(e) =>
                  setNewNote((prev) => ({
                    ...prev,
                    category: e.target.value as HandoverCategory,
                  }))
                }
                data-testid="shift-handover-note-category"
                className="col-span-4 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-2 py-2 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              >
                {(Object.keys(CATEGORY_LABEL) as HandoverCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Texto de la nota (>= 5 chars)"
                value={newNote.text}
                onChange={(e) =>
                  setNewNote((prev) => ({ ...prev, text: e.target.value }))
                }
                data-testid="shift-handover-note-input"
                className="col-span-5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-3 py-2 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
              <select
                value={newNote.severity}
                onChange={(e) =>
                  setNewNote((prev) => ({
                    ...prev,
                    severity: e.target.value as ShiftHandoverNote['severity'],
                  }))
                }
                data-testid="shift-handover-note-severity"
                className="col-span-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-2 py-2 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              >
                <option value="info">Info</option>
                <option value="attention">Atención</option>
                <option value="urgent">Urgente</option>
              </select>
              <button
                type="button"
                onClick={addNote}
                data-testid="shift-handover-note-add"
                className="col-span-1 rounded-lg bg-teal-500 hover:bg-teal-600 text-white px-2 py-2 text-xs font-bold flex items-center justify-center"
                aria-label="Añadir nota"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          </fieldset>

          <button
            type="button"
            onClick={() => void handleSubmitOutgoing()}
            disabled={submitting || (entries.length === 0 && notes.length === 0)}
            data-testid="shift-handover-submit-outgoing"
            className="w-full rounded-2xl bg-teal-500 hover:bg-teal-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-4 flex items-center justify-center gap-2 transition-colors"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            {submitting ? 'Enviando…' : 'Cerrar turno y enviar handover'}
          </button>
        </div>
      )}

      {/* ── MODE: INCOMING-ACK ── */}
      {mode === 'incoming-ack' && shift && (
        <div className="space-y-4">
          <ShiftSummaryReadonly shift={shift} />

          <div>
            <label
              htmlFor="ho-ack-notes"
              className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1"
            >
              Notas del entrante (opcional)
            </label>
            <textarea
              id="ho-ack-notes"
              data-testid="shift-handover-ack-notes"
              value={ackNotes}
              onChange={(e) => setAckNotes(e.target.value)}
              rows={3}
              placeholder="Observaciones al recibir el turno…"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleAcknowledge()}
            disabled={submitting}
            data-testid="shift-handover-submit-ack"
            className="w-full rounded-2xl bg-teal-500 hover:bg-teal-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-4 flex items-center justify-center gap-2 transition-colors"
          >
            <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
            {submitting ? 'Enviando…' : 'Acusar recibo'}
          </button>
        </div>
      )}

      {/* ── MODE: INCOMING-DISCREPANCY ── */}
      {mode === 'incoming-discrepancy' && shift && (
        <div className="space-y-4">
          <ShiftSummaryReadonly shift={shift} />

          <div className="rounded-lg border border-amber-300/60 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>
              Si detectaste algo que el supervisor saliente no documentó o
              está mal registrado, anótalo aquí. La discrepancia queda
              firmada con tu uid y la fecha actual.
            </span>
          </div>

          <div>
            <label
              htmlFor="ho-disc-text"
              className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1"
            >
              Descripción de la discrepancia (mín. 10 chars)
            </label>
            <textarea
              id="ho-disc-text"
              data-testid="shift-handover-discrepancy-text"
              value={discrepancyText}
              onChange={(e) => setDiscrepancyText(e.target.value)}
              rows={3}
              placeholder="Detalla qué no coincide con lo recibido…"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {shift.acknowledgmentNotes && (
            <div className="text-xs">
              <p className="font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                Notas y discrepancias previas
              </p>
              <pre className="whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 text-zinc-700 dark:text-zinc-300">
                {shift.acknowledgmentNotes}
              </pre>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleAddDiscrepancy()}
            disabled={submitting || discrepancyText.trim().length < 10}
            data-testid="shift-handover-submit-discrepancy"
            className="w-full rounded-2xl bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-4 flex items-center justify-center gap-2 transition-colors"
          >
            <FileWarning className="w-4 h-4" aria-hidden="true" />
            {submitting ? 'Enviando…' : 'Registrar discrepancia'}
          </button>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponent: read-only render of a closed shift.
// ────────────────────────────────────────────────────────────────────────

function ShiftSummaryReadonly({ shift }: { shift: ShiftRecord }) {
  return (
    <div
      className="space-y-2 text-xs"
      data-testid="shift-handover-summary-readonly"
    >
      <p className="text-zinc-600 dark:text-zinc-400">
        Turno <strong>{KIND_LABEL[shift.kind] ?? shift.kind}</strong> del
        supervisor <code className="text-teal-700 dark:text-teal-300">{shift.supervisorUid}</code>
        {shift.endedAt ? (
          <> · cerrado {new Date(shift.endedAt).toLocaleString()}</>
        ) : (
          <> · en curso</>
        )}
      </p>

      {shift.logEntries.length > 0 && (
        <div>
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">
            Eventos / pendientes ({shift.logEntries.length})
          </p>
          <ul className="space-y-1 mt-1">
            {shift.logEntries.map((e, i) => (
              <li
                key={i}
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1"
              >
                <span className="text-[10px] uppercase font-bold text-teal-700 dark:text-teal-300 mr-1">
                  {e.requiresFollowUp ? 'Pendiente' : 'Evento'}
                </span>
                {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {shift.handoverNotes.length > 0 && (
        <div>
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">
            Notas ({shift.handoverNotes.length})
          </p>
          <ul className="space-y-1 mt-1">
            {shift.handoverNotes.map((n, i) => (
              <li
                key={i}
                className={`border rounded px-2 py-1 ${SEVERITY_TONE[n.severity]}`}
              >
                <span className="font-bold uppercase text-[10px] mr-1">
                  {CATEGORY_LABEL[n.category]}
                </span>
                {n.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

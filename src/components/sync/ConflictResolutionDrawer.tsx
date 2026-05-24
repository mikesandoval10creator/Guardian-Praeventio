// Sprint 34 — Manual conflict-resolution drawer.
// §2.9 update (2026-05-22) — Role gate: solo "superior" (admin/gerente)
// puede resolver conflictos críticos. Directiva usuario:
//   "para no sobreescribir informacion importante que los dos supervisores
//    podrian subir estando offline, por lo que debe aprobar un superior".
//
// Surfaces a side-by-side view of "Tu versión offline" vs "Versión
// actual del servidor" for each critical field that diverged during
// the offline-sync flush. Per product rule, the app NEVER auto-decides
// a critical field; el SUPERIOR (admin/gerente) picks one of:
//   - "Mantener mía"        → local value wins
//   - "Aceptar servidor"    → remote value wins
//   - "Combinar manualmente" → free-form text input
//
// Si el usuario actual es un supervisor regular (rol 'supervisor',
// 'prevencionista', 'director_obra', 'medico_ocupacional'), ve un mensaje
// "Espera la decisión de tu gerente" — el conflicto queda en queue hasta
// que un usuario con rol admin/gerente abra la app y resuelva.
//
// Wiring: OfflineSyncManager dispatches `sync-critical-conflict` con un
// `Conflict` payload; este drawer subscribe, queues los conflictos, y
// emite `sync-critical-conflict-resolved` cuando el SUPERIOR completa
// el doc. El manager listens for that event y aplica el resolved field
// set a Firestore.

import React, { useEffect, useRef, useState } from 'react';
import type { Conflict, ResolutionChoice } from '../../services/sync/conflictResolver';
import { useFirebase } from '../../contexts/FirebaseContext';

/**
 * §2.9 fix (2026-05-22) — Roles que pueden APROBAR resolución de
 * conflictos críticos. Supervisores regulares ven el conflicto pero
 * NO pueden decidir — solo gerente/admin (directiva usuario).
 */
const APPROVER_ROLES: ReadonlySet<string> = new Set(['admin', 'gerente']);

function canApproveConflict(userRole: string): boolean {
  return APPROVER_ROLES.has(userRole);
}

export interface ConflictResolutionDrawerProps {
  /**
   * Test seam: pre-populate the drawer's queue without dispatching
   * a window event. Production wiring stays event-driven so the
   * drawer stays decoupled from the sync manager.
   */
  initialConflicts?: Conflict[];
  /**
   * Optional callback invoked when the supervisor commits a per-field
   * choice. The default behaviour also dispatches a
   * `sync-critical-conflict-resolved` window event consumed by
   * OfflineSyncManager, so wiring this prop is optional.
   */
  onResolve?: (
    conflict: Conflict,
    resolutions: Array<{ field: string; choice: ResolutionChoice; value: unknown }>,
  ) => void;
}

interface InProgressResolution {
  [field: string]: { choice: ResolutionChoice; value: unknown };
}

function valueToString(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function ConflictResolutionDrawer({
  initialConflicts,
  onResolve,
}: ConflictResolutionDrawerProps = {}) {
  const [queue, setQueue] = useState<Conflict[]>(initialConflicts ?? []);
  const [resolution, setResolution] = useState<InProgressResolution>({});
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // §2.9 (2026-05-22) — role gate: solo admin/gerente puede aprobar.
  // useFirebase devuelve userRole; defaultea a 'worker' (no approver).
  const { userRole } = useFirebase();
  const isApprover = canApproveConflict(userRole);

  // Subscribe to manager-emitted critical conflicts.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Conflict>).detail;
      if (!detail) return;
      setQueue((prev) => {
        const exists = prev.some(
          (c) => c.collection === detail.collection && c.docId === detail.docId,
        );
        return exists ? prev : [...prev, detail];
      });
    };
    window.addEventListener('sync-critical-conflict', handler as EventListener);
    return () =>
      window.removeEventListener(
        'sync-critical-conflict',
        handler as EventListener,
      );
  }, []);

  // Reset in-progress map when the front-of-queue conflict changes, and
  // move keyboard focus into the dialog for WCAG.
  const head = queue[0];
  const headKey = head ? `${head.collection}:${head.docId}` : null;
  useEffect(() => {
    setResolution({});
    if (head && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [headKey, head]);

  // Escape closes the drawer (cancels current resolution; conflict stays
  // in queue so the supervisor can return to it).
  useEffect(() => {
    if (!head) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setQueue((prev) => prev.slice(1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [head]);

  if (!head) return null;

  const allResolved = head.fields.every((f) => resolution[f.field]);

  const setFieldChoice = (
    field: string,
    choice: ResolutionChoice,
    localValue: unknown,
    remoteValue: unknown,
    manualValue?: unknown,
  ) => {
    setResolution((prev) => ({
      ...prev,
      [field]: {
        choice,
        value:
          choice === 'local'
            ? localValue
            : choice === 'remote'
              ? remoteValue
              : manualValue,
      },
    }));
  };

  const submit = () => {
    const resolutions = head.fields.map((f) => ({
      field: f.field,
      choice: resolution[f.field].choice,
      value: resolution[f.field].value,
    }));
    onResolve?.(head, resolutions);
    window.dispatchEvent(
      new CustomEvent('sync-critical-conflict-resolved', {
        detail: {
          collection: head.collection,
          docId: head.docId,
          resolutions,
        },
      }),
    );
    setQueue((prev) => prev.slice(1));
  };

  // §2.9 fix (2026-05-22) — Si el usuario actual NO es approver (admin/
  // gerente), mostramos un mensaje claro de "esperar superior" en lugar
  // del UI de resolución. El conflicto permanece en queue hasta que un
  // approver abra la app y lo resuelva.
  //
  // Directiva usuario: "para no sobreescribir información importante que
  // los dos supervisores podrian subir estando offline, por lo que debe
  // aprobar un superior".
  if (!isApprover) {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-drawer-pending-title"
        tabIndex={-1}
        data-testid="conflict-resolution-drawer-pending-approval"
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 outline-none"
      >
        <div className="w-full max-w-2xl rounded-t-2xl bg-white dark:bg-neutral-900 p-5 shadow-xl">
          <header className="mb-3">
            <h2
              id="conflict-drawer-pending-title"
              className="text-sm font-bold text-amber-700 dark:text-amber-400"
            >
              ⚠️ Conflicto crítico — esperando aprobación de superior
            </h2>
            <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-1">
              {head.docType} · {head.docId} · {head.fields.length} campo(s) divergente(s)
              {queue.length > 1 ? ` · ${queue.length - 1} más en cola` : ''}
            </p>
          </header>
          <div className="text-xs text-neutral-700 dark:text-neutral-300 space-y-2 mb-4">
            <p>
              Dos personas editaron este registro estando offline y los valores
              críticos divergen. Por seguridad, <strong>la decisión debe ser
              aprobada por un gerente o administrador</strong> antes de
              sobreescribir la información.
            </p>
            <p>
              Avisa a tu gerente que abra la app — al hacerlo verá este
              conflicto y podrá decidir qué versión queda. Mientras tanto:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>El cambio queda en la cola de sincronización (no se pierde).</li>
              <li>El servidor mantiene su última versión vigente.</li>
              <li>Tú puedes seguir trabajando en otros registros.</li>
            </ul>
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 pt-2 border-t border-neutral-200 dark:border-neutral-700">
              Tu rol actual: <code>{userRole}</code>. Solo los roles{' '}
              <code>admin</code> / <code>gerente</code> pueden aprobar
              conflictos críticos.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setQueue((prev) => prev.slice(1))}
            className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 text-sm font-bold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            data-testid="conflict-drawer-pending-dismiss"
          >
            Entendido — esperar al gerente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-drawer-title"
      tabIndex={-1}
      data-testid="conflict-resolution-drawer"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 outline-none"
    >
      <div className="w-full max-w-3xl rounded-t-2xl bg-white dark:bg-neutral-900 p-4 shadow-xl">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2
              id="conflict-drawer-title"
              className="text-sm font-bold text-neutral-900 dark:text-neutral-50"
            >
              Conflicto crítico — revisión humana requerida (rol superior)
            </h2>
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              {head.docType} · {head.docId} · campos críticos divergentes:{' '}
              {head.fields.length}
              {queue.length > 1 ? ` · ${queue.length - 1} pendientes después` : ''}
            </p>
            {head.isDeletionConflict && (
              <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mt-1">
                Conflicto de eliminación: tú quisiste borrarlo, el servidor lo actualizó.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setQueue((prev) => prev.slice(1))}
            aria-label="Cerrar (decisión pendiente)"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ×
          </button>
        </header>

        <ul className="flex flex-col gap-3">
          {head.fields.map((f) => {
            const chosen = resolution[f.field]?.choice;
            const inputId = `manual-${f.field}`;
            return (
              <li
                key={f.field}
                className="rounded border border-neutral-200 dark:border-neutral-700 p-3"
              >
                <p className="text-xs font-bold text-neutral-700 dark:text-neutral-200 mb-2">
                  Campo: <code>{f.field}</code>
                  {f.critical && (
                    <span className="ml-2 rounded bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-200">
                      crítico
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded bg-blue-50 dark:bg-blue-950 p-2">
                    <p className="font-bold text-blue-800 dark:text-blue-200 mb-1">
                      Tu versión offline
                    </p>
                    <pre className="whitespace-pre-wrap break-words text-blue-900 dark:text-blue-100">
                      {valueToString(f.localValue)}
                    </pre>
                  </div>
                  <div className="rounded bg-emerald-50 dark:bg-emerald-950 p-2">
                    <p className="font-bold text-emerald-800 dark:text-emerald-200 mb-1">
                      Versión actual del servidor
                    </p>
                    <pre className="whitespace-pre-wrap break-words text-emerald-900 dark:text-emerald-100">
                      {valueToString(f.remoteValue)}
                    </pre>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={chosen === 'local'}
                    onClick={() =>
                      setFieldChoice(f.field, 'local', f.localValue, f.remoteValue)
                    }
                    className={`rounded border px-2 py-1 text-xs ${
                      chosen === 'local'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-neutral-300 dark:border-neutral-700'
                    }`}
                  >
                    Mantener mía
                  </button>
                  <button
                    type="button"
                    aria-pressed={chosen === 'remote'}
                    onClick={() =>
                      setFieldChoice(f.field, 'remote', f.localValue, f.remoteValue)
                    }
                    className={`rounded border px-2 py-1 text-xs ${
                      chosen === 'remote'
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-neutral-300 dark:border-neutral-700'
                    }`}
                  >
                    Aceptar servidor
                  </button>
                  <label
                    htmlFor={inputId}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="font-bold">Combinar manualmente:</span>
                    <input
                      id={inputId}
                      type="text"
                      defaultValue={valueToString(f.localValue)}
                      onChange={(ev) =>
                        setFieldChoice(
                          f.field,
                          'manual',
                          f.localValue,
                          f.remoteValue,
                          ev.target.value,
                        )
                      }
                      className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1"
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setQueue((prev) => prev.slice(1))}
            className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-xs"
          >
            Posponer
          </button>
          <button
            type="button"
            disabled={!allResolved}
            onClick={submit}
            className="rounded bg-teal-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            Aplicar resolución
          </button>
        </footer>
      </div>
    </div>
  );
}

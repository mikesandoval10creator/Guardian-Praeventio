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
// Wiring: el drawer hidrata la cola durable por proyecto desde la API,
// refresca en foreground/online y cada 5 s para reflejar otros dispositivos,
// y usa las transiciones server-side mark-in-review/resolve. El evento
// `sync-critical-conflict` queda solo como fast feedback mientras el enqueue
// se vuelve visible; en producción nunca autoriza un write directo.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Conflict, ResolutionChoice } from '../../services/sync/conflictResolver';
import type { ConflictQueueEntry, ConflictQueueStatus } from '../../services/sync/conflictQueue';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useProject } from '../../contexts/ProjectContext';
import { apiAuthHeader } from '../../lib/apiAuth';
import { logger } from '../../utils/logger';

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
   * choice from `initialConflicts`. This compatibility seam is not used by
   * the production durable queue.
   */
  onResolve?: (
    conflict: Conflict,
    resolutions: Array<{ field: string; choice: ResolutionChoice; value: unknown }>,
  ) => void;
}

interface InProgressResolution {
  [field: string]: { choice: ResolutionChoice; value: unknown };
}

interface DrawerQueueItem {
  conflict: Conflict;
  queueId?: string;
  status?: ConflictQueueStatus;
  /** Test/embedding seam; production window events must wait for durability. */
  localResolutionAllowed?: boolean;
}

interface ConflictQueueListResponse {
  entries?: ConflictQueueEntry[];
}

const DURABLE_REFRESH_MS = 5_000;

function conflictIdentity(conflict: Conflict): string {
  return [
    conflict.collection,
    conflict.docId,
    conflict.localUpdatedAt,
    conflict.serverUpdatedAt,
  ].join(':');
}

function durableErrorMessage(code: string | undefined): string {
  if (code === 'STALE_TARGET') {
    return 'El registro cambió en otro dispositivo. La cola se actualizó sin sobrescribir esa versión; revisa nuevamente.';
  }
  if (code === 'TARGET_SCOPE_MISMATCH') {
    return 'El conflicto no pertenece al proyecto activo. No se aplicó ningún cambio.';
  }
  if (code === 'TARGET_NOT_FOUND') {
    return 'El registro original ya no existe. El conflicto quedó pendiente para revisión.';
  }
  return 'No se pudo guardar la resolución. El conflicto sigue pendiente; inténtalo nuevamente.';
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
  const [queue, setQueue] = useState<DrawerQueueItem[]>(() =>
    (initialConflicts ?? []).map((conflict) => ({
      conflict,
      localResolutionAllowed: true,
    })),
  );
  const [resolution, setResolution] = useState<InProgressResolution>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const reviewRequested = useRef<Set<string>>(new Set());
  // §2.9 (2026-05-22) — role gate: solo admin/gerente puede aprobar.
  // useFirebase devuelve userRole; defaultea a 'worker' (no approver).
  const { userRole } = useFirebase();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;
  const isApprover = canApproveConflict(userRole);

  const refreshDurableQueue = useCallback(async () => {
    if (!projectId) {
      setQueue((prev) => prev.filter((item) => !item.queueId));
      return;
    }
    try {
      const authHeader = await apiAuthHeader();
      if (!authHeader) return;
      const response = await fetch(
        `/api/sprint-k/${encodeURIComponent(projectId)}/conflict-queue`,
        { headers: { Authorization: authHeader } },
      );
      if (!response.ok) throw new Error(`conflict queue list failed: ${response.status}`);
      const body = (await response.json()) as ConflictQueueListResponse;
      const durable = (Array.isArray(body.entries) ? body.entries : [])
        .filter((entry) => entry.status === 'pending' || entry.status === 'in_review')
        .map<DrawerQueueItem>((entry) => ({
          conflict: entry.conflict,
          queueId: entry.queueId,
          status: entry.status,
        }));
      const durableKeys = new Set(durable.map((item) => conflictIdentity(item.conflict)));
      const activeQueueIds = new Set(
        durable.flatMap((item) => (item.queueId ? [item.queueId] : [])),
      );
      for (const requestedId of reviewRequested.current) {
        if (!activeQueueIds.has(requestedId)) reviewRequested.current.delete(requestedId);
      }
      setQueue((prev) => [
        ...durable,
        ...prev.filter(
          (item) => !item.queueId && !durableKeys.has(conflictIdentity(item.conflict)),
        ),
      ]);
    } catch (error) {
      logger.warn('ConflictResolutionDrawer: durable queue refresh failed', {
        projectId,
        error,
      });
    }
  }, [projectId]);

  // Hydrate after login/project selection, then keep multiple devices in sync
  // with a short authenticated poll plus immediate refresh on foreground/online.
  useEffect(() => {
    void refreshDurableQueue();
    if (!projectId) return undefined;
    const interval = window.setInterval(() => {
      void refreshDurableQueue();
    }, DURABLE_REFRESH_MS);
    const refresh = () => void refreshDurableQueue();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [projectId, refreshDurableQueue]);

  // Subscribe to manager-emitted critical conflicts. If the server-backed item
  // arrives on the next refresh it replaces this local fast-path entry.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Conflict>).detail;
      if (!detail) return;
      setQueue((prev) => {
        const key = conflictIdentity(detail);
        return prev.some((item) => conflictIdentity(item.conflict) === key)
          ? prev
          : [...prev, { conflict: detail }];
      });
    };
    window.addEventListener('sync-critical-conflict', handler as EventListener);
    return () =>
      window.removeEventListener(
        'sync-critical-conflict',
        handler as EventListener,
      );
  }, []);

  const headItem = queue[0];
  const head = headItem?.conflict;
  const headKey = headItem
    ? headItem.queueId ?? `local:${conflictIdentity(headItem.conflict)}`
    : null;

  // Opening a durable pending item claims the review server-side. The endpoint
  // is authoritative; a concurrent reviewer may already have advanced it.
  useEffect(() => {
    if (
      !isApprover ||
      !projectId ||
      !headItem?.queueId ||
      headItem.status !== 'pending' ||
      reviewRequested.current.has(headItem.queueId)
    ) {
      return undefined;
    }
    const queueId = headItem.queueId;
    reviewRequested.current.add(queueId);
    void (async () => {
      try {
        const authHeader = await apiAuthHeader();
        if (!authHeader) throw new Error('missing auth');
        const response = await fetch(
          `/api/sprint-k/${encodeURIComponent(projectId)}/conflict-queue/${encodeURIComponent(queueId)}/mark-in-review`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({}),
          },
        );
        if (!response.ok) {
          if (response.status === 409 || response.status === 404) {
            await refreshDurableQueue();
            return;
          }
          throw new Error(`mark in review failed: ${response.status}`);
        }
        setQueue((prev) =>
          prev.map((item) =>
            item.queueId === queueId ? { ...item, status: 'in_review' } : item,
          ),
        );
      } catch (error) {
        reviewRequested.current.delete(queueId);
        logger.warn('ConflictResolutionDrawer: mark-in-review failed', {
          projectId,
          queueId,
          error,
        });
      }
    })();
    return undefined;
  }, [headItem, isApprover, projectId, refreshDurableQueue]);

  // Reset in-progress map when the front-of-queue conflict changes, and
  // move keyboard focus into the dialog for WCAG. A polling refresh that keeps
  // the same queueId must not erase choices already made by the reviewer.
  useEffect(() => {
    setResolution({});
    setSubmitError(null);
    if (headKey && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [headKey]);

  // Escape closes the drawer (cancels current resolution; durable conflicts
  // reappear on the next refresh until the server records a final state).
  useEffect(() => {
    if (!head) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setQueue((prev) => prev.slice(1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [headKey, head]);

  if (!head || !headItem) return null;

  const allResolved = head.fields.every((f) => resolution[f.field]);

  const setFieldChoice = (
    field: string,
    choice: ResolutionChoice,
    localValue: unknown,
    remoteValue: unknown,
    manualValue?: unknown,
  ) => {
    setSubmitError(null);
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

  const submit = async () => {
    if (!allResolved || submitting) return;
    const resolutions = head.fields.map((f) => ({
      field: f.field,
      choice: resolution[f.field].choice,
      value: resolution[f.field].value,
    }));

    if (!headItem.queueId && projectId && !headItem.localResolutionAllowed) {
      setSubmitError(
        'El conflicto aún se está guardando en la cola segura del servidor. No se aplicó ningún cambio; espera la sincronización e inténtalo nuevamente.',
      );
      await refreshDurableQueue();
      return;
    }

    if (headItem.queueId && projectId) {
      setSubmitting(true);
      setSubmitError(null);
      try {
        const authHeader = await apiAuthHeader();
        if (!authHeader) throw new Error('missing auth');
        const durableResolution = Object.fromEntries(
          resolutions.map((item) => [
            item.field,
            { chosen: item.choice, value: item.value },
          ]),
        );
        const response = await fetch(
          `/api/sprint-k/${encodeURIComponent(projectId)}/conflict-queue/${encodeURIComponent(headItem.queueId)}/resolve`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({ resolution: durableResolution }),
          },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setSubmitError(durableErrorMessage(body.error));
          return;
        }
        const resolvedQueueId = headItem.queueId;
        reviewRequested.current.delete(resolvedQueueId);
        setQueue((prev) => prev.filter((item) => item.queueId !== resolvedQueueId));
        await refreshDurableQueue();
      } catch (error) {
        logger.warn('ConflictResolutionDrawer: durable resolution failed', {
          projectId,
          queueId: headItem.queueId,
          error,
        });
        setSubmitError(durableErrorMessage(undefined));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Compatibility path for explicitly injected initialConflicts (tests or
    // embedders without an active project). Production window events are held
    // above until the durable queueId exists.
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

        {submitError && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {submitError}
          </p>
        )}

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
            disabled={!allResolved || submitting}
            onClick={() => void submit()}
            className="rounded bg-teal-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {submitting ? 'Aplicando…' : 'Aplicar resolución'}
          </button>
        </footer>
      </div>
    </div>
  );
}

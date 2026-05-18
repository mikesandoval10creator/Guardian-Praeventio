// Praeventio Guard — Fase F.15 page wrapper.
//
// Centro de Permisos de Trabajo. Cierra la última pieza del flujo F.15
// que ya tenía service (`workPermitEngine`) + adapter
// (`workPermitFirestoreAdapter`) + componentes (`WorkPermitCard`,
// `PermitChecklistRenderer`) + validators + lifecycle advisor, pero no
// estaba accesible desde la navegación: el flujo de permisos críticos
// (DS 594 / DS 132 / DS 109) quedaba inerte aunque el motor estuviera
// listo.
//
// Esta página:
//   1. Lee permisos vía `useWorkPermits` (Sprint K hook) filtrados por
//      status (activos / vencidos / cerrados) y kind (altura / caliente /
//      confinado / loto / excavación / izaje crítico).
//   2. Renderiza `<WorkPermitCard>` para cada permiso (componente
//      existente, no modificado).
//   3. Permite crear un nuevo permiso vía form inline → calls
//      `createWorkPermit` con preconditions defaults + checklist canónico
//      del kind (vía `checklistForPermitKind`).
//   4. Acciones por permiso: firmar (sign) y cerrar (close con razón).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, WifiOff, Plus, X } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { auth } from '../services/firebase';
import {
  useWorkPermits,
  createWorkPermit,
  signWorkPermit,
  closeWorkPermit,
} from '../hooks/useWorkPermits';
import { WorkPermitCard } from '../components/workPermits/WorkPermitCard';
import {
  deriveStatus,
  type WorkPermit,
  type WorkPermitKind,
  type WorkPermitStatus,
} from '../services/workPermits/workPermitEngine';
import { logger } from '../utils/logger';

const KIND_OPTIONS: ReadonlyArray<{ kind: WorkPermitKind; labelKey: string; labelFallback: string }> = [
  { kind: 'altura', labelKey: 'permits.kind.altura', labelFallback: 'Altura' },
  { kind: 'caliente', labelKey: 'permits.kind.caliente', labelFallback: 'Caliente' },
  { kind: 'confinado', labelKey: 'permits.kind.confinado', labelFallback: 'Confinado' },
  { kind: 'excavacion', labelKey: 'permits.kind.excavacion', labelFallback: 'Excavación' },
  { kind: 'izaje_critico', labelKey: 'permits.kind.izaje_critico', labelFallback: 'Izaje' },
  { kind: 'loto', labelKey: 'permits.kind.loto', labelFallback: 'LOTO' },
];

type StatusFilter = 'active' | 'expired' | 'fulfilled' | 'cancelled';

const STATUS_FILTERS: ReadonlyArray<{ status: StatusFilter; labelKey: string; labelFallback: string }> = [
  { status: 'active', labelKey: 'permits.status.active', labelFallback: 'Activos' },
  { status: 'expired', labelKey: 'permits.status.expired', labelFallback: 'Vencidos' },
  { status: 'fulfilled', labelKey: 'permits.status.fulfilled', labelFallback: 'Cerrados' },
  { status: 'cancelled', labelKey: 'permits.status.cancelled', labelFallback: 'Anulados' },
];

export function WorkPermits() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [kindFilter, setKindFilter] = useState<WorkPermitKind | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formKind, setFormKind] = useState<WorkPermitKind>('altura');
  const [formTask, setFormTask] = useState('');
  const [formZone, setFormZone] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resp = useWorkPermits(projectId, {
    status: statusFilter as WorkPermitStatus,
    kind: kindFilter ?? undefined,
  });

  const loading = resp.loading;
  const error = resp.error;
  const permits = useMemo<WorkPermit[]>(
    () => resp.data?.permits ?? [],
    [resp.data],
  );

  const handleCreate = async () => {
    if (!projectId) return;
    if (formTask.trim().length < 3) {
      setFormError(
        t('permits.form.errorTask', 'La descripción debe tener al menos 3 caracteres.') as string,
      );
      return;
    }
    // Codex P2 #3: do not fabricate UIDs. The form requests the permit
    // for the currently authenticated user; the server replaces approver
    // identity with its own derivation (P1 #2) and uses workerUid as a
    // self-assignment hint. A proper worker autocomplete + admin selector
    // will replace this minimal V1 in a follow-up.
    const currentUid = auth.currentUser?.uid ?? null;
    if (!currentUid) {
      setFormError(
        t(
          'permits.form.errorAuth',
          'Inicia sesión para solicitar un permiso.',
        ) as string,
      );
      return;
    }
    setFormSubmitting(true);
    setFormError(null);
    try {
      const id = `wp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      // Codex P1 #1: do NOT send a pre-attested checklist. The server
      // ignores the body's checklist and seeds the canonical unchecked
      // template; we omit the field entirely so the contract is obvious.
      // Preconditions are likewise omitted — the supervisor attests them
      // in the dedicated sign step.
      await createWorkPermit(projectId, {
        id,
        kind: formKind,
        // P2 #3: real authenticated worker uid (self-assignment for V1).
        workerUid: currentUid,
        zoneId: formZone.trim() || undefined,
        taskDescription: formTask.trim(),
        durationHours: 8,
      });
      logger.info('workPermits.created', { id, kind: formKind });
      setShowCreateForm(false);
      setFormTask('');
      setFormZone('');
      resp.refetch?.();
    } catch (err) {
      logger.error('workPermits.create.failed', err);
      setFormError(
        (err as Error).message ||
          (t('permits.form.errorCreate', 'No se pudo crear el permiso.') as string),
      );
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleSign = async (permit: WorkPermit) => {
    if (!projectId) return;
    try {
      await signWorkPermit(projectId, permit.id);
      logger.info('workPermits.signed', { id: permit.id });
      resp.refetch?.();
    } catch (err) {
      logger.error('workPermits.sign.failed', err);
    }
  };

  // Codex P2 #5: WorkPermitCard exposes both "fulfill" and "cancel"
  // buttons but both used to call the same handler with outcome='fulfill',
  // so a user clicking "Cancelar" actually marked the permit as
  // fulfilled. The page now wires fulfill/cancel to distinct callbacks
  // that pass the real outcome to the engine.
  const promptCloseReason = (kind: 'fulfill' | 'cancel'): string | null => {
    const promptKey =
      kind === 'cancel' ? 'permits.cancelPrompt' : 'permits.fulfillPrompt';
    const fallback =
      kind === 'cancel'
        ? 'Razón de anulación (mínimo 10 caracteres):'
        : 'Comentario de cierre (mínimo 10 caracteres):';
    const reason = window.prompt(t(promptKey, fallback) as string);
    if (!reason || reason.trim().length < 10) return null;
    return reason.trim();
  };

  const handleFulfill = async (permit: WorkPermit) => {
    if (!projectId) return;
    const reason = promptCloseReason('fulfill');
    if (!reason) return;
    try {
      await closeWorkPermit(projectId, permit.id, reason, 'fulfill');
      logger.info('workPermits.fulfilled', { id: permit.id });
      resp.refetch?.();
    } catch (err) {
      logger.error('workPermits.fulfill.failed', err);
    }
  };

  const handleCancel = async (permit: WorkPermit) => {
    if (!projectId) return;
    const reason = promptCloseReason('cancel');
    if (!reason) return;
    try {
      await closeWorkPermit(projectId, permit.id, reason, 'cancel');
      logger.info('workPermits.cancelled', { id: permit.id });
      resp.refetch?.();
    } catch (err) {
      logger.error('workPermits.cancel.failed', err);
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="work-permits-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ShieldCheck
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('permits.page.title', 'Centro de Permisos de Trabajo')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'permits.page.selectProject',
              'Selecciona un proyecto para ver los permisos de trabajo.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="work-permits-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
          <ShieldCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('permits.page.title', 'Centro de Permisos de Trabajo')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'permits.page.subtitle',
              'LOTO / Altura / Caliente / Confinado / Excavación / Izaje — DS 594, DS 132, DS 109. {{count}} permisos cargados.',
              { count: permits.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="work-permits-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowCreateForm((s) => !s)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600"
          data-testid="work-permits-new-button"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          {t('permits.new', 'Nuevo permiso')}
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
          className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
          data-testid="work-permits-create-form"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-tight text-primary-token">
              {t('permits.form.title', 'Nuevo permiso')}
            </h2>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="ml-auto rounded p-1 text-secondary-token hover:bg-surface-elevated"
              aria-label={t('common.close', 'Cerrar') as string}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <label className="block text-xs font-bold text-secondary-token uppercase">
            {t('permits.form.kindLabel', 'Tipo')}
            <select
              value={formKind}
              onChange={(e) => setFormKind(e.target.value as WorkPermitKind)}
              className="mt-1 w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-sm text-primary-token"
              data-testid="work-permits-form.kind"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {t(k.labelKey, k.labelFallback)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-bold text-secondary-token uppercase">
            {t('permits.form.zoneLabel', 'Zona / ubicación')}
            <input
              type="text"
              value={formZone}
              onChange={(e) => setFormZone(e.target.value)}
              className="mt-1 w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-sm text-primary-token"
              placeholder={t('permits.form.zonePlaceholder', 'p.ej. Plataforma N3, área de tanques…') as string}
              data-testid="work-permits-form.zone"
            />
          </label>

          <label className="block text-xs font-bold text-secondary-token uppercase">
            {t('permits.form.taskLabel', 'Descripción de la tarea')}
            <textarea
              value={formTask}
              onChange={(e) => setFormTask(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-sm text-primary-token"
              data-testid="work-permits-form.task"
            />
          </label>

          {formError && (
            <p
              className="text-xs text-rose-600 dark:text-rose-400"
              data-testid="work-permits-form.error"
              role="alert"
            >
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={formSubmitting}
            className="w-full rounded bg-amber-500 px-3 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60"
            data-testid="work-permits-form.submit"
          >
            {formSubmitting
              ? t('common.saving', 'Guardando…')
              : t('permits.form.submit', 'Crear permiso')}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-1.5" data-testid="work-permits-kind-filters">
        <button
          type="button"
          onClick={() => setKindFilter(null)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
            kindFilter === null
              ? 'bg-amber-500 text-white'
              : 'bg-surface-elevated text-secondary-token hover:bg-surface'
          }`}
          data-testid="work-permits-kind.all"
        >
          {t('permits.kind.all', 'Todas')}
        </button>
        {KIND_OPTIONS.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => setKindFilter(k.kind)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              kindFilter === k.kind
                ? 'bg-amber-500 text-white'
                : 'bg-surface-elevated text-secondary-token hover:bg-surface'
            }`}
            data-testid={`work-permits-kind.${k.kind}`}
          >
            {t(k.labelKey, k.labelFallback)}
          </button>
        ))}
      </div>

      <div
        className="flex flex-wrap gap-1.5"
        data-testid="work-permits-status-filters"
      >
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.status}
            type="button"
            onClick={() => setStatusFilter(s.status)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              statusFilter === s.status
                ? 'bg-teal-500 text-white'
                : 'bg-surface-elevated text-secondary-token hover:bg-surface'
            }`}
            data-testid={`work-permits-status.${s.status}`}
          >
            {t(s.labelKey, s.labelFallback)}
          </button>
        ))}
      </div>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="work-permits-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="work-permits-error"
          role="alert"
        >
          {t('permits.page.error', 'No se pudieron cargar los permisos: {{msg}}', {
            msg: error.message,
          })}
        </div>
      )}

      {!loading && !error && permits.length === 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="work-permits-empty"
        >
          {t(
            'permits.page.empty',
            'No hay permisos para los filtros aplicados. Crea uno nuevo para empezar.',
          )}
        </div>
      )}

      {!loading && !error && permits.length > 0 && (
        <div className="space-y-3" data-testid="work-permits-list">
          {permits.map((permit) => {
            const status = deriveStatus(permit);
            return (
              <div key={permit.id} data-testid={`work-permits-item.${permit.id}`}>
                <WorkPermitCard
                  permit={permit}
                  onFulfill={status === 'active' ? handleFulfill : undefined}
                  onCancel={status === 'active' ? handleCancel : undefined}
                />
                {status === 'active' && (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleSign(permit)}
                      className="rounded bg-teal-500/15 px-3 py-1 text-[11px] font-bold uppercase text-teal-700 hover:bg-teal-500/25 dark:text-teal-300"
                      data-testid={`work-permits-sign.${permit.id}`}
                    >
                      {t('permits.sign', 'Firmar / re-validar')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default WorkPermits;

// Praeventio Guard — Fase F.6 page wrapper.
//
// Modo Sin Señal para Inspecciones (offline-first daily ops). Distinto
// del SOS de emergencia: aquí el inspector/supervisor ejecuta su
// inspección de terreno COMPLETA sin conexión:
//   - Captura observaciones (texto + foto) localmente.
//   - El servicio puro (`offlineInspectionService`) es determinístico
//     y no toca IndexedDB ni el FS — esta page es el adapter UI.
//   - El sync hacia el endpoint `/api/sprint-k/:projectId/inspections`
//     ocurre cuando la red vuelve. El servidor de-dup por id /
//     observationId, así que los retries del offline queue son seguros.
//
// Filosofía Praeventio:
//   - Detección Predictiva: hallazgos en terreno no se pierden por
//     falta de señal.
//   - Respuesta Adaptativa: el supervisor decide cuándo cierra la
//     sesión y cuándo agrega más observaciones.
//   - Consolidación: una vez sincronizada, la inspección queda como
//     nodo auditable y feedea Acciones Correctivas / SIF / lecciones.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck,
  WifiOff,
  Wifi,
  Plus,
  X,
  CheckCircle2,
  Clock,
  Camera,
  MapPin,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useInspections,
  startInspection as startInspectionAPI,
  addObservation as addObservationAPI,
  completeInspection as completeInspectionAPI,
  type InspectionRecord,
  type InspectionStatusAPI,
} from '../hooks/useSprintK';
import { randomId } from '../utils/randomId';
import { logger } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────
// Hard-coded checklist templates (Sprint F.6 launch set).
//
// We keep these inline rather than fetching from Firestore because the
// templates are stable across tenants (ISO 45001 + DS 594 inspections
// don't vary per faena) and inlining means the page renders the picker
// even when the device is offline at first paint — which is the whole
// point of the offline-first surface. A future sprint can add a
// tenant-level override layer if a faena needs custom items.
// ────────────────────────────────────────────────────────────────────────

interface ChecklistTemplate {
  id: string;
  title: string;
  itemCount: number;
}

const LAUNCH_TEMPLATES: ChecklistTemplate[] = [
  { id: 'tpl_altura_v1', title: 'Inspección Trabajo en Altura', itemCount: 8 },
  { id: 'tpl_loto_v1', title: 'Inspección LOTO / Bloqueo', itemCount: 6 },
  { id: 'tpl_caliente_v1', title: 'Trabajo en Caliente', itemCount: 7 },
  { id: 'tpl_confinado_v1', title: 'Espacios Confinados', itemCount: 9 },
  { id: 'tpl_epp_v1', title: 'EPP — Recorrido General', itemCount: 5 },
  { id: 'tpl_orden_aseo_v1', title: 'Orden y Aseo (5S)', itemCount: 6 },
];

// ────────────────────────────────────────────────────────────────────────
// Static visual helpers
// ────────────────────────────────────────────────────────────────────────

const STATUS_META: Record<
  InspectionStatusAPI,
  { label: string; color: string; bg: string; icon: typeof Clock }
> = {
  in_progress: {
    label: 'En curso',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/30',
    icon: Clock,
  },
  completed: {
    label: 'Completada',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    icon: CheckCircle2,
  },
};

const FILTER_OPTIONS: { value: InspectionStatusAPI | 'all'; label: string }[] = [
  { value: 'in_progress', label: 'En curso' },
  { value: 'completed', label: 'Completadas' },
  { value: 'all', label: 'Todas' },
];

function templateLabel(templateId: string): string {
  const known = LAUNCH_TEMPLATES.find((t) => t.id === templateId);
  if (known) return known.title;
  // Unknown template (created by a tenant override or legacy data) —
  // show the raw id so it's still identifiable in the list.
  return templateId;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export function OfflineInspection() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [statusFilter, setStatusFilter] = useState<InspectionStatusAPI | 'all'>(
    'in_progress',
  );
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    LAUNCH_TEMPLATES[0].id,
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Single hook call — we use a single status param (or 'all') instead
  // of fanning out like CorrectiveActions, because inspections have
  // only two states and the most common view is "En curso" alone.
  const resp = useInspections(projectId, { status: statusFilter });

  const inspections: InspectionRecord[] = useMemo(
    () => resp.data?.inspections ?? [],
    [resp.data],
  );

  const detail = useMemo(
    () => inspections.find((i) => i.id === detailId) ?? null,
    [inspections, detailId],
  );

  const handleStartInspection = async () => {
    if (!projectId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const sessionId = randomId();
      await startInspectionAPI(projectId, {
        id: sessionId,
        templateId: selectedTemplateId,
        // For Sprint F.6 launch the inspector is also the responsible.
        // A future sprint can add assignment via a worker picker.
        responsibleUid: 'self',
      });
      setShowNewModal(false);
      resp.refetch?.();
      setDetailId(sessionId);
      logger.info('offlineInspection.start.ok', {
        sessionId,
        templateId: selectedTemplateId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(msg);
      logger.error('offlineInspection.start.failed', err);
    } finally {
      setCreating(false);
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="offline-inspection-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ClipboardCheck
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('inspections.page.title', 'Inspecciones')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'inspections.page.selectProject',
              'Selecciona un proyecto para iniciar inspecciones de terreno.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="offline-inspection-page"
    >
      {/* Header with the OFFLINE chip — this is the value prop of F.6.
          The chip is rendered ALWAYS (not just when offline) so the
          inspector immediately sees the badge as a contract: "you can
          work here without signal." */}
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center border border-blue-500/20">
          <ClipboardCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('inspections.page.title', 'Inspecciones')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'inspections.page.subtitle',
              'Modo sin señal — los hallazgos se capturan localmente y se sincronizan al volver la red.',
            )}
          </p>
        </div>
        <span
          className={
            isOnline
              ? 'ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400'
              : 'ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400'
          }
          data-testid="offline-inspection-offline-chip"
          title={
            isOnline
              ? 'Online — los cambios se sincronizan al instante.'
              : 'Sin señal — los hallazgos se guardan localmente y se sincronizan al reconectar.'
          }
        >
          {isOnline ? (
            <Wifi className="w-3 h-3" aria-hidden="true" />
          ) : (
            <WifiOff className="w-3 h-3" aria-hidden="true" />
          )}
          {isOnline
            ? t('inspections.chip.online', 'Online — sync activo')
            : t('inspections.chip.offline', 'Sin señal — sync diferido')}
        </span>
      </header>

      {/* Filter toolbar + Nueva inspección CTA */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-default-token bg-surface p-3"
        data-testid="offline-inspection-toolbar"
      >
        <div className="flex flex-wrap gap-1">
          {FILTER_OPTIONS.map((opt) => {
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={
                  active
                    ? 'px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30'
                    : 'px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide bg-surface-alt text-secondary-token border border-default-token hover:border-blue-500/30'
                }
                data-testid={`offline-inspection-filter-${opt.value}`}
                aria-pressed={active}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            setShowNewModal(true);
            setCreateError(null);
          }}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide bg-blue-500 text-white border border-blue-500 hover:bg-blue-600"
          data-testid="offline-inspection-new-btn"
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
          {t('inspections.cta.new', 'Nueva inspección')}
        </button>
      </div>

      {/* Loading / error / list */}
      {resp.loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="offline-inspection-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {resp.error && !resp.loading && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2"
          data-testid="offline-inspection-error"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            {t(
              'inspections.page.error',
              'No se pudieron cargar las inspecciones: {{msg}}',
              { msg: resp.error.message },
            )}
          </span>
        </div>
      )}

      {!resp.loading && !resp.error && inspections.length === 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center"
          data-testid="offline-inspection-empty"
        >
          <ClipboardCheck
            className="w-10 h-10 mx-auto mb-3 text-secondary-token"
            aria-hidden="true"
          />
          <p className="text-sm text-secondary-token">
            {t(
              'inspections.page.empty',
              'No hay inspecciones en este estado. Inicia una nueva con el botón "Nueva inspección".',
            )}
          </p>
        </div>
      )}

      {!resp.loading && !resp.error && inspections.length > 0 && (
        <ul
          className="space-y-2"
          data-testid="offline-inspection-list"
        >
          {inspections.map((insp) => {
            const meta = STATUS_META[insp.status];
            const Icon = meta.icon;
            return (
              <li
                key={insp.id}
                className="rounded-2xl border border-default-token bg-surface p-4 hover:border-blue-500/30 cursor-pointer transition-colors"
                onClick={() => setDetailId(insp.id)}
                data-testid={`offline-inspection-card-${insp.id}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border ${meta.bg}`}
                  >
                    <Icon
                      className={`w-4 h-4 ${meta.color}`}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-primary-token truncate">
                        {templateLabel(insp.templateId)}
                      </h3>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-widest ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-secondary-token">
                      <span>
                        {t('inspections.card.started', 'Iniciada')}: {formatDate(insp.startedAt)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span data-testid={`offline-inspection-card-${insp.id}-obs-count`}>
                        {t(
                          'inspections.card.observations',
                          '{{count}} observaciones',
                          { count: insp.observations.length },
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal: Nueva inspección — template picker */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          data-testid="offline-inspection-new-modal"
        >
          <div className="w-full max-w-md rounded-2xl bg-surface border border-default-token p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-black text-primary-token uppercase tracking-tight">
                {t('inspections.modal.new.title', 'Nueva inspección')}
              </h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-secondary-token hover:text-primary-token"
                aria-label="Cerrar"
                data-testid="offline-inspection-new-modal-close"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-xs text-secondary-token">
              {t(
                'inspections.modal.new.help',
                'Selecciona el checklist a usar. Puedes agregar observaciones aunque no tengas señal.',
              )}
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wide text-secondary-token">
                {t('inspections.modal.new.template', 'Checklist')}
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full rounded-lg border border-default-token bg-surface-alt px-3 py-2 text-sm text-primary-token"
                data-testid="offline-inspection-new-template-select"
              >
                {LAUNCH_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.title} ({tpl.itemCount} ítems)
                  </option>
                ))}
              </select>
            </div>
            {createError && (
              <div
                className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400"
                role="alert"
              >
                {createError}
              </div>
            )}
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border border-default-token text-secondary-token"
              >
                {t('common.cancel', 'Cancelar')}
              </button>
              <button
                type="button"
                onClick={handleStartInspection}
                disabled={creating}
                className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide bg-blue-500 text-white disabled:opacity-50"
                data-testid="offline-inspection-new-confirm"
              >
                {creating
                  ? t('common.starting', 'Iniciando…')
                  : t('inspections.modal.new.confirm', 'Iniciar inspección')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: detalle de inspección — lista de observaciones + form */}
      {detail && projectId && (
        <InspectionDetailModal
          inspection={detail}
          projectId={projectId}
          onClose={() => setDetailId(null)}
          onRefetch={() => resp.refetch?.()}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// InspectionDetailModal
// ────────────────────────────────────────────────────────────────────────

interface InspectionDetailModalProps {
  inspection: InspectionRecord;
  projectId: string;
  onClose: () => void;
  onRefetch: () => void;
}

function InspectionDetailModal({
  inspection,
  projectId,
  onClose,
  onRefetch,
}: InspectionDetailModalProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [obsError, setObsError] = useState<string | null>(null);

  const isCompleted = inspection.status === 'completed';

  const handleAddObservation = async () => {
    if (!notes.trim() && !photoName) {
      setObsError(
        t(
          'inspections.detail.obs.empty',
          'Agrega una nota o foto antes de guardar.',
        ) as string,
      );
      return;
    }
    setSaving(true);
    setObsError(null);
    try {
      await addObservationAPI(projectId, inspection.id, {
        observationId: randomId(),
        notes: notes.trim() || undefined,
        // For Sprint F.6 we only record the photo NAME locally; the
        // actual upload + storage path resolution is a follow-up
        // (TODO sprint F.6.1: pipe through `<input capture>` → blob →
        // storage upload → photoStoragePath). The server schema
        // accepts the photoStoragePath optional so this is forward-
        // compatible.
        photoStoragePath: photoName ?? undefined,
      });
      setNotes('');
      setPhotoName(null);
      onRefetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setObsError(msg);
      logger.error('offlineInspection.observation.failed', err);
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeInspectionAPI(projectId, inspection.id);
      onRefetch();
      onClose();
      logger.info('offlineInspection.complete.ok', { id: inspection.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setObsError(msg);
      logger.error('offlineInspection.complete.failed', err);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="offline-inspection-detail-modal"
    >
      <div className="w-full max-w-xl rounded-2xl bg-surface border border-default-token p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-black text-primary-token uppercase tracking-tight">
              {templateLabel(inspection.templateId)}
            </h2>
            <p className="text-xs text-secondary-token">
              {t('inspections.card.started', 'Iniciada')}: {formatDate(inspection.startedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-secondary-token hover:text-primary-token"
            aria-label="Cerrar"
            data-testid="offline-inspection-detail-close"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Observations list */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-secondary-token">
            {t(
              'inspections.detail.obs.list',
              'Observaciones ({{count}})',
              { count: inspection.observations.length },
            )}
          </h3>
          {inspection.observations.length === 0 ? (
            <p
              className="text-xs text-secondary-token italic"
              data-testid="offline-inspection-detail-obs-empty"
            >
              {t(
                'inspections.detail.obs.empty.list',
                'Sin observaciones aún.',
              )}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {inspection.observations.map((obs) => (
                <li
                  key={obs.observationId}
                  className="rounded-lg border border-default-token bg-surface-alt p-3 text-xs space-y-1"
                  data-testid={`offline-inspection-detail-obs-${obs.observationId}`}
                >
                  <div className="flex items-center gap-1.5 text-secondary-token">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    <span>{formatDate(obs.recordedAt)}</span>
                  </div>
                  {obs.notes && (
                    <div className="flex items-start gap-1.5 text-primary-token">
                      <FileText
                        className="w-3 h-3 mt-0.5 flex-shrink-0"
                        aria-hidden="true"
                      />
                      <span className="break-words">{obs.notes}</span>
                    </div>
                  )}
                  {obs.photoStoragePath && (
                    <div className="flex items-center gap-1.5 text-secondary-token">
                      <Camera className="w-3 h-3" aria-hidden="true" />
                      <span className="truncate">{obs.photoStoragePath}</span>
                    </div>
                  )}
                  {obs.locationLatLng && (
                    <div className="flex items-center gap-1.5 text-secondary-token">
                      <MapPin className="w-3 h-3" aria-hidden="true" />
                      <span>
                        {obs.locationLatLng.lat.toFixed(4)},{' '}
                        {obs.locationLatLng.lng.toFixed(4)}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add observation form (only when in_progress) */}
        {!isCompleted && (
          <div
            className="space-y-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3"
            data-testid="offline-inspection-detail-add-form"
          >
            <h3 className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              {t('inspections.detail.obs.add', 'Agregar observación')}
            </h3>
            <label className="block text-[11px] text-secondary-token">
              {t('inspections.detail.obs.notes', 'Nota')}
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={t(
                  'inspections.detail.obs.placeholder',
                  'Describe el hallazgo…',
                ) as string}
                className="mt-1 w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-sm text-primary-token"
                data-testid="offline-inspection-detail-notes"
              />
            </label>
            <label className="block text-[11px] text-secondary-token">
              {t('inspections.detail.obs.photo', 'Foto (opcional)')}
              {/*
                `capture="environment"` opens the rear camera on mobile —
                that's the inspector's working camera. We only persist
                the file name in Sprint F.6 launch (TODO F.6.1: pipe
                the blob through the storage upload service).
              */}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPhotoName(f ? f.name : null);
                }}
                className="mt-1 block w-full text-xs text-secondary-token"
                data-testid="offline-inspection-detail-photo"
              />
              {photoName && (
                <span className="mt-1 inline-block text-[11px] text-blue-600 dark:text-blue-400">
                  {photoName}
                </span>
              )}
            </label>
            {obsError && (
              <div
                className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400"
                role="alert"
                data-testid="offline-inspection-detail-error"
              >
                {obsError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleAddObservation}
                disabled={saving}
                className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide bg-blue-500 text-white disabled:opacity-50"
                data-testid="offline-inspection-detail-save-obs"
              >
                {saving
                  ? t('common.saving', 'Guardando…')
                  : t('inspections.detail.obs.save', 'Guardar observación')}
              </button>
            </div>
          </div>
        )}

        {/* Complete action */}
        {!isCompleted && (
          <div className="pt-2 border-t border-default-token flex items-center justify-between gap-2">
            <p className="text-[11px] text-secondary-token">
              {t(
                'inspections.detail.complete.hint',
                'Cierra la inspección cuando termines de capturar observaciones.',
              )}
            </p>
            <button
              type="button"
              onClick={handleComplete}
              disabled={completing}
              className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide bg-emerald-500 text-white disabled:opacity-50"
              data-testid="offline-inspection-detail-complete"
            >
              {completing
                ? t('common.completing', 'Cerrando…')
                : t('inspections.detail.complete.cta', 'Cerrar inspección')}
            </button>
          </div>
        )}

        {isCompleted && inspection.completedAt && (
          <div
            className="pt-2 border-t border-default-token text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"
            data-testid="offline-inspection-detail-completed-stamp"
          >
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            <span>
              {t('inspections.detail.completed.at', 'Completada el')}:{' '}
              {formatDate(inspection.completedAt)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default OfflineInspection;

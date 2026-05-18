// Praeventio Guard — Sprint K §74-78 page wrapper.
//
// Centro de Brigada de Emergencia + Inventario de Recursos. Cierra
// la última pieza de §74-78: el servicio determinístico
// (`emergencyBrigadeService`) y el panel readiness ya existían, pero
// no había una pantalla navegable que permitiera al prevencionista
// dar de alta brigadistas o registrar recursos (extintores, AED,
// eyewash, kits, etc.).
//
// La página:
//   1. Trae el snapshot completo vía `useEmergencyBrigade(projectId)`.
//   2. Renderiza un banner de readiness (green / amber / rose) que
//      compone cobertura mínima de roles + recursos operativos
//      (lo que el endpoint ya calculó vía buildBrigadeCoverageReport
//      + buildResourceReadinessReport).
//   3. Dos secciones side-by-side: brigadistas por rol + recursos
//      con countdown a próxima inspección.
//   4. Modales simples para agregar brigadista / recurso.
//
// Determinístico: no LLM, no fetch a SUSESO/MINSAL. Las inspecciones
// se quedan internas — Empresa decide qué subir (Directiva 3 del
// usuario: nunca empujar a APIs gubernamentales).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldAlert,
  WifiOff,
  Users,
  Wrench,
  Plus,
  X,
  CheckCircle2,
  AlertCircle,
  QrCode,
  Flame,
  HeartPulse,
  Radio,
  Eye,
  Shield,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useEmergencyBrigade,
  addBrigadeMember,
  addBrigadeResource,
  inspectResource,
} from '../hooks/useEmergencyBrigade';
import type {
  BrigadeRole,
  EmergencyResource,
  BrigadeMember,
} from '../services/emergencyBrigade/emergencyBrigadeService';
import { logger } from '../utils/logger';

const ROLE_LABEL: Record<BrigadeRole, string> = {
  brigade_chief: 'Líder',
  fire_response: 'Incendios',
  first_aid: 'Primeros Auxilios',
  evacuation_coordinator: 'Evacuación',
  communications: 'Comunicaciones',
};

const ROLE_ICON: Record<BrigadeRole, typeof ShieldAlert> = {
  brigade_chief: Shield,
  fire_response: Flame,
  first_aid: HeartPulse,
  evacuation_coordinator: Users,
  communications: Radio,
};

const ROLE_COLOR: Record<BrigadeRole, string> = {
  brigade_chief: 'text-amber-500',
  fire_response: 'text-rose-500',
  first_aid: 'text-emerald-500',
  evacuation_coordinator: 'text-violet-500',
  communications: 'text-sky-500',
};

const RESOURCE_LABEL: Record<EmergencyResource['kind'], string> = {
  extinguisher: 'Extintor',
  first_aid_kit: 'Botiquín',
  aed: 'DEA',
  eyewash: 'Lavaojos',
  safety_shower: 'Ducha emergencia',
  fire_hose: 'Manguera',
  spill_kit: 'Kit derrames',
};

const RESOURCE_ICON: Record<EmergencyResource['kind'], typeof ShieldAlert> = {
  extinguisher: Flame,
  first_aid_kit: HeartPulse,
  aed: HeartPulse,
  eyewash: Eye,
  safety_shower: Wrench,
  fire_hose: Wrench,
  spill_kit: Wrench,
};

function daysUntil(iso: string, now: number = Date.now()): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.round((t - now) / 86_400_000);
}

interface AddMemberModalProps {
  onClose: () => void;
  onSubmit: (input: {
    workerUid: string;
    role: BrigadeRole;
    trainedAt: string;
  }) => Promise<void>;
}

function AddMemberModal({ onClose, onSubmit }: AddMemberModalProps) {
  const { t } = useTranslation();
  const [workerUid, setWorkerUid] = useState('');
  const [role, setRole] = useState<BrigadeRole>('brigade_chief');
  const [trainedAt, setTrainedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerUid.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        workerUid: workerUid.trim(),
        role,
        trainedAt,
      });
      onClose();
    } catch (err) {
      logger.error('brigade.addMember.failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      data-testid="brigade-add-member-modal"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl border border-default-token shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-default-token">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
            <Users className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="text-sm font-black text-primary-token uppercase tracking-tight flex-1">
            {t('brigade.addMember.title', 'Agregar brigadista')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-9 h-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-secondary-token"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3 text-sm">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t('brigade.addMember.uid', 'UID del trabajador')}
            </span>
            <input
              type="text"
              value={workerUid}
              onChange={(e) => setWorkerUid(e.target.value)}
              required
              data-testid="brigade-add-member-uid"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t('brigade.addMember.role', 'Rol')}
            </span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as BrigadeRole)}
              data-testid="brigade-add-member-role"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
            >
              {(Object.keys(ROLE_LABEL) as BrigadeRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t('brigade.addMember.trainedAt', 'Última capacitación')}
            </span>
            <input
              type="date"
              value={trainedAt}
              onChange={(e) => setTrainedAt(e.target.value)}
              required
              className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-bold text-secondary-token rounded-xl hover:bg-white/10"
            >
              {t('common.cancel', 'Cancelar')}
            </button>
            <button
              type="submit"
              disabled={submitting || !workerUid.trim()}
              data-testid="brigade-add-member-submit"
              className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 disabled:opacity-50"
            >
              {submitting
                ? t('common.saving', 'Guardando…')
                : t('common.add', 'Agregar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface AddResourceModalProps {
  onClose: () => void;
  onSubmit: (input: {
    kind: EmergencyResource['kind'];
    location: string;
    lastInspectedAt: string;
    nextExpirationAt: string;
  }) => Promise<void>;
}

function AddResourceModal({ onClose, onSubmit }: AddResourceModalProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<EmergencyResource['kind']>('extinguisher');
  const [location, setLocation] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const inOneYear = new Date(Date.now() + 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [lastInspectedAt, setLastInspectedAt] = useState(today);
  const [nextExpirationAt, setNextExpirationAt] = useState(inOneYear);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        kind,
        location: location.trim(),
        lastInspectedAt,
        nextExpirationAt,
      });
      onClose();
    } catch (err) {
      logger.error('brigade.addResource.failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      data-testid="brigade-add-resource-modal"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl border border-default-token shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-default-token">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
            <Wrench className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="text-sm font-black text-primary-token uppercase tracking-tight flex-1">
            {t('brigade.addResource.title', 'Agregar recurso')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-9 h-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-secondary-token"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3 text-sm">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t('brigade.addResource.kind', 'Tipo')}
            </span>
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as EmergencyResource['kind'])
              }
              data-testid="brigade-add-resource-kind"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
            >
              {(Object.keys(RESOURCE_LABEL) as EmergencyResource['kind'][]).map(
                (k) => (
                  <option key={k} value={k}>
                    {RESOURCE_LABEL[k]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t('brigade.addResource.location', 'Ubicación')}
            </span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
              data-testid="brigade-add-resource-location"
              placeholder="Ej: Pasillo norte, frente a sala eléctrica"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
                {t('brigade.addResource.lastInspected', 'Última inspección')}
              </span>
              <input
                type="date"
                value={lastInspectedAt}
                onChange={(e) => setLastInspectedAt(e.target.value)}
                required
                className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
                {t('brigade.addResource.nextExpiration', 'Próximo vencimiento')}
              </span>
              <input
                type="date"
                value={nextExpirationAt}
                onChange={(e) => setNextExpirationAt(e.target.value)}
                required
                className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-bold text-secondary-token rounded-xl hover:bg-white/10"
            >
              {t('common.cancel', 'Cancelar')}
            </button>
            <button
              type="submit"
              disabled={submitting || !location.trim()}
              data-testid="brigade-add-resource-submit"
              className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 disabled:opacity-50"
            >
              {submitting
                ? t('common.saving', 'Guardando…')
                : t('common.add', 'Agregar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Codex P2 round 2 #10 (PR #321, line 48): inspection modal for an
// existing resource. The page previously imported the `addResource`
// mutation but never wired the new `inspectResource` hook, so once a
// resource was expired / near expiration / marked out of service it
// stayed in `resourceReadiness.needingAttention` forever — users could
// not clear the readiness gap from the UI and needed a manual API/DB
// patch. This modal lets the user record an inspection (operational
// boolean + optional nextExpirationAt + optional notes), which the
// server backend writes to both the resource document and an audit
// inspection record. The "Inspeccionar" CTA is exposed on every
// resource card whose status is critical or warning.
interface InspectResourceModalProps {
  resource: EmergencyResource;
  onClose: () => void;
  onSubmit: (input: {
    inspectedAt: string;
    operational: boolean;
    nextExpirationAt?: string;
    notes?: string;
  }) => Promise<void>;
}

function InspectResourceModal({
  resource,
  onClose,
  onSubmit,
}: InspectResourceModalProps) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const inOneYear = new Date(Date.now() + 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [inspectedAt, setInspectedAt] = useState(today);
  const [operational, setOperational] = useState(true);
  const [nextExpirationAt, setNextExpirationAt] = useState(inOneYear);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        inspectedAt,
        operational,
        nextExpirationAt: nextExpirationAt || undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      logger.error('brigade.inspectResource.failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      data-testid="brigade-inspect-resource-modal"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl border border-default-token shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-default-token">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center border border-sky-500/20">
            <Wrench className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-primary-token uppercase tracking-tight">
              {t('brigade.inspectResource.title', 'Registrar inspección')}
            </h2>
            <p className="text-[11px] text-secondary-token truncate">
              {RESOURCE_LABEL[resource.kind]} · {resource.location}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-9 h-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-secondary-token"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3 text-sm">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t('brigade.inspectResource.inspectedAt', 'Fecha de inspección')}
            </span>
            <input
              type="date"
              value={inspectedAt}
              onChange={(e) => setInspectedAt(e.target.value)}
              required
              data-testid="brigade-inspect-resource-date"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={operational}
              onChange={(e) => setOperational(e.target.checked)}
              data-testid="brigade-inspect-resource-operational"
              className="w-4 h-4"
            />
            <span className="text-xs text-primary-token font-bold">
              {t(
                'brigade.inspectResource.operational',
                'Recurso operativo tras la inspección',
              )}
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t(
                'brigade.inspectResource.nextExpirationAt',
                'Próximo vencimiento (opcional)',
              )}
            </span>
            <input
              type="date"
              value={nextExpirationAt}
              onChange={(e) => setNextExpirationAt(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t('brigade.inspectResource.notes', 'Notas (opcional)')}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="brigade-inspect-resource-notes"
              rows={3}
              maxLength={2000}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-default-token bg-surface-elevated text-primary-token"
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-bold text-secondary-token rounded-xl hover:bg-white/10"
            >
              {t('common.cancel', 'Cancelar')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-testid="brigade-inspect-resource-submit"
              className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 disabled:opacity-50"
            >
              {submitting
                ? t('common.saving', 'Guardando…')
                : t('brigade.inspectResource.submit', 'Registrar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EmergencyBrigade() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;
  const { data, loading, error, refetch } = useEmergencyBrigade(projectId);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddResource, setShowAddResource] = useState(false);
  // Codex P2 round 2 #10 (PR #321): resource currently selected for
  // inspection — `null` when the modal is closed.
  const [inspectingResource, setInspectingResource] =
    useState<EmergencyResource | null>(null);

  // Group members by role for the side-by-side cards.
  //
  // Codex P2 #4 (PR #321, line 413): the snapshot endpoint returns the
  // raw `members` array (including `active: false` and expired
  // trainings) so the audit log is complete, but the server's
  // `brigade.byRole` / `uncoveredRoles` only count members that are
  // active AND whose `trainedAt + trainingValidYears` is still in the
  // future. If we pushed every returned member into the role bucket,
  // the card would say `1 miembro(s)` for a role the readiness banner
  // marks as a brecha — conflicting signals. Match the server's filter
  // here so the card never disagrees with the banner.
  const membersByRole = useMemo(() => {
    const buckets: Record<BrigadeRole, (BrigadeMember & { id: string })[]> = {
      brigade_chief: [],
      fire_response: [],
      first_aid: [],
      evacuation_coordinator: [],
      communications: [],
    };
    const nowMs = Date.now();
    for (const m of data?.members ?? []) {
      if (!m.active) continue;
      const trainedMs = Date.parse(m.trainedAt);
      if (!Number.isFinite(trainedMs)) continue;
      const expiresMs = trainedMs + m.trainingValidYears * 365 * 86_400_000;
      if (expiresMs < nowMs) continue;
      buckets[m.role].push(m);
    }
    return buckets;
  }, [data?.members]);

  const handleAddMember = async (input: {
    workerUid: string;
    role: BrigadeRole;
    trainedAt: string;
  }) => {
    if (!projectId) return;
    await addBrigadeMember(projectId, {
      workerUid: input.workerUid,
      role: input.role,
      trainedAt: input.trainedAt,
      trainingValidYears: 2,
    });
    refetch?.();
  };

  const handleAddResource = async (input: {
    kind: EmergencyResource['kind'];
    location: string;
    lastInspectedAt: string;
    nextExpirationAt: string;
  }) => {
    if (!projectId) return;
    await addBrigadeResource(projectId, {
      kind: input.kind,
      location: input.location,
      lastInspectedAt: input.lastInspectedAt,
      nextExpirationAt: input.nextExpirationAt,
    });
    refetch?.();
  };

  // Codex P2 round 2 #10 (PR #321): wires the new inspection endpoint
  // to the page. After persisting the inspection the snapshot is
  // refetched so the readiness banner / `needingAttention` list update
  // immediately — the user sees their action clear the gap without a
  // manual page reload.
  const handleInspectResource = async (
    resourceId: string,
    input: {
      inspectedAt: string;
      operational: boolean;
      nextExpirationAt?: string;
      notes?: string;
    },
  ) => {
    if (!projectId) return;
    await inspectResource(projectId, resourceId, input);
    refetch?.();
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="emergency-brigade-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ShieldAlert
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('brigade.page.title', 'Brigada de Emergencia')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'brigade.page.selectProject',
              'Selecciona un proyecto para gestionar la brigada y los recursos.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const readinessLevel = data?.readinessLevel ?? 'rose';
  const totalMembers = data?.brigade.totalMembers ?? 0;
  const operationalPercent =
    data?.resourceReadiness.operationalPercent ?? 0;
  const uncoveredCount = data?.brigade.uncoveredRoles.length ?? 0;
  const needAttentionCount = data?.resourceReadiness.needingAttention.length ?? 0;

  const bannerStyles: Record<'green' | 'amber' | 'rose', string> = {
    green:
      'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
    amber:
      'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
    rose: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300',
  };

  const bannerLabel: Record<'green' | 'amber' | 'rose', string> = {
    green: t(
      'brigade.banner.green',
      'Brigada lista — cobertura mínima y recursos al día',
    ),
    amber: t(
      'brigade.banner.amber',
      'Brigada con 1 brecha — revisar cobertura o recursos próximos a vencer',
    ),
    rose: t(
      'brigade.banner.rose',
      'Brigada con múltiples brechas — operación de respuesta comprometida',
    ),
  };

  const totalRecords = (data?.members.length ?? 0) + (data?.resources.length ?? 0);
  const isEmpty = !loading && !error && totalRecords === 0;

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="emergency-brigade-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
          <ShieldAlert className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('brigade.page.title', 'Brigada de Emergencia')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'brigade.page.subtitle',
              '§74-78 — Brigadistas + Recursos (extintores, AED, lavaojos, botiquines).',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="emergency-brigade-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="emergency-brigade-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="emergency-brigade-error"
          role="alert"
        >
          {t('brigade.page.error', 'No se pudo cargar la brigada: {{msg}}', {
            msg: error.message,
          })}
        </div>
      )}

      {!loading && !error && (
        <>
          <div
            className={`rounded-2xl border p-4 flex items-center gap-3 ${bannerStyles[readinessLevel]}`}
            data-testid={`emergency-brigade-banner-${readinessLevel}`}
            role="status"
          >
            {readinessLevel === 'green' ? (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">{bannerLabel[readinessLevel]}</p>
              <p className="text-[11px] opacity-80 mt-0.5">
                {t('brigade.banner.stats', {
                  defaultValue:
                    '{{members}} brigadistas activos · {{ops}}% recursos operativos · {{gaps}} roles sin cubrir · {{attention}} recursos requieren atención',
                  members: totalMembers,
                  ops: operationalPercent,
                  gaps: uncoveredCount,
                  attention: needAttentionCount,
                })}
              </p>
            </div>
          </div>

          {isEmpty && (
            <div
              className="rounded-2xl border border-dashed border-default-token bg-surface p-8 text-center"
              data-testid="emergency-brigade-empty-state"
            >
              <ShieldAlert
                className="w-10 h-10 mx-auto mb-3 text-amber-500"
                aria-hidden="true"
              />
              <h2 className="text-sm font-black text-primary-token uppercase tracking-tight">
                {t('brigade.empty.title', 'Aún no hay brigada configurada')}
              </h2>
              <p className="mt-1 text-xs text-secondary-token max-w-md mx-auto">
                {t(
                  'brigade.empty.subtitle',
                  'Designa los 3 roles mínimos (Líder, Primeros Auxilios e Incendios) y registra los recursos disponibles para activar la respuesta a emergencias.',
                )}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddMember(true)}
                  data-testid="emergency-brigade-empty-add-member"
                  className="px-3 py-2 text-xs font-bold uppercase tracking-widest rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                >
                  <Plus className="w-3 h-3 inline mr-1" />
                  {t('brigade.add.member', 'Agregar brigadista')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddResource(true)}
                  data-testid="emergency-brigade-empty-add-resource"
                  className="px-3 py-2 text-xs font-bold uppercase tracking-widest rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                >
                  <Plus className="w-3 h-3 inline mr-1" />
                  {t('brigade.add.resource', 'Agregar recurso')}
                </button>
              </div>
            </div>
          )}

          {!isEmpty && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section
                className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
                data-testid="emergency-brigade-members-section"
                aria-label={t('brigade.members.aria', 'Brigadistas') as string}
              >
                <header className="flex items-center gap-2">
                  <Users
                    className="w-4 h-4 text-amber-500"
                    aria-hidden="true"
                  />
                  <h2 className="text-sm font-black text-primary-token uppercase tracking-tight flex-1">
                    {t('brigade.members.title', 'Brigadistas')}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowAddMember(true)}
                    data-testid="emergency-brigade-add-member-btn"
                    className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300 hover:underline"
                  >
                    <Plus className="w-3 h-3 inline" />{' '}
                    {t('brigade.add.member', 'Agregar brigadista')}
                  </button>
                </header>
                <ul className="space-y-2">
                  {(Object.keys(membersByRole) as BrigadeRole[]).map((role) => {
                    const Icon = ROLE_ICON[role];
                    const color = ROLE_COLOR[role];
                    const list = membersByRole[role];
                    // Codex P2 round 2 #8 (PR #321, line 702): the
                    // "Brecha" chip used to fire on `list.length === 0`
                    // for every role, including optional ones
                    // (`evacuation_coordinator`, `communications`). For
                    // a brigade with the three minimum roles covered,
                    // the server returns `meetsMinimum: true` / empty
                    // `uncoveredRoles` and the banner is green — but
                    // the optional role cards still showed red "Brecha"
                    // chips, contradicting the banner. Drive the chip
                    // from the server's `uncoveredRoles` (which already
                    // honors the MINIMUM_REQUIRED contract from
                    // `emergencyBrigadeService`) so optional roles
                    // without coverage are simply labeled "Sin
                    // cobertura" without flagging a gap.
                    const isUncoveredRequired =
                      data?.brigade.uncoveredRoles.includes(role) ?? false;
                    return (
                      <li
                        key={role}
                        data-testid={`emergency-brigade-role-${role}`}
                        className="rounded-xl border border-default-token bg-surface-elevated p-3"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center bg-amber-500/10 ${color}`}
                          >
                            <Icon className="w-4 h-4" aria-hidden="true" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
                              {ROLE_LABEL[role]}
                            </p>
                            <p className="text-xs text-primary-token font-bold">
                              {list.length === 0
                                ? t('brigade.member.none', 'Sin cobertura')
                                : t('brigade.member.count', {
                                    defaultValue: '{{count}} miembro(s)',
                                    count: list.length,
                                  })}
                            </p>
                          </div>
                          {isUncoveredRequired && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300">
                              {t('brigade.member.gap', 'Brecha')}
                            </span>
                          )}
                        </div>
                        {list.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {list.map((m) => (
                              <li
                                key={m.id}
                                className="flex items-center gap-2 text-[11px] text-secondary-token"
                              >
                                <div className="w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 text-[9px] font-bold">
                                  {m.workerUid.slice(0, 2).toUpperCase()}
                                </div>
                                <span className="font-mono truncate">
                                  {m.workerUid}
                                </span>
                                <span className="ml-auto tabular-nums">
                                  {m.trainedAt.slice(0, 10)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section
                className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
                data-testid="emergency-brigade-resources-section"
                aria-label={t('brigade.resources.aria', 'Recursos') as string}
              >
                <header className="flex items-center gap-2">
                  <Wrench
                    className="w-4 h-4 text-amber-500"
                    aria-hidden="true"
                  />
                  <h2 className="text-sm font-black text-primary-token uppercase tracking-tight flex-1">
                    {t('brigade.resources.title', 'Recursos')}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowAddResource(true)}
                    data-testid="emergency-brigade-add-resource-btn"
                    className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300 hover:underline"
                  >
                    <Plus className="w-3 h-3 inline" />{' '}
                    {t('brigade.add.resource', 'Agregar recurso')}
                  </button>
                </header>
                {data?.resources.length === 0 ? (
                  <p
                    className="text-xs text-secondary-token text-center py-6"
                    data-testid="emergency-brigade-resources-empty"
                  >
                    {t('brigade.resources.empty', 'Sin recursos registrados')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {(data?.resources ?? []).map((r) => {
                      const Icon = RESOURCE_ICON[r.kind];
                      const days = daysUntil(r.nextExpirationAt);
                      const isCritical = !r.operational || days < 0;
                      const isWarning = days >= 0 && days <= 30;
                      // Codex P2 round 2 #10 (PR #321, line 48): expose
                      // the inspect CTA whenever the resource is in
                      // critical or warning state — that matches the
                      // server's `needingAttention` predicate
                      // (operational === false OR daysToExpiry <= 30).
                      const needsInspection = isCritical || isWarning;
                      return (
                        <li
                          key={r.id}
                          data-testid={`emergency-brigade-resource-${r.id}`}
                          className="rounded-xl border border-default-token bg-surface-elevated p-3"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-500/10 text-amber-500">
                              <Icon className="w-4 h-4" aria-hidden="true" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-primary-token">
                                {RESOURCE_LABEL[r.kind]}
                              </p>
                              <p className="text-[11px] text-secondary-token truncate">
                                {r.location}
                              </p>
                            </div>
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300"
                              aria-label="QR"
                            >
                              <QrCode className="w-3 h-3" aria-hidden="true" />
                              QR
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px]">
                            <span className="text-secondary-token">
                              {t('brigade.resource.lastInspected', 'Insp.')}: {' '}
                              {r.lastInspectedAt.slice(0, 10)}
                            </span>
                            <span
                              className={`tabular-nums font-bold ${
                                isCritical
                                  ? 'text-rose-700 dark:text-rose-300'
                                  : isWarning
                                    ? 'text-amber-700 dark:text-amber-300'
                                    : 'text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {isCritical
                                ? days < 0
                                  ? t('brigade.resource.expired', 'Vencido')
                                  : t('brigade.resource.outOfService', 'Fuera servicio')
                                : t('brigade.resource.daysLeft', {
                                    defaultValue: '{{n}} días',
                                    n: days,
                                  })}
                            </span>
                          </div>
                          {needsInspection && (
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                onClick={() => setInspectingResource(r)}
                                data-testid={`emergency-brigade-resource-inspect-${r.id}`}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 hover:bg-sky-500/25"
                              >
                                <Wrench className="w-3 h-3" aria-hidden="true" />
                                {t(
                                  'brigade.resource.inspect',
                                  'Inspeccionar',
                                )}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </>
      )}

      {showAddMember && (
        <AddMemberModal
          onClose={() => setShowAddMember(false)}
          onSubmit={handleAddMember}
        />
      )}
      {showAddResource && (
        <AddResourceModal
          onClose={() => setShowAddResource(false)}
          onSubmit={handleAddResource}
        />
      )}
      {inspectingResource && (
        <InspectResourceModal
          resource={inspectingResource}
          onClose={() => setInspectingResource(null)}
          onSubmit={(input) =>
            handleInspectResource(inspectingResource.id, input)
          }
        />
      )}
    </div>
  );
}

export default EmergencyBrigade;

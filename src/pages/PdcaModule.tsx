// Praeventio Guard — Sprint K §195-200 page wrapper.
//
// Módulo PDCA + No Conformidades (ISO 45001 §10.2).
//
// El motor (`services/pdca/pdcaCycleEngine.ts` + `pdcaCycle.ts`) y los
// endpoints HTTP ya existían en sus PRs respectivos; lo que faltaba era
// la pieza navegable: una página que renderice los ciclos PDCA activos
// como kanban (Plan / Do / Check / Act), permita crearlos contra una NC
// existente o creada inline, y muestre métricas de cierre.
//
// Mapeo a doc §195-200:
//   §195: relación NC → acción correctiva (cada ciclo apunta a una NC).
//   §196: verificación de eficacia (efficacyScore en fase Act).
//   §197: registros de cumplimiento (stages.evidence[]).
//   §198: revisión periódica (closureRate visible en el header).
//   §199: rankings de NC por zona/tarea (origen visible por chip).
//   §200: mejora continua (cycleNumber crece tras cada cierre Act→Plan).
//
// Directiva 3: la página NUNCA pushea a SUSESO/SII/MINSAL/OSHA. Sólo
// persiste el ciclo + la NC para que la empresa firme + entregue por
// su cuenta. Las recomendaciones de fuentes externas se citan discreto
// en el modal de detalle, sin transferir panic-mode al usuario.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, WifiOff, Plus, X, ArrowRight, AlertCircle } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { PdcaSummaryCard } from '../components/pdca/PdcaSummaryCard';
import {
  usePdcaCycles,
  usePdcaSummary,
  usePdcaNonConformities,
  createPdcaCycle,
  advancePdcaPhase,
  createPdcaNonConformity,
  type PdcaCycleRecord,
  type PdcaNonConformityRecord,
  type PdcaStage,
  type PdcaOrigin,
} from '../hooks/usePdca';
import { logger } from '../utils/logger';

const STAGE_ORDER: PdcaStage[] = ['plan', 'do', 'check', 'act'];

const STAGE_LABEL: Record<PdcaStage, string> = {
  plan: 'Plan',
  do: 'Do',
  check: 'Check',
  act: 'Act',
};

const STAGE_LONG: Record<PdcaStage, string> = {
  plan: 'Planificar',
  do: 'Ejecutar',
  check: 'Verificar',
  act: 'Estandarizar',
};

const STAGE_COLOR: Record<PdcaStage, { ring: string; text: string; bg: string }> = {
  plan: { ring: 'border-teal-500/30', text: 'text-teal-500', bg: 'bg-teal-500/10' },
  do: { ring: 'border-blue-500/30', text: 'text-blue-500', bg: 'bg-blue-500/10' },
  check: { ring: 'border-amber-500/30', text: 'text-amber-500', bg: 'bg-amber-500/10' },
  act: { ring: 'border-violet-500/30', text: 'text-violet-500', bg: 'bg-violet-500/10' },
};

const ORIGIN_LABEL: Record<PdcaOrigin, string> = {
  audit: 'Auditoría',
  incident: 'Incidente',
  finding: 'Hallazgo',
  inspection: 'Inspección',
};

function generateId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}_${r}`;
}

interface DetailModalProps {
  cycle: PdcaCycleRecord;
  nonConformity: PdcaNonConformityRecord | null;
  onClose: () => void;
  onAdvanced: () => void;
  projectId: string;
}

function CycleDetailModal({
  cycle,
  nonConformity,
  onClose,
  onAdvanced,
  projectId,
}: DetailModalProps) {
  const { t } = useTranslation();
  const [evidence, setEvidence] = useState('');
  const [notes, setNotes] = useState('');
  const [efficacy, setEfficacy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdvance = async () => {
    setError(null);
    const evidenceUris = evidence
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (evidenceUris.length === 0) {
      setError(
        t(
          'pdca.modal.evidenceRequired',
          'Se requiere al menos una URI de evidencia para avanzar de fase.',
        ),
      );
      return;
    }
    const payload: {
      evidence: string[];
      notes?: string;
      efficacyScore?: number;
    } = { evidence: evidenceUris };
    if (notes.trim().length > 0) payload.notes = notes.trim();
    if (cycle.currentStage === 'act' && efficacy.trim().length > 0) {
      const parsed = Number(efficacy);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
        payload.efficacyScore = parsed;
      }
    }
    setSubmitting(true);
    try {
      await advancePdcaPhase(projectId, cycle.id, payload);
      logger.info('pdca.advanced', { cycleId: cycle.id, from: cycle.currentStage });
      onAdvanced();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const stageHistory = cycle.stages ?? [];
  const color = STAGE_COLOR[cycle.currentStage];

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4"
      data-testid="pdca-detail-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface border border-default-token rounded-2xl shadow-mode-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-default-token">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl ${color.bg} ${color.text} flex items-center justify-center border ${color.ring}`}
            >
              <Activity className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-black text-primary-token uppercase tracking-tight">
                {t('pdca.modal.title', 'Ciclo PDCA')} #{cycle.cycleNumber} —{' '}
                {STAGE_LABEL[cycle.currentStage]}
              </h2>
              <p className="text-xs text-secondary-token">
                {nonConformity
                  ? `NC: ${nonConformity.description.slice(0, 80)}${nonConformity.description.length > 80 ? '…' : ''}`
                  : cycle.nonConformityId
                    ? `NC: ${cycle.nonConformityId}`
                    : t('pdca.modal.noNc', 'Sin NC vinculada')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Cerrar') as string}
            className="w-8 h-8 rounded-lg hover:bg-canvas text-secondary-token"
          >
            <X className="w-4 h-4 mx-auto" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {stageHistory.length > 0 && (
            <div data-testid="pdca-stage-history">
              <h3 className="text-xs font-bold uppercase tracking-widest text-secondary-token mb-2">
                {t('pdca.modal.history', 'Historial de fases')}
              </h3>
              <ol className="space-y-2">
                {stageHistory.map((s, idx) => (
                  <li
                    key={`${s.activityId}-${idx}`}
                    className="text-xs text-primary-token border-l-2 border-default-token pl-3 py-1"
                  >
                    <span className="font-bold">{STAGE_LABEL[s.kind]}</span>{' '}
                    — {s.startedAt.slice(0, 10)}
                    {s.completedAt && ` → ${s.completedAt.slice(0, 10)}`}
                    {typeof s.efficacyScore === 'number' &&
                      ` • eficacia ${s.efficacyScore}%`}
                    {s.evidence && s.evidence.length > 0 && (
                      <span className="text-secondary-token">
                        {' '}
                        • {s.evidence.length} evidencia(s)
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-default-token bg-canvas p-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-secondary-token">
              {t('pdca.modal.advance', 'Avanzar a la siguiente fase')}
            </h3>
            <label className="block text-xs font-medium text-secondary-token">
              {t('pdca.modal.evidence', 'Evidencia (URIs, una por línea)')}
              <textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
                placeholder="storage://.../foto1.jpg"
                data-testid="pdca-evidence-input"
              />
            </label>
            <label className="block text-xs font-medium text-secondary-token">
              {t('pdca.modal.notes', 'Notas (opcional)')}
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
              />
            </label>
            {cycle.currentStage === 'act' && (
              <label className="block text-xs font-medium text-secondary-token">
                {t('pdca.modal.efficacy', 'Score de eficacia (0-100)')}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={efficacy}
                  onChange={(e) => setEfficacy(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
                />
              </label>
            )}
            {error && (
              <div
                className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-xs text-rose-600 dark:text-rose-400"
                role="alert"
                data-testid="pdca-advance-error"
              >
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={handleAdvance}
              disabled={submitting}
              data-testid="pdca-advance-button"
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-500/10 text-teal-500 border border-teal-500/30 text-xs font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-teal-500/20"
            >
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
              {submitting
                ? t('common.saving', 'Guardando…')
                : t('pdca.modal.advanceCta', 'Avanzar fase')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface NewCycleModalProps {
  nonConformities: PdcaNonConformityRecord[];
  onClose: () => void;
  onCreated: () => void;
  projectId: string;
  ownerUid: string;
}

function NewCycleModal({
  nonConformities,
  onClose,
  onCreated,
  projectId,
  ownerUid,
}: NewCycleModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'link' | 'inline'>(
    nonConformities.length > 0 ? 'link' : 'inline',
  );
  const [linkedNcId, setLinkedNcId] = useState(
    nonConformities[0]?.id ?? '',
  );
  const [origin, setOrigin] = useState<PdcaOrigin>('audit');
  const [notes, setNotes] = useState('');
  // Inline NC fields
  const [ncDescription, setNcDescription] = useState('');
  const [ncCategory, setNcCategory] = useState('General');
  const [ncSeverity, setNcSeverity] = useState<'minor' | 'major' | 'critical'>(
    'minor',
  );
  const [ncLocation, setNcLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      let ncId = linkedNcId;
      if (mode === 'inline') {
        if (ncDescription.trim().length < 3 || ncLocation.trim().length < 1) {
          throw new Error('NC requiere descripción y ubicación.');
        }
        const inlineId = generateId('nc');
        await createPdcaNonConformity(projectId, {
          id: inlineId,
          category: ncCategory,
          severity: ncSeverity,
          description: ncDescription.trim(),
          location: ncLocation.trim(),
          responsibleUid: ownerUid,
        });
        ncId = inlineId;
      }
      if (!ncId) throw new Error('Falta vincular o crear una NC.');
      await createPdcaCycle(projectId, {
        id: generateId('pdca'),
        nonConformityId: ncId,
        origin,
        ownerUid,
        notes: notes.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4"
      data-testid="pdca-new-cycle-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface border border-default-token rounded-2xl shadow-mode-lg w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-default-token">
          <h2 className="text-base font-black text-primary-token uppercase tracking-tight">
            {t('pdca.new.title', 'Nuevo ciclo PDCA')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Cerrar') as string}
            className="w-8 h-8 rounded-lg hover:bg-canvas text-secondary-token"
          >
            <X className="w-4 h-4 mx-auto" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('link')}
              disabled={nonConformities.length === 0}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest disabled:opacity-40 ${
                mode === 'link'
                  ? 'bg-teal-500/10 text-teal-500 border border-teal-500/30'
                  : 'bg-canvas text-secondary-token border border-default-token'
              }`}
            >
              {t('pdca.new.link', 'Vincular NC')}
            </button>
            <button
              type="button"
              onClick={() => setMode('inline')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest ${
                mode === 'inline'
                  ? 'bg-teal-500/10 text-teal-500 border border-teal-500/30'
                  : 'bg-canvas text-secondary-token border border-default-token'
              }`}
            >
              {t('pdca.new.inline', 'Crear NC inline')}
            </button>
          </div>

          {mode === 'link' && (
            <label className="block text-xs font-medium text-secondary-token">
              {t('pdca.new.selectNc', 'Selecciona la NC')}
              <select
                value={linkedNcId}
                onChange={(e) => setLinkedNcId(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
                data-testid="pdca-link-nc-select"
              >
                <option value="">—</option>
                {nonConformities.map((nc) => (
                  <option key={nc.id} value={nc.id}>
                    [{nc.severity}] {nc.description.slice(0, 70)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {mode === 'inline' && (
            <div className="space-y-2 rounded-xl border border-default-token p-3">
              <label className="block text-xs font-medium text-secondary-token">
                {t('pdca.new.ncDescription', 'Descripción de la NC')}
                <textarea
                  value={ncDescription}
                  onChange={(e) => setNcDescription(e.target.value)}
                  rows={2}
                  className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-secondary-token">
                  {t('pdca.new.ncCategory', 'Categoría')}
                  <input
                    value={ncCategory}
                    onChange={(e) => setNcCategory(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
                  />
                </label>
                <label className="block text-xs font-medium text-secondary-token">
                  {t('pdca.new.ncSeverity', 'Severidad')}
                  <select
                    value={ncSeverity}
                    onChange={(e) =>
                      setNcSeverity(
                        e.target.value as 'minor' | 'major' | 'critical',
                      )
                    }
                    className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
                  >
                    <option value="minor">Menor</option>
                    <option value="major">Mayor</option>
                    <option value="critical">Crítica</option>
                  </select>
                </label>
              </div>
              <label className="block text-xs font-medium text-secondary-token">
                {t('pdca.new.ncLocation', 'Ubicación')}
                <input
                  value={ncLocation}
                  onChange={(e) => setNcLocation(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
                />
              </label>
            </div>
          )}

          <label className="block text-xs font-medium text-secondary-token">
            {t('pdca.new.origin', 'Origen del ciclo')}
            <select
              value={origin}
              onChange={(e) => setOrigin(e.target.value as PdcaOrigin)}
              className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
            >
              <option value="audit">Auditoría</option>
              <option value="incident">Incidente</option>
              <option value="finding">Hallazgo</option>
              <option value="inspection">Inspección</option>
            </select>
          </label>

          <label className="block text-xs font-medium text-secondary-token">
            {t('pdca.new.notes', 'Notas iniciales (opcional)')}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token"
            />
          </label>

          {error && (
            <div
              className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-xs text-rose-600 dark:text-rose-400"
              role="alert"
              data-testid="pdca-new-error"
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="pdca-new-submit"
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-500/10 text-teal-500 border border-teal-500/30 text-xs font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-teal-500/20"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {submitting
              ? t('common.saving', 'Guardando…')
              : t('pdca.new.create', 'Crear ciclo')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PdcaModule() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const cyclesResp = usePdcaCycles(projectId);
  const summaryResp = usePdcaSummary(projectId);
  const ncResp = usePdcaNonConformities(projectId);

  const [selectedCycle, setSelectedCycle] = useState<PdcaCycleRecord | null>(
    null,
  );
  const [showNewCycle, setShowNewCycle] = useState(false);

  const cycles = useMemo(
    () => cyclesResp.data?.cycles ?? [],
    [cyclesResp.data],
  );
  const ncs = useMemo(
    () => ncResp.data?.nonConformities ?? [],
    [ncResp.data],
  );

  const ncById = useMemo(() => {
    const m = new Map<string, PdcaNonConformityRecord>();
    for (const nc of ncs) m.set(nc.id, nc);
    return m;
  }, [ncs]);

  const groupedByStage = useMemo(() => {
    const m: Record<PdcaStage, PdcaCycleRecord[]> = {
      plan: [],
      do: [],
      check: [],
      act: [],
    };
    for (const c of cycles) {
      const stage: PdcaStage = (c.currentStage ?? 'plan') as PdcaStage;
      m[stage].push(c);
    }
    return m;
  }, [cycles]);

  const summary = summaryResp.data?.summary ?? {
    total: 0,
    byPhase: { plan: 0, do: 0, check: 0, act: 0 },
    closedCycles: 0,
    closureRate: 0,
  };

  const loading = cyclesResp.loading || summaryResp.loading;
  const error = cyclesResp.error || summaryResp.error;

  const handleRefresh = () => {
    cyclesResp.refetch?.();
    summaryResp.refetch?.();
    ncResp.refetch?.();
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-6xl mx-auto"
        data-testid="pdca-module-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Activity
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('pdca.page.title', 'PDCA + No Conformidades')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'pdca.page.selectProject',
              'Selecciona un proyecto para ver los ciclos PDCA activos.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-6xl mx-auto space-y-4"
      data-testid="pdca-module-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <Activity className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('pdca.page.title', 'PDCA + No Conformidades')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'pdca.page.subtitle',
              'Ciclo PDCA — ISO 45001 §10.2 §195-200. {{count}} ciclos activos.',
              { count: cycles.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="pdca-module-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {/* PDCA Summary Card — NC distribution by phase */}
      {ncs.length > 0 && <PdcaSummaryCard items={ncs} />}

      {/* Summary cards — one per phase + closure rate */}
      <div
        className="grid grid-cols-2 md:grid-cols-5 gap-3"
        data-testid="pdca-summary-cards"
      >
        {STAGE_ORDER.map((stage) => {
          const color = STAGE_COLOR[stage];
          return (
            <div
              key={stage}
              className={`rounded-xl border ${color.ring} ${color.bg} p-3`}
              data-testid={`pdca-summary-${stage}`}
            >
              <div
                className={`text-[10px] font-bold uppercase tracking-widest ${color.text}`}
              >
                {STAGE_LABEL[stage]}
              </div>
              <div className="text-2xl font-black text-primary-token mt-1">
                {summary.byPhase[stage] ?? 0}
              </div>
              <div className="text-[10px] text-secondary-token mt-1">
                {STAGE_LONG[stage]}
              </div>
            </div>
          );
        })}
        <div
          className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-3"
          data-testid="pdca-summary-closure"
        >
          <div className="text-[10px] font-bold uppercase tracking-widest text-teal-500">
            {t('pdca.summary.closureRate', 'Cierre')}
          </div>
          <div className="text-2xl font-black text-primary-token mt-1">
            {summary.closureRate}%
          </div>
          <div className="text-[10px] text-secondary-token mt-1">
            {summary.closedCycles} / {summary.total} cerrados
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowNewCycle(true)}
          data-testid="pdca-new-cycle-button"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-500/10 text-teal-500 border border-teal-500/30 text-xs font-bold uppercase tracking-widest hover:bg-teal-500/20"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('pdca.page.newCycle', 'Nuevo ciclo')}
        </button>
      </div>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="pdca-module-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2"
          data-testid="pdca-module-error"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t('pdca.page.error', 'No se pudieron cargar los ciclos: {{msg}}', {
              msg: error.message,
            })}
          </span>
        </div>
      )}

      {!loading && !error && (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3"
          data-testid="pdca-kanban-board"
        >
          {STAGE_ORDER.map((stage) => {
            const color = STAGE_COLOR[stage];
            const stageCycles = groupedByStage[stage];
            return (
              <div
                key={stage}
                className="rounded-xl border border-default-token bg-canvas p-3 min-h-[140px]"
                data-testid={`pdca-kanban-column-${stage}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-widest ${color.text}`}
                  >
                    {STAGE_LABEL[stage]} — {STAGE_LONG[stage]}
                  </span>
                  <span className="text-[10px] text-secondary-token">
                    {stageCycles.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {stageCycles.length === 0 ? (
                    <div className="text-[11px] text-secondary-token italic">
                      {t('pdca.kanban.empty', 'Sin ciclos en esta fase')}
                    </div>
                  ) : (
                    stageCycles.map((c) => {
                      const nc = c.nonConformityId
                        ? (ncById.get(c.nonConformityId) ?? null)
                        : null;
                      const originLabel = c.origin
                        ? ORIGIN_LABEL[c.origin]
                        : null;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCycle(c)}
                          data-testid={`pdca-card-${c.id}`}
                          className={`w-full text-left rounded-lg border ${color.ring} ${color.bg} p-2 hover:shadow-mode transition-shadow`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-widest ${color.text}`}
                            >
                              #{c.cycleNumber}
                            </span>
                            {originLabel && (
                              <span className="text-[9px] text-secondary-token">
                                {originLabel}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-primary-token mt-1 line-clamp-2">
                            {nc
                              ? nc.description
                              : c.nonConformityId ?? c.id}
                          </div>
                          {nc && (
                            <div className="text-[10px] text-secondary-token mt-1">
                              {nc.location}
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedCycle && (
        <CycleDetailModal
          cycle={selectedCycle}
          nonConformity={
            selectedCycle.nonConformityId
              ? (ncById.get(selectedCycle.nonConformityId) ?? null)
              : null
          }
          onClose={() => setSelectedCycle(null)}
          onAdvanced={handleRefresh}
          projectId={selectedProject.id}
        />
      )}

      {showNewCycle && (
        <NewCycleModal
          nonConformities={ncs}
          onClose={() => setShowNewCycle(false)}
          onCreated={handleRefresh}
          projectId={selectedProject.id}
          ownerUid="unassigned"
        />
      )}
    </div>
  );
}

export default PdcaModule;

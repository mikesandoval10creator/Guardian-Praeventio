// Praeventio Guard — Sprint K §296-301 page wrapper.
//
// Riesgo Residual + Aceptación Formal + Detector de Criticidad Sospechosa.
//
// Este page wrapper:
//   1. Lista los riesgos residuales registrados para el proyecto via
//      `useResidualRisks(projectId)`.
//   2. Resalta los riesgos marcados como "criticidad sospechosa" via
//      `useSuspiciousRisks(projectId)` — combinaciones residualSeverity
//      baja vs inherentSeverity muy alta sin controles robustos.
//   3. Permite registrar un nuevo riesgo residual (form determinístico).
//   4. Permite a gerencia (admin/gerente) aceptar formalmente un riesgo
//      pendiente. El gate de rol vive en el server — el botón siempre
//      se muestra, el server rechaza con 403 si el rol no califica.
//
// ALINEACIÓN CON DIRECTIVAS:
//   - Nunca empuja a SUSESO/MINSAL: el documento de aceptación queda
//     como comprobante interno (igual que QrSignature).
//   - Nunca bloquea operación: este es un instrumento de gobierno
//     (ISO 31000 risk-flow), no un gate operacional.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, WifiOff, Plus, X } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useResidualRisks,
  useSuspiciousRisks,
  registerResidualRisk,
  acceptResidualRisk,
  type StoredResidualRisk,
  type ResidualRiskPayload,
} from '../hooks/useResidualRisk';
import type {
  RiskLikelihood,
  RiskSeverity,
  ControlEffectivenessLevel,
} from '../services/residualRisk/residualRiskEngine';
import { ResidualRiskCard } from '../components/residualRisk/ResidualRiskCard';
import { logger } from '../utils/logger';

interface RegisterFormProps {
  onSubmit: (payload: ResidualRiskPayload) => Promise<void>;
  onClose: () => void;
}

function RegisterForm({ onSubmit, onClose }: RegisterFormProps) {
  const { t } = useTranslation();
  const [hazard, setHazard] = useState('');
  const [category, setCategory] = useState('');
  const [riskKind, setRiskKind] = useState<'physical' | 'administrative'>(
    'physical',
  );
  const [likelihood, setLikelihood] = useState<RiskLikelihood>('possible');
  const [inherentSeverity, setInherentSeverity] =
    useState<RiskSeverity>('major');
  const [residualSeverity, setResidualSeverity] =
    useState<RiskSeverity>('moderate');
  const [controlId, setControlId] = useState('');
  const [effectiveness, setEffectiveness] =
    useState<ControlEffectivenessLevel>('partial');
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hazard || !category || !justification) return;
    setSubmitting(true);
    try {
      await onSubmit({
        id: `rr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        hazard,
        category,
        riskKind,
        likelihood,
        inherentSeverity,
        residualSeverity,
        currentControls: controlId
          ? [{ controlId, effectiveness }]
          : [],
        justification,
      });
      onClose();
    } catch (err) {
      logger.error('residualRisk.register.failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
      data-testid="residual-risk-form"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-black text-primary-token uppercase tracking-tight">
          {t('residualRisk.registerForm.title', 'Registrar riesgo residual')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1 rounded hover:bg-white/10"
          aria-label={t('common.close', 'Cerrar') as string}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-bold">{t('residualRisk.form.hazard', 'Peligro')}</span>
          <input
            type="text"
            value={hazard}
            onChange={(e) => setHazard(e.target.value)}
            className="px-2 py-1.5 rounded bg-canvas border border-default-token text-xs"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-bold">{t('residualRisk.form.category', 'Categoría')}</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-2 py-1.5 rounded bg-canvas border border-default-token text-xs"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-bold">{t('residualRisk.form.riskKind', 'Tipo')}</span>
          <select
            value={riskKind}
            onChange={(e) =>
              setRiskKind(e.target.value as 'physical' | 'administrative')
            }
            className="px-2 py-1.5 rounded bg-canvas border border-default-token text-xs"
          >
            <option value="physical">{t('residualRisk.form.kind.physical', 'Físico')}</option>
            <option value="administrative">
              {t('residualRisk.form.kind.administrative', 'Administrativo')}
            </option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-bold">{t('residualRisk.form.likelihood', 'Probabilidad')}</span>
          <select
            value={likelihood}
            onChange={(e) => setLikelihood(e.target.value as RiskLikelihood)}
            className="px-2 py-1.5 rounded bg-canvas border border-default-token text-xs"
          >
            <option value="rare">rare</option>
            <option value="unlikely">unlikely</option>
            <option value="possible">possible</option>
            <option value="likely">likely</option>
            <option value="almost_certain">almost_certain</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-bold">
            {t('residualRisk.form.inherentSeverity', 'Severidad inherente')}
          </span>
          <select
            value={inherentSeverity}
            onChange={(e) =>
              setInherentSeverity(e.target.value as RiskSeverity)
            }
            className="px-2 py-1.5 rounded bg-canvas border border-default-token text-xs"
          >
            <option value="negligible">negligible</option>
            <option value="minor">minor</option>
            <option value="moderate">moderate</option>
            <option value="major">major</option>
            <option value="catastrophic">catastrophic</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-bold">
            {t('residualRisk.form.residualSeverity', 'Severidad residual')}
          </span>
          <select
            value={residualSeverity}
            onChange={(e) =>
              setResidualSeverity(e.target.value as RiskSeverity)
            }
            className="px-2 py-1.5 rounded bg-canvas border border-default-token text-xs"
          >
            <option value="negligible">negligible</option>
            <option value="minor">minor</option>
            <option value="moderate">moderate</option>
            <option value="major">major</option>
            <option value="catastrophic">catastrophic</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-bold">{t('residualRisk.form.controlId', 'Control aplicado (id)')}</span>
          <input
            type="text"
            value={controlId}
            onChange={(e) => setControlId(e.target.value)}
            className="px-2 py-1.5 rounded bg-canvas border border-default-token text-xs"
            placeholder="ctrl-001 (opcional)"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-bold">{t('residualRisk.form.effectiveness', 'Efectividad')}</span>
          <select
            value={effectiveness}
            onChange={(e) =>
              setEffectiveness(e.target.value as ControlEffectivenessLevel)
            }
            className="px-2 py-1.5 rounded bg-canvas border border-default-token text-xs"
          >
            <option value="minimal">minimal</option>
            <option value="partial">partial</option>
            <option value="significant">significant</option>
            <option value="full">full</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[11px]">
        <span className="font-bold">
          {t('residualRisk.form.justification', 'Justificación')}
        </span>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={3}
          className="px-2 py-1.5 rounded bg-canvas border border-default-token text-xs"
          required
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="w-full px-3 py-2 rounded bg-rose-500 text-white text-xs font-bold hover:bg-rose-600 disabled:opacity-50"
        data-testid="residual-risk-form-submit"
      >
        {submitting
          ? t('common.saving', 'Guardando…')
          : t('residualRisk.form.submit', 'Registrar')}
      </button>
    </form>
  );
}

export function ResidualRisk() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;
  const [showForm, setShowForm] = useState(false);

  const risksResp = useResidualRisks(projectId);
  const suspiciousResp = useSuspiciousRisks(projectId);

  const handleRegister = async (payload: ResidualRiskPayload) => {
    if (!projectId) return;
    try {
      await registerResidualRisk(projectId, payload);
      logger.info('residualRisk.register.success', { id: payload.id });
      risksResp.refetch?.();
      suspiciousResp.refetch?.();
    } catch (err) {
      logger.error('residualRisk.register.failed', err);
      throw err;
    }
  };

  const handleAccept = async (risk: StoredResidualRisk) => {
    if (!projectId) return;
    const reason = window.prompt(
      t(
        'residualRisk.acceptPrompt',
        'Razón de aceptación formal (queda como comprobante interno):',
      ) as string,
    );
    if (!reason) return;
    try {
      await acceptResidualRisk(projectId, risk.id, reason);
      logger.info('residualRisk.accept.success', { id: risk.id });
      risksResp.refetch?.();
    } catch (err) {
      logger.error('residualRisk.accept.failed', err);
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="residual-risk-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <AlertOctagon
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('residualRisk.page.title', 'Riesgo Residual')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'residualRisk.page.selectProject',
              'Selecciona un proyecto para ver los riesgos residuales y aceptaciones formales pendientes.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const loading = risksResp.loading || suspiciousResp.loading;
  const error = risksResp.error || suspiciousResp.error;
  const risks = risksResp.data?.risks ?? [];
  const suspicious = suspiciousResp.data?.risks ?? [];

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="residual-risk-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
          <AlertOctagon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('residualRisk.page.title', 'Riesgo Residual')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'residualRisk.page.subtitle',
              'ISO 31000 / ISO 45001 §6.1.2.2 — {{count}} riesgos cargados.',
              { count: risks.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="residual-risk-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <button
        type="button"
        onClick={() => setShowForm((s) => !s)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 text-teal-700 dark:text-teal-300 text-xs font-bold border border-teal-500/20"
        data-testid="residual-risk-register-toggle"
      >
        <Plus className="w-3 h-3" aria-hidden="true" />
        {showForm
          ? t('residualRisk.form.cancel', 'Cancelar')
          : t('residualRisk.form.register', 'Registrar riesgo')}
      </button>

      {showForm && (
        <RegisterForm
          onSubmit={handleRegister}
          onClose={() => setShowForm(false)}
        />
      )}

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="residual-risk-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="residual-risk-error"
          role="alert"
        >
          {t(
            'residualRisk.page.error',
            'No se pudieron cargar los riesgos residuales: {{msg}}',
            { msg: error.message },
          )}
        </div>
      )}

      {/* Suspicious section — highlighted only if any flagged. */}
      {!loading && !error && suspicious.length > 0 && (
        <section
          className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-3"
          data-testid="residual-risk-suspicious-banner"
        >
          <header className="flex items-center gap-2">
            <AlertOctagon
              className="w-4 h-4 text-rose-500"
              aria-hidden="true"
            />
            <h2 className="text-sm font-black uppercase tracking-tight text-rose-700 dark:text-rose-300">
              {t(
                'residualRisk.suspicious.title',
                'Criticidad Sospechosa',
              )}{' '}
              <span className="text-rose-500 tabular-nums">
                ({suspicious.length})
              </span>
            </h2>
          </header>
          <p className="text-[11px] text-secondary-token">
            {t(
              'residualRisk.suspicious.criteria',
              'La severidad residual baja es sospechosa cuando la inherente es muy alta (catastrophic/major) y la caída no se justifica con controles robustos. Revisar caso por caso — esto NO bloquea operación, sólo señala para revisión humana.',
            )}
          </p>
          <div className="space-y-3">
            {suspicious.map((r) => (
              <div key={r.id} className="space-y-1">
                <ResidualRiskCard
                  assessment={{
                    riskId: r.id,
                    category: r.category,
                    likelihood: r.likelihood,
                    severity: r.inherentSeverity,
                    riskKind: r.riskKind,
                  }}
                  controls={r.currentControls}
                  stored={r}
                  onRequestAcceptance={() => handleAccept(r)}
                />
                {r.suspiciousReason && (
                  <p
                    className="text-[10px] text-rose-600 dark:text-rose-400 italic px-2"
                    data-testid={`residual-suspicious-reason-${r.id}`}
                  >
                    {r.suspiciousReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Main list. */}
      {!loading && !error && (
        <section
          className="space-y-3"
          data-testid="residual-risk-list"
          aria-label={t('residualRisk.list.aria', 'Lista de riesgos residuales') as string}
        >
          <h2 className="text-xs font-black uppercase tracking-widest text-secondary-token">
            {t('residualRisk.list.title', 'Riesgos Residuales')}
          </h2>
          {risks.length === 0 ? (
            <div
              className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
              data-testid="residual-risk-empty"
            >
              {t(
                'residualRisk.list.empty',
                'No hay riesgos residuales registrados todavía.',
              )}
            </div>
          ) : (
            risks.map((r) => (
              <ResidualRiskCard
                key={r.id}
                assessment={{
                  riskId: r.id,
                  category: r.category,
                  likelihood: r.likelihood,
                  severity: r.inherentSeverity,
                  riskKind: r.riskKind,
                }}
                controls={r.currentControls}
                stored={r}
                onRequestAcceptance={() => handleAccept(r)}
              />
            ))
          )}
        </section>
      )}
    </div>
  );
}

export default ResidualRisk;

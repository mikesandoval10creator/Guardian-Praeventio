// Praeventio Guard — Sprint K §90-91 page wrapper.
//
// Centro de Calidad de Proveedores + Ranking de Riesgo de Contratistas.
// Esta página cierra el flujo §90-91 que ya tenía service determinístico
// (`supplierQualityService.ts`) + scoring 4-dim (`supplierScoring.ts`)
// + endpoint + hook, pero no estaba accesible desde la navegación: el
// motor podía rankear pero ningún humano podía consultarlo.
//
// Patrón: render-only (no recalcula score; lo trae el server desde el
// motor canónico). Determinístico salvo el botón "Nuevo proveedor" que
// usa Date.now() para `registeredAt` en el server-side.
//
// 4 directiva-3: NO empujamos data a SUSESO/SII/MINSAL/OSHA. El score
// es interno; la empresa decide qué hacer con el ranking.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, WifiOff, TrendingUp, TrendingDown, Minus, Plus, X } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useSuppliers,
  useSupplierRanking,
  registerSupplier,
  type SupplierRiskFilter,
  type SupplierRiskLevel,
  type SupplierView,
  type SupplierTrend,
} from '../hooks/useSuppliers';
import { SupplierComparator } from '../components/suppliers/SupplierComparator';
import { logger } from '../utils/logger';

const RISK_FILTERS: ReadonlyArray<SupplierRiskFilter> = ['all', 'low', 'medium', 'high'];

function riskClasses(level: SupplierRiskLevel): { bg: string; text: string; border: string } {
  switch (level) {
    case 'low':
      return {
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-600 dark:text-emerald-400',
        border: 'border-emerald-500/30',
      };
    case 'medium':
      return {
        bg: 'bg-amber-500/10',
        text: 'text-amber-600 dark:text-amber-400',
        border: 'border-amber-500/30',
      };
    case 'high':
      return {
        bg: 'bg-rose-500/10',
        text: 'text-rose-600 dark:text-rose-400',
        border: 'border-rose-500/30',
      };
  }
}

function trendIcon(t: SupplierTrend) {
  if (t === 'improving') return <TrendingDown className="w-3 h-3" aria-hidden="true" />;
  if (t === 'worsening') return <TrendingUp className="w-3 h-3" aria-hidden="true" />;
  return <Minus className="w-3 h-3" aria-hidden="true" />;
}

function trendLabel(t: SupplierTrend, tr: (k: string, fallback: string) => string): string {
  if (t === 'improving') return tr('suppliers.trend.improving', 'Mejorando');
  if (t === 'worsening') return tr('suppliers.trend.worsening', 'Empeorando');
  return tr('suppliers.trend.stable', 'Estable');
}

function riskLabel(level: SupplierRiskLevel, tr: (k: string, fallback: string) => string): string {
  if (level === 'low') return tr('suppliers.risk.low', 'Bajo');
  if (level === 'medium') return tr('suppliers.risk.medium', 'Medio');
  return tr('suppliers.risk.high', 'Alto');
}

function filterLabel(f: SupplierRiskFilter, tr: (k: string, fallback: string) => string): string {
  if (f === 'all') return tr('suppliers.filter.all', 'Todos');
  return riskLabel(f, tr);
}

interface RegisterFormState {
  name: string;
  taxId: string;
  servicesText: string;
}

const EMPTY_FORM: RegisterFormState = { name: '', taxId: '', servicesText: '' };

export function SupplierQuality() {
  const { t } = useTranslation();
  const tr = (k: string, fallback: string) => t(k, fallback) as string;
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [filter, setFilter] = useState<SupplierRiskFilter>('all');
  const { data, loading, error, refetch } = useSuppliers(projectId, { riskLevel: filter });
  // Ranking comparativo (datos REALES desde GET /suppliers/ranking — el
  // server scorea con `supplierScoring` 4-dim leyendo Firestore).
  const {
    data: rankingData,
    loading: rankingLoading,
    error: rankingError,
  } = useSupplierRanking(projectId);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RegisterFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SupplierView | null>(null);

  const suppliers: SupplierView[] = useMemo(
    () => data?.suppliers ?? [],
    [data],
  );

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    const services = form.servicesText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (services.length === 0) {
      setSubmitError(tr('suppliers.form.servicesRequired', 'Debes especificar al menos un servicio.'));
      return;
    }
    if (form.name.trim().length < 2) {
      setSubmitError(tr('suppliers.form.nameRequired', 'Nombre del proveedor requerido.'));
      return;
    }
    if (form.taxId.trim().length < 2) {
      setSubmitError(tr('suppliers.form.taxIdRequired', 'RUT/Tax ID requerido.'));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await registerSupplier(projectId, {
        name: form.name.trim(),
        taxId: form.taxId.trim(),
        services,
      });
      logger.info('suppliers.register.success', { name: form.name.trim() });
      setForm(EMPTY_FORM);
      setShowForm(false);
      refetch();
    } catch (err) {
      logger.error('suppliers.register.failed', err);
      setSubmitError((err as Error).message || tr('suppliers.form.error', 'No se pudo registrar.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="suppliers-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Truck className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {tr('suppliers.page.title', 'Calidad de Proveedores')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {tr(
              'suppliers.page.selectProject',
              'Selecciona un proyecto para ver el ranking de proveedores.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="suppliers-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center border border-blue-500/20">
          <Truck className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {tr('suppliers.page.title', 'Calidad de Proveedores')}
          </h1>
          <p className="text-xs text-secondary-token">
            {tr(
              'suppliers.page.subtitle',
              'Ranking de riesgo de contratistas — Sprint K §90-91.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="suppliers-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {tr('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <div className="flex flex-wrap gap-2 items-center">
        {RISK_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            data-testid={`suppliers-filter-${f}`}
            onClick={() => setFilter(f)}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border transition-colors',
              filter === f
                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40'
                : 'bg-surface text-secondary-token border-default-token hover:bg-blue-500/5',
            ].join(' ')}
          >
            {filterLabel(f, tr)}
          </button>
        ))}
        <button
          type="button"
          data-testid="suppliers-register-btn"
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
          {tr('suppliers.register.cta', 'Nuevo proveedor')}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleRegister}
          className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
          data-testid="suppliers-register-form"
        >
          <h2 className="text-sm font-black text-primary-token uppercase tracking-tight">
            {tr('suppliers.form.title', 'Registrar proveedor')}
          </h2>
          <label className="block text-xs font-bold text-secondary-token uppercase tracking-wide">
            {tr('suppliers.form.name', 'Nombre / razón social')}
            <input
              type="text"
              data-testid="suppliers-form-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-default-token bg-input-token px-3 py-2 text-sm text-primary-token font-normal normal-case tracking-normal"
              maxLength={200}
              required
            />
          </label>
          <label className="block text-xs font-bold text-secondary-token uppercase tracking-wide">
            {tr('suppliers.form.taxId', 'RUT / Tax ID')}
            <input
              type="text"
              data-testid="suppliers-form-taxid"
              value={form.taxId}
              onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-default-token bg-input-token px-3 py-2 text-sm text-primary-token font-normal normal-case tracking-normal"
              maxLength={40}
              required
            />
          </label>
          <label className="block text-xs font-bold text-secondary-token uppercase tracking-wide">
            {tr(
              'suppliers.form.services',
              'Servicios (separados por coma)',
            )}
            <input
              type="text"
              data-testid="suppliers-form-services"
              value={form.servicesText}
              onChange={(e) =>
                setForm((f) => ({ ...f, servicesText: e.target.value }))
              }
              placeholder={tr(
                'suppliers.form.servicesPlaceholder',
                'transporte, catering, calibración',
              )}
              className="mt-1 w-full rounded-lg border border-default-token bg-input-token px-3 py-2 text-sm text-primary-token font-normal normal-case tracking-normal"
              required
            />
          </label>
          {submitError && (
            <p
              className="text-xs text-rose-600 dark:text-rose-400"
              data-testid="suppliers-form-error"
              role="alert"
            >
              {submitError}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setSubmitError(null);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide border border-default-token text-secondary-token hover:bg-surface"
            >
              {tr('common.cancel', 'Cancelar')}
            </button>
            <button
              type="submit"
              data-testid="suppliers-form-submit"
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50"
            >
              {submitting
                ? tr('common.saving', 'Guardando…')
                : tr('common.save', 'Guardar')}
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="suppliers-loading"
        >
          {tr('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="suppliers-error"
          role="alert"
        >
          {t('suppliers.page.error', 'No se pudieron cargar los proveedores: {{msg}}', {
            msg: error.message,
          }) as string}
        </div>
      )}

      {!loading && !error && suppliers.length === 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center text-sm text-secondary-token"
          data-testid="suppliers-empty-list"
        >
          {tr(
            'suppliers.page.emptyList',
            'No hay proveedores registrados para este filtro.',
          )}
        </div>
      )}

      {!loading && !error && suppliers.length > 0 && (
        <ul className="space-y-2" data-testid="suppliers-list">
          {suppliers.map((s) => {
            const cls = riskClasses(s.riskLevel);
            return (
              <li
                key={s.id}
                data-testid={`suppliers-card-${s.id}`}
                className="rounded-2xl border border-default-token bg-surface p-4 hover:border-blue-500/40 cursor-pointer transition-colors"
                onClick={() => setSelected(s)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-primary-token truncate">
                      {s.legalName}
                    </h3>
                    <p className="text-xs text-secondary-token font-mono">{s.taxId}</p>
                    <p className="text-xs text-secondary-token mt-1">
                      {s.services.join(' · ')}
                    </p>
                    {s.lastIncidentAt && (
                      <p className="text-[11px] text-secondary-token mt-1">
                        {tr('suppliers.card.lastIncident', 'Último incidente:')}{' '}
                        {s.lastIncidentAt.slice(0, 10)}
                      </p>
                    )}
                  </div>
                  <div className="text-right space-y-1">
                    <span
                      className={[
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
                        cls.bg,
                        cls.text,
                        cls.border,
                      ].join(' ')}
                      data-testid={`suppliers-risk-${s.riskLevel}`}
                    >
                      {riskLabel(s.riskLevel, tr)}
                    </span>
                    <div className="text-lg font-black text-primary-token tabular-nums">
                      {s.score.toFixed(1)}
                    </div>
                    <div className="flex items-center justify-end gap-1 text-[10px] text-secondary-token uppercase tracking-wider">
                      {trendIcon(s.trend)}
                      {trendLabel(s.trend, tr)}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Ranking comparativo (datos reales del motor de scoring server-side) */}
      <section data-testid="suppliers-comparator-section" className="space-y-2">
        {rankingLoading && (
          <div
            className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
            data-testid="suppliers-ranking-loading"
          >
            {tr('common.loading', 'Cargando…')}
          </div>
        )}
        {!rankingLoading && rankingError && (
          <div
            className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
            data-testid="suppliers-ranking-error"
            role="alert"
          >
            {tr('suppliers.ranking.error', 'No se pudo cargar el ranking:')}{' '}
            {rankingError.message}
          </div>
        )}
        {!rankingLoading && !rankingError && (
          <SupplierComparator
            ranking={rankingData?.ranking ?? []}
            service={tr('suppliers.ranking.allServices', 'Todos los servicios')}
          />
        )}
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          data-testid="suppliers-detail-modal"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-surface rounded-2xl border border-default-token max-w-lg w-full p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-black text-primary-token">
                  {selected.legalName}
                </h2>
                <p className="text-xs text-secondary-token font-mono">
                  {selected.taxId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-secondary-token hover:text-primary-token p-1"
                data-testid="suppliers-detail-close"
                aria-label={tr('common.close', 'Cerrar')}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-secondary-token uppercase tracking-wide font-bold">
                  {tr('suppliers.detail.score', 'Score')}
                </dt>
                <dd className="text-2xl font-black text-primary-token tabular-nums">
                  {selected.score.toFixed(1)}
                </dd>
              </div>
              <div>
                <dt className="text-secondary-token uppercase tracking-wide font-bold">
                  {tr('suppliers.detail.risk', 'Riesgo')}
                </dt>
                <dd
                  className={[
                    'text-base font-bold',
                    riskClasses(selected.riskLevel).text,
                  ].join(' ')}
                >
                  {riskLabel(selected.riskLevel, tr)}
                </dd>
              </div>
              <div>
                <dt className="text-secondary-token uppercase tracking-wide font-bold">
                  {tr('suppliers.detail.incidents', 'Incidentes')}
                </dt>
                <dd className="text-base text-primary-token tabular-nums">
                  {selected.incidentCount}
                </dd>
              </div>
              <div>
                <dt className="text-secondary-token uppercase tracking-wide font-bold">
                  {tr('suppliers.detail.audits', 'Auditorías')}
                </dt>
                <dd className="text-base text-primary-token tabular-nums">
                  {selected.auditCount}
                </dd>
              </div>
              <div>
                <dt className="text-secondary-token uppercase tracking-wide font-bold">
                  {tr('suppliers.detail.lastIncident', 'Último incidente')}
                </dt>
                <dd className="text-sm text-primary-token">
                  {selected.lastIncidentAt?.slice(0, 10) ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-secondary-token uppercase tracking-wide font-bold">
                  {tr('suppliers.detail.lastAudit', 'Última auditoría')}
                </dt>
                <dd className="text-sm text-primary-token">
                  {selected.lastAuditAt?.slice(0, 10) ?? '—'}
                </dd>
              </div>
            </dl>
            <div>
              <h3 className="text-xs font-bold text-secondary-token uppercase tracking-wide mb-1">
                {tr('suppliers.detail.services', 'Servicios')}
              </h3>
              <div className="flex flex-wrap gap-1">
                {selected.services.map((svc) => (
                  <span
                    key={svc}
                    className="px-2 py-0.5 rounded-full text-[10px] bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/30"
                  >
                    {svc}
                  </span>
                ))}
              </div>
            </div>
            {selected.criticalRoles.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-secondary-token uppercase tracking-wide mb-1">
                  {tr('suppliers.detail.criticalRoles', 'Roles críticos')}
                </h3>
                <div className="flex flex-wrap gap-1">
                  {selected.criticalRoles.map((role) => (
                    <span
                      key={role}
                      className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SupplierQuality;

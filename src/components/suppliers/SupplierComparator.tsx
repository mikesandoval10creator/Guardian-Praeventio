// Praeventio Guard — Wire UI #47: <SupplierComparator />
//
// Ranking comparativo de proveedores para un servicio + auditoría de
// servicios críticos (alerta de proveedor único / riesgo sistémico).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  rankSuppliers,
  auditCriticalServices,
  type Supplier,
  type ServiceDeliveryEvent,
  type SupplierServiceKind,
  type SLATarget,
} from '../../services/suppliers/supplierQualityService.js';

interface SupplierComparatorProps {
  suppliers: Supplier[];
  events: ServiceDeliveryEvent[];
  /** Servicio a rankear. */
  service: SupplierServiceKind;
  /** Target SLA por defecto (aplica para ranking y crítico). */
  defaultTarget: SLATarget;
  /** Lista de servicios considerados críticos por la organización. */
  criticalServices: SupplierServiceKind[];
}

export function SupplierComparator({
  suppliers,
  events,
  service,
  defaultTarget,
  criticalServices,
}: SupplierComparatorProps) {
  const { t } = useTranslation();

  const ranking = useMemo(
    () => rankSuppliers(suppliers, events, service, defaultTarget),
    [suppliers, events, service, defaultTarget],
  );

  const criticalAudit = useMemo(
    () => auditCriticalServices(suppliers, events, criticalServices, defaultTarget),
    [suppliers, events, criticalServices, defaultTarget],
  );

  const risks = criticalAudit.filter((c) => c.isSoleSupplier || c.hasHighSystemicRisk);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-4"
      data-testid="supplier-comparator"
      aria-label={t('suppliers.aria', 'Comparador de proveedores') as string}
    >
      <header className="flex items-center gap-2">
        <Truck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('suppliers.title', 'Proveedores')}
        </h2>
        <span className="ml-auto text-[10px] uppercase text-secondary-token">
          {t(`suppliers.service.${service}`, service)}
        </span>
      </header>

      {/* Ranking */}
      <div data-testid="supplier-ranking">
        {ranking.length === 0 && (
          <p className="text-xs text-secondary-token italic">
            {t('suppliers.empty', 'Sin proveedores calificados activos para este servicio.')}
          </p>
        )}
        <ul className="space-y-1">
          {ranking.map((r, idx) => (
            <li
              key={r.supplierId}
              data-testid={`supplier-rank-${r.supplierId}`}
              className={`flex items-center gap-2 text-xs p-2 rounded ${
                r.isRecommended
                  ? 'bg-emerald-500/10 border border-emerald-500/20'
                  : 'bg-surface-elevated'
              }`}
            >
              <span className="font-black tabular-nums w-6 text-right">{idx + 1}.</span>
              {r.isRecommended && (
                <ShieldCheck
                  className="w-3 h-3 text-emerald-600"
                  aria-hidden="true"
                  data-testid={`supplier-recommended-${r.supplierId}`}
                />
              )}
              <span className="flex-1 truncate font-bold">{r.legalName}</span>
              <span className="text-[10px] text-secondary-token">
                {r.servicesEvaluated} {t('suppliers.events', 'eventos')}
              </span>
              <span className="font-black tabular-nums w-12 text-right">{r.qualityScore}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Critical risks */}
      {risks.length > 0 && (
        <div data-testid="supplier-critical-risks" className="rounded-lg bg-rose-500/5 p-3">
          <h3 className="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 mb-2 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {t('suppliers.criticalRisks', 'Riesgos servicios críticos')}
          </h3>
          <ul className="space-y-1">
            {risks.map((r) => (
              <li
                key={r.service}
                className="text-[11px] text-rose-700 dark:text-rose-300"
                data-testid={`supplier-risk-${r.service}`}
              >
                <span className="font-bold uppercase">{r.service}</span>
                {r.isSoleSupplier && (
                  <span className="ml-2">
                    {t('suppliers.soleSupplier', 'Único proveedor calificado')}
                  </span>
                )}
                {r.hasHighSystemicRisk && (
                  <span className="ml-2">
                    {t('suppliers.systemicRisk', 'Falla sistémica entre proveedores')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

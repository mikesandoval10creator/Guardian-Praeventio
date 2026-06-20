// Praeventio Guard — Wire UI #47: <SupplierComparator />
//
// Ranking comparativo de proveedores + auditoría de servicios críticos
// (alerta de proveedor único / riesgo sistémico).
//
// Dos modos:
//   1. `ranking`  — datos REALES desde GET /api/sprint-k/:projectId/suppliers/ranking
//      (server scorea con `supplierScoring` 4-dim leyendo Firestore). Es el
//      modo usado por la página `SupplierQuality`. Render-only: NO recalcula.
//   2. props sueltas (`suppliers` + `events`) — modo determinístico legacy
//      que usa el motor SLA puro `supplierQualityService` (sin feed propio).
//      Conservado para reuso/test del motor; la página productiva usa el
//      modo `ranking`.
//
// 4 directiva-3: NO empujamos data a SUSESO/SII/MINSAL/OSHA. El ranking es
// interno; la empresa decide qué hacer con él.

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
import type { SupplierRankingEntry } from '../../hooks/useSuppliers.js';

// ── Row + risk view models shared by both modes ──────────────────────────

interface RankingRow {
  supplierId: string;
  legalName: string;
  /** Etiqueta secundaria (eventos SLA evaluados | servicios prestados). */
  metaCount: number;
  metaLabelKey: string;
  metaLabelFallback: string;
  /** Score 0-100 mostrado a la derecha. */
  qualityScore: number;
  isRecommended: boolean;
}

interface RiskRow {
  service: string;
  isSoleSupplier: boolean;
  hasHighSystemicRisk: boolean;
}

// ── Props (discriminated union) ──────────────────────────────────────────

interface RankingModeProps {
  /** Modo datos reales: ranking ya scoreado por el server. */
  ranking: SupplierRankingEntry[];
  /** Etiqueta de servicio/área para el header (libre). */
  service?: string;
  suppliers?: never;
  events?: never;
  defaultTarget?: never;
  criticalServices?: never;
}

interface ServiceModeProps {
  suppliers: Supplier[];
  events: ServiceDeliveryEvent[];
  /** Servicio a rankear. */
  service: SupplierServiceKind;
  /** Target SLA por defecto (aplica para ranking y crítico). */
  defaultTarget: SLATarget;
  /** Lista de servicios considerados críticos por la organización. */
  criticalServices: SupplierServiceKind[];
  ranking?: never;
}

type SupplierComparatorProps = RankingModeProps | ServiceModeProps;

function isRankingMode(p: SupplierComparatorProps): p is RankingModeProps {
  return Array.isArray((p as RankingModeProps).ranking);
}

export function SupplierComparator(props: SupplierComparatorProps) {
  const { t } = useTranslation();

  const { rows, risks, serviceLabel } = useMemo(() => {
    if (isRankingMode(props)) {
      // ── Modo datos reales (GET /suppliers/ranking) ──────────────────
      const sorted = [...props.ranking].sort((a, b) => a.rank - b.rank);
      const rankingRows: RankingRow[] = sorted.map((r) => ({
        supplierId: r.id,
        legalName: r.legalName,
        metaCount: r.incidentCount,
        metaLabelKey: 'suppliers.incidents',
        metaLabelFallback: 'incidentes',
        qualityScore: Math.round(r.score),
        // Recomendado = riesgo bajo (score alto, el server ya lo derivó).
        isRecommended: r.riskLevel === 'low',
      }));
      // Riesgo sistémico real: TODOS los proveedores en riesgo alto.
      const allHigh =
        sorted.length > 0 && sorted.every((r) => r.riskLevel === 'high');
      const riskRows: RiskRow[] =
        sorted.length === 1
          ? [
              {
                service: props.service ?? '—',
                isSoleSupplier: true,
                hasHighSystemicRisk: allHigh,
              },
            ]
          : allHigh
            ? [
                {
                  service: props.service ?? '—',
                  isSoleSupplier: false,
                  hasHighSystemicRisk: true,
                },
              ]
            : [];
      return {
        rows: rankingRows,
        risks: riskRows,
        serviceLabel: props.service ?? '',
      };
    }

    // ── Modo determinístico legacy (motor SLA puro) ───────────────────
    const ranked = rankSuppliers(
      props.suppliers,
      props.events,
      props.service,
      props.defaultTarget,
    );
    const audit = auditCriticalServices(
      props.suppliers,
      props.events,
      props.criticalServices,
      props.defaultTarget,
    );
    const rankingRows: RankingRow[] = ranked.map((r) => ({
      supplierId: r.supplierId,
      legalName: r.legalName,
      metaCount: r.servicesEvaluated,
      metaLabelKey: 'suppliers.events',
      metaLabelFallback: 'eventos',
      qualityScore: r.qualityScore,
      isRecommended: r.isRecommended,
    }));
    const riskRows: RiskRow[] = audit
      .filter((c) => c.isSoleSupplier || c.hasHighSystemicRisk)
      .map((c) => ({
        service: c.service,
        isSoleSupplier: c.isSoleSupplier,
        hasHighSystemicRisk: c.hasHighSystemicRisk,
      }));
    return { rows: rankingRows, risks: riskRows, serviceLabel: props.service };
  }, [props]);

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
        {serviceLabel && (
          <span className="ml-auto text-[10px] uppercase text-secondary-token">
            {t(`suppliers.service.${serviceLabel}`, serviceLabel)}
          </span>
        )}
      </header>

      {/* Ranking */}
      <div data-testid="supplier-ranking">
        {rows.length === 0 && (
          <p className="text-xs text-secondary-token italic">
            {t('suppliers.empty', 'Sin proveedores calificados activos para este servicio.')}
          </p>
        )}
        <ul className="space-y-1">
          {rows.map((r, idx) => (
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
                {r.metaCount} {t(r.metaLabelKey, r.metaLabelFallback)}
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

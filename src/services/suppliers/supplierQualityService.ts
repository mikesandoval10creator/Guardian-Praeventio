// Praeventio Guard — Sprint K: Evaluación de Proveedores + Servicios Críticos + SLA.
//
// Cierra: Documento usuario "§180-184"
//
// Track de proveedores que prestan servicios al proyecto (catering,
// transporte, calibración, EPP, capacitación, mutualidad, ...):
//   - Catálogo con servicios prestados
//   - SLA acordado vs cumplido
//   - Evaluaciones periódicas
//   - Detección de proveedor único en servicio crítico (L.1 §274 dupl)
//
// Determinístico.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SupplierServiceKind =
  | 'transport'
  | 'catering'
  | 'epp'
  | 'training'
  | 'medical'
  | 'calibration'
  | 'maintenance'
  | 'lab_analysis'
  | 'cleaning'
  | 'security';

export interface Supplier {
  id: string;
  legalName: string;
  /** Tipos de servicio que presta. */
  services: SupplierServiceKind[];
  /** True si está activo. */
  active: boolean;
  /** Si está calificado por el área de prevención. */
  qualified: boolean;
  /** ISO-8601 de la última recalificación. */
  lastQualifiedAt?: string;
}

export interface SLATarget {
  service: SupplierServiceKind;
  /** Tiempo de respuesta esperado en horas. */
  responseTimeHours: number;
  /** Tasa de incumplimiento aceptable (0-1). */
  acceptableFailureRate: number;
}

export interface ServiceDeliveryEvent {
  supplierId: string;
  service: SupplierServiceKind;
  /** ISO-8601 de la solicitud. */
  requestedAt: string;
  /** ISO-8601 de la entrega completa. */
  completedAt?: string;
  /** True si la entrega cumplió expectativas. */
  successful: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// SLA compliance check (§184)
// ────────────────────────────────────────────────────────────────────────

export interface SLAComplianceReport {
  supplierId: string;
  service: SupplierServiceKind;
  totalEvents: number;
  successfulEvents: number;
  failureRate: number;
  avgResponseTimeHours: number;
  /** True si la failure rate está dentro de lo aceptable. */
  meetsSLA: boolean;
  /** True si responseTime está dentro del target. */
  meetsResponseTime: boolean;
}

export function buildSLAReport(
  supplierId: string,
  service: SupplierServiceKind,
  events: ServiceDeliveryEvent[],
  target: SLATarget,
): SLAComplianceReport {
  const own = events.filter((e) => e.supplierId === supplierId && e.service === service);
  const total = own.length;
  const completed = own.filter((e) => e.completedAt);
  const successful = own.filter((e) => e.successful).length;
  const failureRate = total > 0 ? (total - successful) / total : 0;

  const totalResponseHours = completed.reduce((sum, e) => {
    return sum + (Date.parse(e.completedAt!) - Date.parse(e.requestedAt)) / 3_600_000;
  }, 0);
  const avgResponseTimeHours =
    completed.length > 0 ? Math.round((totalResponseHours / completed.length) * 10) / 10 : 0;

  return {
    supplierId,
    service,
    totalEvents: total,
    successfulEvents: successful,
    failureRate: Math.round(failureRate * 100) / 100,
    avgResponseTimeHours,
    meetsSLA: failureRate <= target.acceptableFailureRate,
    meetsResponseTime: avgResponseTimeHours <= target.responseTimeHours,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Supplier ranking (§182)
// ────────────────────────────────────────────────────────────────────────

export interface SupplierRanking {
  supplierId: string;
  legalName: string;
  servicesEvaluated: number;
  /** Score 0-100 combinando reliability + responseTime. */
  qualityScore: number;
  /** True si está dentro del Top 3 recomendado para el servicio. */
  isRecommended: boolean;
}

export function rankSuppliers(
  suppliers: Supplier[],
  events: ServiceDeliveryEvent[],
  service: SupplierServiceKind,
  target: SLATarget,
): SupplierRanking[] {
  const candidates = suppliers.filter((s) => s.active && s.qualified && s.services.includes(service));

  const ranked = candidates.map((s) => {
    const report = buildSLAReport(s.id, service, events, target);
    let qualityScore = 0;
    if (report.totalEvents === 0) {
      qualityScore = 0;
    } else {
      qualityScore = Math.round(
        50 * (1 - report.failureRate) +
          50 * Math.max(0, 1 - report.avgResponseTimeHours / (target.responseTimeHours * 2)),
      );
    }
    return {
      supplierId: s.id,
      legalName: s.legalName,
      servicesEvaluated: report.totalEvents,
      qualityScore,
      isRecommended: false,
    };
  });

  const sorted = ranked.sort((a, b) => b.qualityScore - a.qualityScore);
  // Top 3 recomendados
  for (let i = 0; i < Math.min(3, sorted.length); i++) {
    if (sorted[i].qualityScore > 0) sorted[i].isRecommended = true;
  }
  return sorted;
}

// ────────────────────────────────────────────────────────────────────────
// Critical services audit (§183, complementa §274 de L.1)
// ────────────────────────────────────────────────────────────────────────

export interface CriticalServiceRisk {
  service: SupplierServiceKind;
  supplierCount: number;
  /** True si solo hay 1 proveedor calificado activo. */
  isSoleSupplier: boolean;
  /** True si todos los proveedores tienen alta failure rate. */
  hasHighSystemicRisk: boolean;
}

export function auditCriticalServices(
  suppliers: Supplier[],
  events: ServiceDeliveryEvent[],
  criticalServices: SupplierServiceKind[],
  defaultTarget: SLATarget,
): CriticalServiceRisk[] {
  return criticalServices.map((service) => {
    const eligible = suppliers.filter(
      (s) => s.active && s.qualified && s.services.includes(service),
    );
    const supplierCount = eligible.length;
    const isSoleSupplier = supplierCount === 1;
    const target: SLATarget = { ...defaultTarget, service };
    const reports = eligible.map((s) => buildSLAReport(s.id, service, events, target));
    const hasHighSystemicRisk =
      reports.length > 0 && reports.every((r) => r.failureRate > target.acceptableFailureRate);
    return { service, supplierCount, isSoleSupplier, hasHighSystemicRisk };
  });
}

// Praeventio Guard — Sprint K: Residuos + Manifiestos + Huella Ambiental + ESG + Permisos Ambientales.
//
// Cierra: Documento usuario "§229-236"
//
// Gestión ambiental integrada al sistema preventivo:
//   - Inventario de residuos peligrosos y no peligrosos
//   - Manifiestos de transporte (cadena de custodia)
//   - Compatibilidad entre residuos
//   - Huella ambiental simplificada (CO2 equiv, agua, electricidad)
//   - Métricas ESG para reporting cliente
//   - Permisos ambientales (DIA, EIA, RCA, vencimientos)
//   - Alertas externas (incendios cercanos, calidad aire)
//
// Determinístico. Sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type WasteKind = 'hazardous' | 'non_hazardous' | 'recyclable' | 'organic' | 'electronic';

export interface WasteRecord {
  id: string;
  kind: WasteKind;
  /** Código SISS o internacional. */
  wasteCode?: string;
  description: string;
  quantityKg: number;
  /** ISO-8601. */
  generatedAt: string;
  /** Storage actual. */
  storageLocation: string;
  /** ID del manifiesto si ya se despachó. */
  manifestId?: string;
}

export interface WasteManifest {
  id: string;
  wasteIds: string[];
  /** Empresa transportista autorizada. */
  transporterId: string;
  /** Empresa receptora autorizada. */
  receiverId: string;
  /** ISO-8601 del despacho. */
  dispatchedAt: string;
  /** ISO-8601 de la recepción confirmada. */
  receivedAt?: string;
  /** Si la recepción tuvo discrepancias. */
  hasDiscrepancy: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Waste inventory + capacity
// ────────────────────────────────────────────────────────────────────────

export interface WasteInventoryReport {
  totalQuantityKg: number;
  byKind: Record<WasteKind, { count: number; totalKg: number }>;
  /** Residuos despachados (con manifest). */
  dispatched: number;
  /** Residuos en stock. */
  inStock: number;
}

export function buildWasteInventoryReport(wastes: WasteRecord[]): WasteInventoryReport {
  const byKind = {
    hazardous: { count: 0, totalKg: 0 },
    non_hazardous: { count: 0, totalKg: 0 },
    recyclable: { count: 0, totalKg: 0 },
    organic: { count: 0, totalKg: 0 },
    electronic: { count: 0, totalKg: 0 },
  } as Record<WasteKind, { count: number; totalKg: number }>;

  let totalKg = 0;
  let dispatched = 0;
  let inStock = 0;
  for (const w of wastes) {
    byKind[w.kind].count += 1;
    byKind[w.kind].totalKg += w.quantityKg;
    totalKg += w.quantityKg;
    if (w.manifestId) dispatched += 1;
    else inStock += 1;
  }

  return {
    totalQuantityKg: Math.round(totalKg * 10) / 10,
    byKind,
    dispatched,
    inStock,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Manifest validation
// ────────────────────────────────────────────────────────────────────────

export interface ManifestValidationResult {
  manifestId: string;
  isValid: boolean;
  issues: string[];
}

export function validateManifest(
  manifest: WasteManifest,
  wastes: WasteRecord[],
  authorizedTransporters: Set<string>,
  authorizedReceivers: Set<string>,
): ManifestValidationResult {
  const issues: string[] = [];

  if (!authorizedTransporters.has(manifest.transporterId)) {
    issues.push(`Transportista ${manifest.transporterId} NO está en lista autorizada SISS.`);
  }
  if (!authorizedReceivers.has(manifest.receiverId)) {
    issues.push(`Receptor ${manifest.receiverId} NO está autorizado para recibir residuos.`);
  }

  const manifestWastes = wastes.filter((w) => manifest.wasteIds.includes(w.id));
  if (manifestWastes.length !== manifest.wasteIds.length) {
    issues.push(
      `Manifest referencia ${manifest.wasteIds.length} residuos pero ${manifestWastes.length} existen.`,
    );
  }
  if (manifestWastes.some((w) => w.manifestId && w.manifestId !== manifest.id)) {
    issues.push('Algún residuo ya está asociado a otro manifest (doble-despacho).');
  }
  if (manifest.hasDiscrepancy && !manifest.receivedAt) {
    issues.push('Hay discrepancia reportada pero no consta recepción cerrada.');
  }

  return {
    manifestId: manifest.id,
    isValid: issues.length === 0,
    issues,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Environmental footprint (§232 — simplificado)
// ────────────────────────────────────────────────────────────────────────

export interface FootprintInputs {
  electricityKwh: number;
  fuelLiters: number;
  waterM3: number;
  totalWasteKg: number;
  hazardousWasteKg: number;
}

export interface FootprintReport {
  co2EquivKg: number;
  waterFootprintM3: number;
  wasteIntensityKgPerKwh: number;
  /** % residuos peligrosos del total. */
  hazardousPercent: number;
}

/**
 * Factores aproximados:
 *   - Electricidad: 0.42 kgCO2/kWh (mix chileno SEN aprox)
 *   - Diesel: 2.68 kgCO2/L
 *
 * Para reporting interno orientativo, NO sustituye un cálculo ISO 14064.
 */
export function computeFootprint(inputs: FootprintInputs): FootprintReport {
  const ELECTRICITY_FACTOR = 0.42;
  const FUEL_FACTOR = 2.68;

  const co2 = inputs.electricityKwh * ELECTRICITY_FACTOR + inputs.fuelLiters * FUEL_FACTOR;
  const wasteIntensity =
    inputs.electricityKwh > 0 ? inputs.totalWasteKg / inputs.electricityKwh : 0;
  const hazardousPercent =
    inputs.totalWasteKg > 0
      ? Math.round((inputs.hazardousWasteKg / inputs.totalWasteKg) * 100)
      : 0;

  return {
    co2EquivKg: Math.round(co2 * 10) / 10,
    waterFootprintM3: inputs.waterM3,
    wasteIntensityKgPerKwh: Math.round(wasteIntensity * 1000) / 1000,
    hazardousPercent,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Permits + alerts
// ────────────────────────────────────────────────────────────────────────

export type EnvironmentalPermitKind = 'DIA' | 'EIA' | 'RCA' | 'PAS' | 'water_extraction' | 'effluent';

export interface EnvironmentalPermit {
  id: string;
  kind: EnvironmentalPermitKind;
  issuedAt: string;
  expiresAt: string;
  /** RCA o similar. */
  reference: string;
}

export function detectPermitExpirations(
  permits: EnvironmentalPermit[],
  daysAhead: number = 90,
  nowIso: string = new Date().toISOString(),
): Array<EnvironmentalPermit & { daysUntilExpiration: number }> {
  const nowMs = Date.parse(nowIso);
  return permits
    .map((p) => ({
      ...p,
      daysUntilExpiration: Math.floor((Date.parse(p.expiresAt) - nowMs) / 86_400_000),
    }))
    .filter((p) => p.daysUntilExpiration <= daysAhead)
    .sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
}

export type ExternalEnvAlert =
  | 'fire_proximity'
  | 'air_quality_low'
  | 'water_emergency'
  | 'volcanic_activity';

export interface ExternalAlertSignal {
  kind: ExternalEnvAlert;
  severity: 'info' | 'watch' | 'warning' | 'emergency';
  /** Distancia en km al evento (si aplica). */
  distanceKm?: number;
  /** Notas. */
  notes?: string;
}

export interface ExternalAlertAction {
  alert: ExternalEnvAlert;
  recommended: 'monitor' | 'increase_protection' | 'stop_outdoor_work' | 'evacuate';
  reasoning: string;
}

export function decideAlertAction(signal: ExternalAlertSignal): ExternalAlertAction {
  if (signal.severity === 'emergency') {
    return {
      alert: signal.kind,
      recommended: 'evacuate',
      reasoning: 'Severidad emergencia — activar protocolo evacuación.',
    };
  }
  if (signal.severity === 'warning') {
    if (signal.kind === 'fire_proximity' && (signal.distanceKm ?? Infinity) < 5) {
      return {
        alert: signal.kind,
        recommended: 'evacuate',
        reasoning: 'Incendio < 5km — evacuación preventiva.',
      };
    }
    return {
      alert: signal.kind,
      recommended: 'stop_outdoor_work',
      reasoning: 'Severidad warning — suspender trabajos al aire libre.',
    };
  }
  if (signal.severity === 'watch') {
    return {
      alert: signal.kind,
      recommended: 'increase_protection',
      reasoning: 'Severidad watch — aumentar EPP / monitorear condiciones.',
    };
  }
  return {
    alert: signal.kind,
    recommended: 'monitor',
    reasoning: 'Severidad info — mantener monitoreo.',
  };
}

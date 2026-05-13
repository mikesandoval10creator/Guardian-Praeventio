// Praeventio Guard — Sprint K: Upsell por dolor real.
//
// Cierra: §116 (3ra tanda usuario).
//
// Sugiere tier o addons SOLO cuando hay señales de dolor real en el uso:
// muchos reportes manuales, excepciones repetidas, baja confianza en datos.
// NUNCA sugiere upsell sin evidencia de pain — el usuario odia upsell agresivo.
//
// Determinístico, sin LLM ni I/O.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type Tier = 'free' | 'starter' | 'pro' | 'enterprise';

export interface UsagePainSignals {
  /** Reportes generados manualmente por semana (auto = sin dolor). */
  manualReportsPerWeek: number;
  /** Excepciones manuales que el sistema NO pudo manejar en los últimos 30d. */
  exceptionsRaisedLast30d: number;
  /** Score 0-1 de confianza promedio en los datos (1 = perfecto). */
  dataConfidenceScore: number;
  /** Tier actual. */
  currentTier: Tier;
  /** Cantidad de proyectos activos (proxy de escala). */
  activeProjectCount?: number;
}

export type PainSignal =
  | 'high_manual_reports'
  | 'frequent_exceptions'
  | 'low_data_confidence'
  | 'scale_outgrew_tier';

export interface UpsellSuggestion {
  /** Identificador del addon o tier propuesto. */
  addonOrTier: string;
  /** Tipo: addon individual o salto de tier. */
  kind: 'addon' | 'tier_upgrade';
  /** Señales de dolor que esta sugerencia alivia (ordenadas alfabéticamente). */
  painSignalsAddressed: PainSignal[];
  /** % estimado de alivio de pain agregado (0-100). */
  painReductionEstimate: number;
  /** Pista textual de pricing (i18n key-style, sin números concretos). */
  pricingHint: string;
}

// ────────────────────────────────────────────────────────────────────────
// Pain detection
// ────────────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  manualReportsPerWeek: 5,
  exceptionsLast30d: 8,
  dataConfidence: 0.7,
  scaleProjects: 5,
} as const;

function detectPains(s: UsagePainSignals): Set<PainSignal> {
  const out = new Set<PainSignal>();
  if (s.manualReportsPerWeek >= THRESHOLDS.manualReportsPerWeek) out.add('high_manual_reports');
  if (s.exceptionsRaisedLast30d >= THRESHOLDS.exceptionsLast30d) out.add('frequent_exceptions');
  if (s.dataConfidenceScore < THRESHOLDS.dataConfidence) out.add('low_data_confidence');
  // Codex P2 PR #129: incluir Pro en scale detection. Pro tenant con
  // muchos proyectos también debe ser ruteado a Enterprise. Solo se
  // excluye el tier actual ya-Enterprise.
  if (
    typeof s.activeProjectCount === 'number' &&
    s.activeProjectCount >= THRESHOLDS.scaleProjects &&
    s.currentTier !== 'enterprise'
  ) {
    out.add('scale_outgrew_tier');
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Suggestion catalog
// ────────────────────────────────────────────────────────────────────────

interface Candidate {
  addonOrTier: string;
  kind: 'addon' | 'tier_upgrade';
  addresses: PainSignal[];
  /** % alivio si el usuario lo adopta. */
  reduction: number;
  pricingHint: string;
  /** Tier mínimo en el que aplica (no sugerir tier upgrade si ya está ahí). */
  notIfCurrentTier?: Tier[];
}

const CATALOG: Candidate[] = [
  {
    addonOrTier: 'addon.automated_reports',
    kind: 'addon',
    addresses: ['high_manual_reports'],
    reduction: 70,
    pricingHint: 'pricing.addon.reports.monthly',
  },
  {
    addonOrTier: 'addon.exception_workflows',
    kind: 'addon',
    addresses: ['frequent_exceptions'],
    reduction: 60,
    pricingHint: 'pricing.addon.workflows.monthly',
  },
  {
    addonOrTier: 'addon.data_quality_pack',
    kind: 'addon',
    addresses: ['low_data_confidence'],
    reduction: 55,
    pricingHint: 'pricing.addon.dataquality.monthly',
  },
  {
    addonOrTier: 'tier.pro',
    kind: 'tier_upgrade',
    addresses: ['high_manual_reports', 'frequent_exceptions', 'scale_outgrew_tier'],
    reduction: 80,
    pricingHint: 'pricing.tier.pro.monthly',
    notIfCurrentTier: ['pro', 'enterprise'],
  },
  {
    addonOrTier: 'tier.enterprise',
    kind: 'tier_upgrade',
    addresses: ['low_data_confidence', 'frequent_exceptions', 'scale_outgrew_tier'],
    reduction: 90,
    pricingHint: 'pricing.tier.enterprise.custom',
    notIfCurrentTier: ['enterprise'],
  },
];

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

export function suggestUpsell(signals: UsagePainSignals): UpsellSuggestion[] {
  if (signals.dataConfidenceScore < 0 || signals.dataConfidenceScore > 1) {
    throw new Error('dataConfidenceScore must be within [0, 1]');
  }

  const pains = detectPains(signals);
  if (pains.size === 0) return [];

  const suggestions: UpsellSuggestion[] = [];
  for (const c of CATALOG) {
    if (c.notIfCurrentTier?.includes(signals.currentTier)) continue;

    const matched = c.addresses.filter((p) => pains.has(p));
    if (matched.length === 0) continue;

    // Alivio efectivo proporcional al # de pains que cubre vs total de pains.
    const coverageRatio = matched.length / pains.size;
    const estimate = Math.round(c.reduction * coverageRatio);

    suggestions.push({
      addonOrTier: c.addonOrTier,
      kind: c.kind,
      painSignalsAddressed: [...matched].sort(),
      painReductionEstimate: estimate,
      pricingHint: c.pricingHint,
    });
  }

  // Ordenar por alivio desc; ties por addonOrTier asc para determinismo.
  suggestions.sort((a, b) => {
    if (b.painReductionEstimate !== a.painReductionEstimate) {
      return b.painReductionEstimate - a.painReductionEstimate;
    }
    return a.addonOrTier.localeCompare(b.addonOrTier);
  });

  return suggestions;
}

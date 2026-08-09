// Praeventio Guard — pain-based upsell over the canonical metallic ladder.
//
// Suggestions are emitted only when real usage pain is present. Tier IDs,
// order, and project capacities come from pricing/tiers.ts.

import { TIERS, getTierById, type TierId } from "../pricing/tiers.js";

export type Tier = TierId;

export interface UsagePainSignals {
  manualReportsPerWeek: number;
  exceptionsRaisedLast30d: number;
  dataConfidenceScore: number;
  currentTier: Tier;
  activeProjectCount?: number;
}

export type PainSignal =
  | "high_manual_reports"
  | "frequent_exceptions"
  | "low_data_confidence"
  | "scale_outgrew_tier";

export interface UpsellSuggestion {
  addonOrTier: string;
  kind: "addon" | "tier_upgrade";
  painSignalsAddressed: PainSignal[];
  painReductionEstimate: number;
  pricingHint: string;
}

const THRESHOLDS = {
  manualReportsPerWeek: 5,
  exceptionsLast30d: 8,
  dataConfidence: 0.7,
} as const;

function detectPains(signals: UsagePainSignals): Set<PainSignal> {
  const pains = new Set<PainSignal>();
  if (signals.manualReportsPerWeek >= THRESHOLDS.manualReportsPerWeek) {
    pains.add("high_manual_reports");
  }
  if (signals.exceptionsRaisedLast30d >= THRESHOLDS.exceptionsLast30d) {
    pains.add("frequent_exceptions");
  }
  if (signals.dataConfidenceScore < THRESHOLDS.dataConfidence) {
    pains.add("low_data_confidence");
  }

  const current = getTierById(signals.currentTier);
  if (
    typeof signals.activeProjectCount === "number" &&
    signals.activeProjectCount > current.proyectosMax
  ) {
    pains.add("scale_outgrew_tier");
  }

  return pains;
}

interface AddonCandidate {
  addonOrTier: string;
  addresses: PainSignal[];
  reduction: number;
  pricingHint: string;
}

const ADDON_CATALOG: readonly AddonCandidate[] = [
  {
    addonOrTier: "addon.automated_reports",
    addresses: ["high_manual_reports"],
    reduction: 70,
    pricingHint: "pricing.addon.reports.monthly",
  },
  {
    addonOrTier: "addon.exception_workflows",
    addresses: ["frequent_exceptions"],
    reduction: 60,
    pricingHint: "pricing.addon.workflows.monthly",
  },
  {
    addonOrTier: "addon.data_quality_pack",
    addresses: ["low_data_confidence"],
    reduction: 55,
    pricingHint: "pricing.addon.dataquality.monthly",
  },
];

function nextTier(currentTier: Tier): Tier | null {
  const index = TIERS.findIndex((tier) => tier.id === currentTier);
  return index >= 0 && index < TIERS.length - 1 ? TIERS[index + 1].id : null;
}

function toSuggestion(
  candidate: AddonCandidate,
  pains: Set<PainSignal>,
): UpsellSuggestion | null {
  const matched = candidate.addresses.filter((pain) => pains.has(pain));
  if (matched.length === 0) return null;

  return {
    addonOrTier: candidate.addonOrTier,
    kind: "addon",
    painSignalsAddressed: [...matched].sort(),
    painReductionEstimate: Math.round(
      candidate.reduction * (matched.length / pains.size),
    ),
    pricingHint: candidate.pricingHint,
  };
}

export function suggestUpsell(signals: UsagePainSignals): UpsellSuggestion[] {
  if (signals.dataConfidenceScore < 0 || signals.dataConfidenceScore > 1) {
    throw new Error("dataConfidenceScore must be within [0, 1]");
  }

  const pains = detectPains(signals);
  if (pains.size === 0) return [];

  const suggestions = ADDON_CATALOG.flatMap((candidate) => {
    const suggestion = toSuggestion(candidate, pains);
    return suggestion ? [suggestion] : [];
  });

  const upgradeTier = nextTier(signals.currentTier);
  if (upgradeTier && pains.has("scale_outgrew_tier")) {
    suggestions.push({
      addonOrTier: `tier.${upgradeTier}`,
      kind: "tier_upgrade",
      painSignalsAddressed: ["scale_outgrew_tier"],
      painReductionEstimate: Math.round(80 / pains.size),
      pricingHint: `pricing.tier.${upgradeTier}.monthly`,
    });
  }

  suggestions.sort((a, b) => {
    if (b.painReductionEstimate !== a.painReductionEstimate) {
      return b.painReductionEstimate - a.painReductionEstimate;
    }
    return a.addonOrTier.localeCompare(b.addonOrTier);
  });

  return suggestions;
}

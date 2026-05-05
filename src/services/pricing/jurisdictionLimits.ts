// Sprint 31 OO — Jurisdiction limits per tier.
//
// Closes the multi-jurisdicción gate that pairs the new Tier Global
// Titanio with the regulatory registry. Contract:
//
//   - Most tiers are single-jurisdicción (LATAM data residency, 1 active
//     country specific code on top of the ISO 45001 baseline).
//   - Premium tiers (titanio, diamante, empresarial, corporativo,
//     ilimitado) keep the same single-jurisdicción posture — they buy
//     more workers/projects, NOT more countries.
//   - Tier Global Titanio explicitly multiplies jurisdictions: Infinity.
//
// ISO 45001 NEVER counts toward the limit — it is the universal
// baseline and ships with every tier.

import type { JurisdictionCode } from '../regulatory/types.js';
import { getTierById, type TierId } from './tiers.js';

/**
 * Sprint 31 OO — How many country-specific jurisdictions the tier can
 * activate at once (ISO-45001 excluded). Tier Global Titanio is
 * `Infinity`; everyone else is 1 unless the tier definition overrides
 * via `jurisdictionsMax`.
 */
export function getMaxJurisdictionsForTier(tierId: TierId): number {
  const tier = getTierById(tierId);
  if (typeof tier.jurisdictionsMax === 'number') {
    return tier.jurisdictionsMax;
  }
  // Default for every tier predating Sprint 31: single-jurisdiction.
  return 1;
}

export interface JurisdictionLimitResult {
  allowed: boolean;
  /** Human-readable reason when `allowed=false`. */
  reason?: string;
  /** Echo of the limit applied so callers can render it in UI. */
  limit: number;
  /** Country-specific jurisdictions actually counted (ISO 45001 excluded). */
  countableCount: number;
}

/**
 * Sprint 31 OO — Returns whether the tenant tier may simultaneously
 * activate the requested set of jurisdictions. ISO 45001 is always
 * allowed and excluded from the count.
 */
export function assertJurisdictionLimit(
  tenantTierId: TierId,
  requestedJurisdictions: JurisdictionCode[],
): JurisdictionLimitResult {
  const limit = getMaxJurisdictionsForTier(tenantTierId);
  // Dedupe and exclude the ISO baseline before counting.
  const countable = Array.from(
    new Set(requestedJurisdictions.filter((j) => j !== 'ISO-45001')),
  );
  const countableCount = countable.length;

  if (countableCount <= limit) {
    return { allowed: true, limit, countableCount };
  }

  return {
    allowed: false,
    limit,
    countableCount,
    reason:
      `Tier "${tenantTierId}" permite ${limit === Infinity ? 'sin límite' : limit} jurisdicción(es) ` +
      `simultánea(s) además de ISO 45001; se solicitaron ${countableCount}. ` +
      `Considera el tier "global-titanio" para multi-jurisdicción simultáneo.`,
  };
}

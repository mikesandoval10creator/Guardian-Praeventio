/**
 * Country-pack registry for jurisdiction-aware normativa.
 *
 * Each pack exposes:
 *   - identifying metadata (code, display name, flag, primary language),
 *   - a list of structured `Regulation` entries (real article references),
 *   - normative numeric thresholds (Comité @ N workers, Prevention dept @ N workers),
 *   - a coarse ISO 45001 compatibility tag.
 *
 * Lookup helpers `getPackByCode` and `getDefaultPack` are the supported entry points
 * — callers should not import the underlying data modules directly.
 */
import { CL_PACK } from '../../data/normativa/cl';
import { PE_PACK } from '../../data/normativa/pe';
import { CO_PACK } from '../../data/normativa/co';
import { MX_PACK } from '../../data/normativa/mx';
import { AR_PACK } from '../../data/normativa/ar';
import { BR_PACK } from '../../data/normativa/br';
import { ISO_PACK } from '../../data/normativa/iso';

export type CountryCode = 'CL' | 'PE' | 'CO' | 'MX' | 'AR' | 'BR' | 'ISO';

export interface Regulation {
  /** Stable id, e.g. 'cl-ds-54' or 'co-decreto-1072'. */
  id: string;
  /** Human-readable title, e.g. 'DS 54 — Comité Paritario'. */
  title: string;
  /** Formal legal reference, e.g. 'Decreto Supremo 54, Art. 1'. */
  reference: string;
  /** Brief scope/description shown in the UI. */
  scope: string;
  /** Optional canonical URL (BCN, DOF, MTE/SST portals). */
  url?: string;
}

export interface NormativeThresholds {
  /** Worker count at which a Comité Paritario / Mixto / CIPA / COPASST is required. */
  comiteRequiredAtWorkers: number;
  /** Worker count at which a formal Prevention Department / SESMT / Service is required. */
  preventionDeptRequiredAtWorkers: number;
  /** Whether monthly committee meetings are mandated by the local framework. */
  monthlyMeetingsRequired?: boolean;
}

export interface CountryPack {
  code: CountryCode;
  /** Localised display name, e.g. 'Chile', 'Perú', 'Brasil'. */
  name: string;
  /** Emoji flag for compact UI rendering. */
  flag: string;
  /** Primary BCP-47 locale tag for the pack's content. */
  language: 'es-CL' | 'es-PE' | 'es-CO' | 'es-MX' | 'es-AR' | 'pt-BR' | 'en';
  /** Structured regulation entries. Order matters for UI listings. */
  regulations: Regulation[];
  /** Numeric thresholds for committee/prevention-department obligations. */
  thresholds: NormativeThresholds;
  /** Coarse compatibility with ISO 45001:2018. */
  iso45001Compatibility: 'high' | 'medium' | 'low';
  /** Optional disclaimer/notes (Portuguese for BR, Spanish for LATAM). */
  notes?: string;
}

export const COUNTRY_PACKS: Record<CountryCode, CountryPack> = {
  CL: CL_PACK,
  PE: PE_PACK,
  CO: CO_PACK,
  MX: MX_PACK,
  AR: AR_PACK,
  BR: BR_PACK,
  ISO: ISO_PACK,
};

/**
 * Returns the pack for the given country code.
 * @throws if `code` is not a registered `CountryCode`.
 */
export function getPackByCode(code: CountryCode): CountryPack {
  const pack = COUNTRY_PACKS[code];
  if (!pack) {
    throw new Error(
      `[countryPacks] Unknown country code "${code}". Supported: ${Object.keys(COUNTRY_PACKS).join(', ')}`,
    );
  }
  return pack;
}

/**
 * Returns the universal ISO 45001 fallback pack — used when GPS detection
 * resolves outside the supported LATAM bounding boxes and `navigator.language`
 * doesn't match either.
 */
export function getDefaultPack(): CountryPack {
  return COUNTRY_PACKS.ISO;
}

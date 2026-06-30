// Sprint 28 Bucket B1 — Registry orquestador.
//
// Compone el baseline ISO 45001 con los adaptadores por jurisdicción.
// La regla maestra: ISO 45001 SIEMPRE está activa. País específico se
// añade cuando el tenant lo declara.

import type {
  ComplianceControl,
  JurisdictionCode,
  RegulationRef,
} from './types.js';
import { ISO_45001_BY_ID, ISO_45001_CONTROLS } from './iso45001.js';
import { CL_REFERENCES } from './jurisdictions/cl.js';
import { US_OSHA_REFERENCES } from './jurisdictions/us-osha.js';
import { EU_REFERENCES } from './jurisdictions/eu.js';
import { MX_REFERENCES } from './jurisdictions/mx.js';
import { BR_REFERENCES } from './jurisdictions/br.js';
import { UK_REFERENCES } from './jurisdictions/uk.js';
import { CA_REFERENCES } from './jurisdictions/ca.js';
import { AU_REFERENCES } from './jurisdictions/au.js';
import { JP_REFERENCES } from './jurisdictions/jp.js';
import { KR_REFERENCES } from './jurisdictions/kr.js';
import { IN_REFERENCES } from './jurisdictions/in.js';
import { CN_REFERENCES } from './jurisdictions/cn.js';
import { TW_REFERENCES } from './jurisdictions/tw.js';
import { RU_REFERENCES } from './jurisdictions/ru.js';
import type { TierId } from '../pricing/tiers.js';
import { getMaxJurisdictionsForTier } from '../pricing/jurisdictionLimits.js';

const JURISDICTION_TABLE: Partial<
  Record<JurisdictionCode, Record<string, RegulationRef[]>>
> = {
  CL: CL_REFERENCES,
  'US-OSHA': US_OSHA_REFERENCES,
  EU: EU_REFERENCES,
  MX: MX_REFERENCES,
  BR: BR_REFERENCES,
  UK: UK_REFERENCES,
  CA: CA_REFERENCES,
  AU: AU_REFERENCES,
  JP: JP_REFERENCES,
  KR: KR_REFERENCES,
  IN: IN_REFERENCES,
  CN: CN_REFERENCES,
  TW: TW_REFERENCES,
  RU: RU_REFERENCES,
};

/**
 * Mapeo país (ISO 3166-1 alpha-2 o alias informal) →
 * `JurisdictionCode` específico. Países del bloque UE colapsan a 'EU'.
 */
const COUNTRY_TO_JURISDICTION: Record<string, JurisdictionCode> = {
  CL: 'CL',
  CHILE: 'CL',
  US: 'US-OSHA',
  USA: 'US-OSHA',
  'US-OSHA': 'US-OSHA',
  MX: 'MX',
  MEXICO: 'MX',
  BR: 'BR',
  BRAZIL: 'BR',
  BRASIL: 'BR',
  // Bloque EU (no exhaustivo; añadir según onboarding).
  ES: 'EU',
  FR: 'EU',
  DE: 'EU',
  IT: 'EU',
  PT: 'EU',
  NL: 'EU',
  BE: 'EU',
  IE: 'EU',
  AT: 'EU',
  EU: 'EU',
  // Sprint 29 EE — UK post-Brexit, jurisdicción separada (HSE regulator).
  GB: 'UK',
  UK: 'UK',
  'UNITED-KINGDOM': 'UK',
  // Sprint 29 EE — Canadá (federal CCOHS/COHSR + Ontario/Quebec mention).
  CA: 'CA',
  CAN: 'CA',
  CANADA: 'CA',
  // Sprint 29 EE — Australia (modelo armonizado WHS Act 2011).
  AU: 'AU',
  AUS: 'AU',
  AUSTRALIA: 'AU',
  // Sprint 31 NN — Asia-Pacific tier (Japan, Korea, India).
  JP: 'JP',
  JPN: 'JP',
  JAPAN: 'JP',
  KR: 'KR',
  KOR: 'KR',
  KOREA: 'KR',
  'SOUTH-KOREA': 'KR',
  IN: 'IN',
  IND: 'IN',
  INDIA: 'IN',
  // Sprint 31 SS — APAC tier global (China + Taiwan + Russia).
  // China (mainland PRC). MEM como regulator. Data residency separate.
  CN: 'CN',
  CHN: 'CN',
  CHINA: 'CN',
  'MAINLAND-CHINA': 'CN',
  // Taiwan — jurisdicción y data residency separadas de PRC (NO mapear a CN).
  TW: 'TW',
  TWN: 'TW',
  TAIWAN: 'TW',
  'REPUBLIC-OF-CHINA': 'TW',
  ROC: 'TW',
  // Russia — Rostrud regulator.
  RU: 'RU',
  RUS: 'RU',
  RUSSIA: 'RU',
  'RUSSIAN-FEDERATION': 'RU',
};

export interface TenantRegulatoryContext {
  /** Código de país (alpha-2 preferido). */
  country?: string;
  /** Residencia de datos cuando difiere del país operativo. */
  dataResidency?: string;
  /**
   * Sprint 31 OO — País(es) adicionales que el tenant declara. Sólo se
   * activan si el tier los permite (ver `tier` y los límites en
   * `services/pricing/jurisdictionLimits`).
   */
  extraCountries?: string[];
}

/**
 * Devuelve siempre `['ISO-45001', countrySpecific?]`. Si el país no se
 * reconoce, cae al baseline ISO 45001 únicamente.
 *
 * Sprint 31 OO — Si se pasa `tier`, respeta el límite del tier para
 * jurisdicciones adicionales (`extraCountries`). Tiers no globales
 * ignoran `extraCountries` (limit = 1) — ISO 45001 + país nativo es
 * todo lo que se activa.
 */
export function getActiveJurisdictions(
  ctx: TenantRegulatoryContext,
  tier?: TierId,
): JurisdictionCode[] {
  const result: JurisdictionCode[] = ['ISO-45001'];
  const candidate = (ctx.country ?? ctx.dataResidency ?? '').trim().toUpperCase();
  if (candidate) {
    const mapped = COUNTRY_TO_JURISDICTION[candidate];
    if (mapped && mapped !== 'ISO-45001' && !result.includes(mapped)) {
      result.push(mapped);
    }
  }

  // Sprint 31 OO — extra jurisdictions, gated by tier limit.
  if (tier && ctx.extraCountries?.length) {
    const limit = getMaxJurisdictionsForTier(tier);
    let used = result.filter((j) => j !== 'ISO-45001').length;
    for (const raw of ctx.extraCountries) {
      const norm = raw.trim().toUpperCase();
      const mapped = COUNTRY_TO_JURISDICTION[norm];
      if (!mapped || mapped === 'ISO-45001') continue;
      if (result.includes(mapped)) continue;
      if (used >= limit) break;
      result.push(mapped);
      used += 1;
    }
  }

  return result;
}

/**
 * Sprint 31 OO — Tenant-level gate. Devuelve `true` si el tenant del
 * tier dado puede citar regulaciones de la jurisdicción `juris`.
 *
 * Reglas:
 *  - ISO 45001 siempre permitido (baseline universal).
 *  - País nativo del tenant (resuelto vía `country`/`dataResidency`)
 *    siempre permitido.
 *  - Jurisdicciones adicionales sólo permitidas si el tier soporta
 *    multi-jurisdicción (ej. `global-titanio`).
 */
export function assertTenantHasJurisdiction(
  ctx: TenantRegulatoryContext,
  juris: JurisdictionCode,
  tier: TierId,
): boolean {
  if (juris === 'ISO-45001') return true;

  const native = (ctx.country ?? ctx.dataResidency ?? '').trim().toUpperCase();
  const nativeMapped = native ? COUNTRY_TO_JURISDICTION[native] : undefined;
  if (nativeMapped === juris) return true;

  // Beyond the native jurisdicción: only if the tier expands the limit
  // past 1 (i.e. global-titanio or any future multi-jurisdiction tier).
  const limit = getMaxJurisdictionsForTier(tier);
  if (limit <= 1) return false;

  const active = getActiveJurisdictions(ctx, tier);
  return active.includes(juris);
}

/**
 * Orden estable: ISO 45001 primero, luego el resto en orden alfabético
 * por código de jurisdicción. Las referencias dentro de la misma
 * jurisdicción mantienen el orden del adaptador.
 */
function sortReferences(refs: RegulationRef[]): RegulationRef[] {
  const isoFirst = refs.filter((r) => r.jurisdiction === 'ISO-45001');
  const rest = refs
    .filter((r) => r.jurisdiction !== 'ISO-45001')
    .slice()
    .sort((a, b) => {
      if (a.jurisdiction !== b.jurisdiction) {
        return a.jurisdiction.localeCompare(b.jurisdiction);
      }
      return 0;
    });
  return [...isoFirst, ...rest];
}

/**
 * Concatena las referencias del baseline ISO 45001 con las
 * jurisdicciones activas para un control dado.
 */
export function getReferencesForControl(
  controlId: string,
  jurisdictions: JurisdictionCode[],
): RegulationRef[] {
  const base = ISO_45001_BY_ID[controlId];
  const collected: RegulationRef[] = [];

  if (base && jurisdictions.includes('ISO-45001')) {
    collected.push(...base.references);
  }

  for (const j of jurisdictions) {
    if (j === 'ISO-45001') continue;
    const table = JURISDICTION_TABLE[j];
    if (!table) continue;
    const refs = table[controlId];
    if (refs?.length) collected.push(...refs);
  }

  return sortReferences(collected);
}

/**
 * Devuelve el control resuelto con las referencias unidas para la
 * combinación de jurisdicciones dada. Útil para UIs que necesitan
 * `title` + `iso45001Clause` + lista de citas.
 */
export function resolveControl(
  controlId: string,
  jurisdictions: JurisdictionCode[],
): ComplianceControl | undefined {
  const base = ISO_45001_BY_ID[controlId];
  if (!base) return undefined;
  return {
    ...base,
    references: getReferencesForControl(controlId, jurisdictions),
  };
}

export interface CiteOptions {
  jurisdictions: JurisdictionCode[];
  /** Cuando true, devuelve sólo strings ya formateados:
   *  "DS-44 (ex DS 54, derogado 01-02-2025) (Chile) · ISO 45001 §5.4". */
  format?: 'short' | 'long';
}

const JURISDICTION_LABEL: Record<JurisdictionCode, string> = {
  'ISO-45001': 'ISO',
  CL: 'Chile',
  'US-OSHA': 'US-OSHA',
  EU: 'EU',
  MX: 'México',
  BR: 'Brasil',
  UK: 'UK',
  CA: 'Canadá',
  AU: 'Australia',
  JP: 'Japón',
  KR: 'Corea',
  IN: 'India',
  CN: 'China',
  TW: 'Taiwán',
  RU: 'Rusia',
};

function formatRef(ref: RegulationRef, format: 'short' | 'long'): string {
  const label = JURISDICTION_LABEL[ref.jurisdiction] ?? ref.jurisdiction;
  if (format === 'long') {
    return `${ref.code} — ${ref.title} (${label})`;
  }
  // short: "DS-44 (Chile)" (ex DS 54, derogado) / "ISO-45001:5.4"
  if (ref.jurisdiction === 'ISO-45001') return ref.code;
  return `${ref.code} (${label})`;
}

/**
 * Snippets de cita para mostrar en UI. Cada string lista una norma.
 * Ejemplo:
 *   cite('WORKER_PARTICIPATION', { jurisdictions: ['ISO-45001', 'CL'] })
 *   → ['ISO-45001:5.4', 'DS-44 (Chile)']  // DS-44 reemplaza al ex DS 54, derogado 01-02-2025
 */
export function cite(controlId: string, opts: CiteOptions): string[] {
  const format = opts.format ?? 'short';
  const refs = getReferencesForControl(controlId, opts.jurisdictions);
  return refs.map((r) => formatRef(r, format));
}

/** Lista todos los controles ISO 45001 conocidos (lectura). */
export function listControls(): ComplianceControl[] {
  return ISO_45001_CONTROLS.slice();
}

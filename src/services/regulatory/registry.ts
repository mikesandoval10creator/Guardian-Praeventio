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

const JURISDICTION_TABLE: Partial<
  Record<JurisdictionCode, Record<string, RegulationRef[]>>
> = {
  CL: CL_REFERENCES,
  'US-OSHA': US_OSHA_REFERENCES,
  EU: EU_REFERENCES,
  MX: MX_REFERENCES,
  BR: BR_REFERENCES,
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
};

export interface TenantRegulatoryContext {
  /** Código de país (alpha-2 preferido). */
  country?: string;
  /** Residencia de datos cuando difiere del país operativo. */
  dataResidency?: string;
}

/**
 * Devuelve siempre `['ISO-45001', countrySpecific?]`. Si el país no se
 * reconoce, cae al baseline ISO 45001 únicamente.
 */
export function getActiveJurisdictions(
  ctx: TenantRegulatoryContext,
): JurisdictionCode[] {
  const result: JurisdictionCode[] = ['ISO-45001'];
  const candidate = (ctx.country ?? ctx.dataResidency ?? '').trim().toUpperCase();
  if (!candidate) return result;
  const mapped = COUNTRY_TO_JURISDICTION[candidate];
  if (mapped && mapped !== 'ISO-45001' && !result.includes(mapped)) {
    result.push(mapped);
  }
  return result;
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
   *  "DS 54 art.21 (Chile) · ISO 45001 §5.4". */
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
};

function formatRef(ref: RegulationRef, format: 'short' | 'long'): string {
  const label = JURISDICTION_LABEL[ref.jurisdiction] ?? ref.jurisdiction;
  if (format === 'long') {
    return `${ref.code} — ${ref.title} (${label})`;
  }
  // short: "DS-54 (Chile)" / "ISO-45001:5.4"
  if (ref.jurisdiction === 'ISO-45001') return ref.code;
  return `${ref.code} (${label})`;
}

/**
 * Snippets de cita para mostrar en UI. Cada string lista una norma.
 * Ejemplo:
 *   cite('WORKER_PARTICIPATION', { jurisdictions: ['ISO-45001', 'CL'] })
 *   → ['ISO-45001:5.4', 'DS-54 (Chile)']
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

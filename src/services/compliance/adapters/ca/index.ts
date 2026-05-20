// Praeventio Guard — Bloque 7 (D-COMPL-CA): Canada compliance adapter scaffold.
//
// Esqueleto navegable per ADR-0017 (Per-country emission adapters,
// doc-only, no push).
//
// Normativa Canadá clave (Sprint 41 target):
//   - WHMIS 2015 (Workplace Hazardous Materials Information System)
//   - CCOHS (Canadian Centre for Occupational Health and Safety)
//   - Federal: Canada Labour Code Part II
//   - Provincial (cada provincia tiene su propia OHS regulation):
//     · Ontario: OHSA + Regulation 833 (1990)
//     · Quebec: LSST + RSST (artículos en Norme du travail)
//     · BC: Workers Compensation Act + OHS Regulation
//     · Alberta: OHS Act + Code 2018
//   - Notice of injury: Form 7 (provincial WCB)
//
// Reglas durables del usuario:
//   1. NO push a WCB provincial — empresa cliente entrega.
//   2. Form 7 deadline: 72 hours from injury awareness.
//   3. Documentos bilingües (EN + FR) en Quebec.

import { AdapterNotImplementedError } from '../jurisdictionErrors.js';

export const CA_JURISDICTION_META = {
  country: 'CA' as const,
  regulator: 'CCOHS + Provincial WCBs',
  language: 'en-CA',
  altLanguage: 'fr-CA',
  currency: 'CAD',
  reportingFramework: 'WHMIS-2015 + Form-7-WCB',
  references: {
    CCOHS: 'https://www.ccohs.ca/',
    WHMIS: 'https://www.canada.ca/en/health-canada/services/environmental-workplace-health/occupational-health-safety/whmis.html',
    CanadaLabourCode: 'https://laws-lois.justice.gc.ca/eng/acts/L-2/',
    OntarioOHSA: 'https://www.ontario.ca/laws/statute/90o01',
    QuebecLSST: 'https://www.legisquebec.gouv.qc.ca/en/document/cs/S-2.1',
    BCWorkersComp: 'https://www.worksafebc.com/en/law-policy/occupational-health-safety/searchable-ohs-regulation',
    AlbertaOHS: 'https://open.alberta.ca/publications/9780779827855',
  },
  reportingDeadlines: {
    fatalInjury: 'PT24H',
    seriousInjury: 'PT72H',
    minorInjury: 'P3D',
    dangerousOccurrence: 'PT72H',
    occupationalDisease: 'P30D',
  },
  provinces: ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU'] as const,
} as const;

/** Generator de Form 7 (WCB Notice of Injury). Pendiente Sprint 41. */
export function generateForm7(): never {
  throw new AdapterNotImplementedError(
    'CA',
    'WCB Form 7 generator pendiente — incluir branching provincial (ON/QC/BC/AB)',
  );
}

export function signForm7(): never {
  throw new AdapterNotImplementedError(
    'CA',
    'Form 7 signer pendiente — patrón susesoService a replicar',
  );
}

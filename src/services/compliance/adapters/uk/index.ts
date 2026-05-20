// Praeventio Guard — Bloque 7 (D-COMPL-UK): UK compliance adapter scaffold.
//
// Esqueleto navegable per ADR-0017 (Per-country emission adapters,
// doc-only, no push). NO implementa generators aún — solo expone metadata
// + throw AdapterNotImplementedError para que callers tengan ramificación
// limpia hasta que escritorio con skills implemente generators reales.
//
// Normativa UK clave (Sprint 40 target):
//   - HSE (Health and Safety Executive) — regulador nacional
//   - RIDDOR 2013 (Reporting of Injuries, Diseases and Dangerous Occurrences)
//     → equivalente DIAT/DIEP en Chile
//   - HSWA 1974 (Health and Safety at Work Act) — marco general
//   - COSHH 2002 (Control of Substances Hazardous to Health)
//   - CDM Regulations 2015 (Construction Design and Management)
//   - PUWER 1998 (Provision and Use of Work Equipment Regulations)
//
// Reglas durables del usuario para este adapter:
//   1. NO push a HSE — empresa cliente entrega vía portal HSE oficial.
//   2. RIDDOR fatal/specified injuries: reporte ≤10 días naturales.
//   3. Dangerous occurrences: reporte ≤10 días.
//   4. Over-7-day injuries: reporte ≤15 días naturales.
//   5. Documentos en inglés (UK English).

import { AdapterNotImplementedError } from '../jurisdictionErrors.js';

export const UK_JURISDICTION_META = {
  country: 'UK' as const,
  regulator: 'HSE',
  language: 'en-GB',
  currency: 'GBP',
  reportingFramework: 'RIDDOR-2013',
  references: {
    HSE: 'https://www.hse.gov.uk/',
    RIDDOR: 'https://www.hse.gov.uk/riddor/',
    HSWA: 'https://www.legislation.gov.uk/ukpga/1974/37',
    COSHH: 'https://www.legislation.gov.uk/uksi/2002/2677',
    CDM: 'https://www.legislation.gov.uk/uksi/2015/51',
    PUWER: 'https://www.legislation.gov.uk/uksi/1998/2306',
  },
  reportingDeadlines: {
    fatalInjury: 'P10D',
    specifiedInjury: 'P10D',
    dangerousOccurrence: 'P10D',
    over7DayInjury: 'P15D',
    occupationalDisease: 'P10D',
  },
} as const;

/**
 * Generator de RIDDOR (equivalente DIAT chileno). Pendiente Sprint 40
 * según ADR-0017.
 *
 * TODO Bloque 7 frontend (desktop con skills):
 *   - Tipos `RiddorIncidentReport` (sections F2508 + F2508A/F2508G)
 *   - PDF renderer reusing diatPdfRenderer pattern
 *   - Folio generator (HSE asigna ID al recibir; aquí emitimos folio
 *     interno trazable)
 */
export function generateRiddor(): never {
  throw new AdapterNotImplementedError(
    'UK',
    'RIDDOR generator pendiente — ver Bloque 7 frontend (desktop con skills)',
  );
}

export function signRiddorForm(): never {
  throw new AdapterNotImplementedError(
    'UK',
    'RIDDOR signer pendiente — patrón susesoService a replicar',
  );
}

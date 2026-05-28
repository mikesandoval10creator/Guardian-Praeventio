// Praeventio Guard — Bloque 7 (D-COMPL-AU): Australia compliance adapter scaffold.
//
// Esqueleto navegable per ADR-0017.
//
// Normativa Australia clave (Sprint 42 target):
//   - WHS Act 2011 (Work Health and Safety Act, model harmonizado entre
//     estados — implementado en NSW/QLD/SA/TAS/ACT/NT; VIC y WA mantienen
//     legislación propia)
//   - WHS Regulations 2011 + Codes of Practice
//   - Safe Work Australia — regulador federal model
//   - State regulators: SafeWork NSW, WorkSafe Victoria, WorkSafe QLD,
//     SafeWork SA, WorkSafe WA, WorkSafe Tasmania
//   - Notifiable incidents: deaths + serious injury + dangerous incidents
//   - Notification deadline: immediate (verbal) + 48h (written) per WHS s.38
//
// Reglas durables del usuario:
//   1. NO push a SafeWork — empresa cliente entrega vía portal estatal.
//   2. Notificación verbal inmediata + escrita 48h después.
//   3. Documentos en inglés (Australian English).

import { AdapterNotImplementedError } from '../jurisdictionErrors.js';

export const AU_JURISDICTION_META = {
  country: 'AU' as const,
  regulator: 'Safe Work Australia + state regulators',
  language: 'en-AU',
  currency: 'AUD',
  reportingFramework: 'WHS-2011 + Notifiable-Incidents',
  references: {
    SafeWorkAustralia: 'https://www.safeworkaustralia.gov.au/',
    WHSAct: 'https://www.legislation.gov.au/C2011A00137/latest/text',
    WHSRegulations: 'https://www.legislation.gov.au/F2011L02664/latest/text',
    SafeWorkNSW: 'https://www.safework.nsw.gov.au/',
    WorkSafeVic: 'https://www.worksafe.vic.gov.au/',
    WorkSafeQLD: 'https://www.worksafe.qld.gov.au/',
    SafeWorkSA: 'https://www.safework.sa.gov.au/',
  },
  reportingDeadlines: {
    fatalInjury: 'IMMEDIATE',
    notifiableIncident_verbal: 'IMMEDIATE',
    notifiableIncident_written: 'PT48H',
    seriousInjury: 'IMMEDIATE',
    occupationalDisease: 'P30D',
  },
  states: ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const,
} as const;

/** Generator de Notifiable Incident Report. Pendiente Sprint 42. */
export function generateNotifiableIncident(): never {
  throw new AdapterNotImplementedError(
    'AU',
    'Notifiable Incident generator pendiente — branching per state regulator',
  );
}

export function signNotifiableIncident(): never {
  throw new AdapterNotImplementedError(
    'AU',
    'Notifiable Incident signer pendiente — patrón susesoService a replicar',
  );
}

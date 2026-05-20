// Praeventio Guard — Bloque 7 (D-COMPL-IN): India compliance adapter scaffold.
//
// Esqueleto navegable per ADR-0017.
//
// Normativa India clave (Sprint 45 target):
//   - Factories Act 1948 (refundido por Occupational Safety, Health
//     and Working Conditions Code 2020 — OSHWC, en implementación
//     gradual estatal)
//   - Industrial Disputes Act 1947
//   - Mines Act 1952 (sector minero)
//   - Building and Other Construction Workers Act 1996
//   - Workmen Compensation Act 1923 (refundido a Employees'
//     Compensation Act 2010)
//   - Regulador: DGFASLI (Directorate General Factory Advice Service
//     and Labour Institutes) + state factory inspectorates
//   - Reportes obligatorios:
//     · Form 18 (Accident Report — Factories Act sec. 88)
//     · Form 30 (Special Notice of Disease — sec. 89)
//
// Reglas durables del usuario:
//   1. NO push a Labour Inspector — empresa cliente entrega.
//   2. Form 18 deadline: 24h notification + Form 30 for diseases.
//   3. Documentos en inglés (lingua franca administrativa) + idioma
//      regional cuando aplique (Hindi/Tamil/Telugu/etc.).
//   4. Branching estatal: Maharashtra/Gujarat/TN/Karnataka tienen
//      adopción más temprana OSHWC; Bihar/UP siguen Factories Act 1948.

import { AdapterNotImplementedError } from '../jurisdictionErrors.js';

export const IN_JURISDICTION_META = {
  country: 'IN' as const,
  regulator: 'DGFASLI + state factory inspectorates',
  language: 'en-IN',
  altLanguages: ['hi-IN', 'ta-IN', 'te-IN', 'bn-IN', 'mr-IN'] as const,
  currency: 'INR',
  reportingFramework: 'FactoriesAct-1948 + OSHWC-2020',
  references: {
    DGFASLI: 'https://dgfasli.gov.in/',
    FactoriesAct: 'https://labour.gov.in/sites/default/files/factories_act_1948.pdf',
    OSHWC: 'https://labour.gov.in/sites/default/files/OSH_Code.pdf',
    MinesAct: 'https://labour.gov.in/mines',
    BOCWA: 'https://labour.gov.in/bocw-act-1996',
  },
  reportingDeadlines: {
    fatalInjury: 'PT24H',
    seriousInjury: 'PT24H',
    minorInjury: 'P7D',
    occupationalDisease: 'P30D',
    dangerousOccurrence: 'PT24H',
  },
  states: [
    'MH', 'GJ', 'TN', 'KA', 'AP', 'TS', 'WB', 'UP', 'BR', 'OD',
    'RJ', 'MP', 'PB', 'HR', 'KL', 'CG', 'JH', 'UK', 'AS', 'JK',
    'HP', 'GA', 'ML', 'MN', 'NL', 'MZ', 'TR', 'AR', 'SK',
  ] as const,
} as const;

/** Generator de Form 18 (Accident Report). Pendiente Sprint 45. */
export function generateForm18(): never {
  throw new AdapterNotImplementedError(
    'IN',
    'Form 18 generator pendiente — branching estatal Factories Act vs OSHWC 2020',
  );
}

export function signForm18(): never {
  throw new AdapterNotImplementedError(
    'IN',
    'Form 18 signer pendiente — Aadhaar eSign o WebAuthn',
  );
}

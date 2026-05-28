// Praeventio Guard — Bloque 7 (D-COMPL-KR): Korea compliance adapter scaffold.
//
// Esqueleto navegable per ADR-0017.
//
// Normativa Corea del Sur clave (Sprint 44 target):
//   - Occupational Safety and Health Act (산업안전보건법 — OSHA 1981, revisado 2024)
//   - Serious Accidents Punishment Act (중대재해처벌법 — SAPA 2022)
//     → cambio paradigmático: penal a representantes corporativos
//   - Industrial Accident Compensation Insurance Act (산업재해보상보험법)
//   - Regulador: KOSHA (Korea Occupational Safety and Health Agency)
//     + MOEL (Ministry of Employment and Labor 고용노동부)
//   - Reportes:
//     · 산업재해조사표 (Industrial Accident Investigation Table)
//     · 중대재해 신고 (Serious accident notification)
//
// Reglas durables del usuario:
//   1. NO push a MOEL — empresa cliente entrega vía portal local.
//   2. SAPA 2022: alta exposure legal a CEO/director — adapter debe
//      tener trazabilidad inmutable + audit log con hash chain.
//   3. Reporte serious accident: ≤8 days written.
//   4. Documentos en coreano (한국어): nombres en romanization + hangul.

import { AdapterNotImplementedError } from '../jurisdictionErrors.js';

export const KR_JURISDICTION_META = {
  country: 'KR' as const,
  regulator: 'KOSHA + MOEL',
  language: 'ko-KR',
  altLanguage: 'en-KR',
  currency: 'KRW',
  reportingFramework: 'OSHA-1981 + SAPA-2022',
  references: {
    KOSHA: 'https://www.kosha.or.kr/',
    MOEL: 'https://www.moel.go.kr/',
    OSHA: 'https://elaw.klri.re.kr/eng_service/lawView.do?hseq=39872&lang=ENG',
    SAPA: 'https://elaw.klri.re.kr/eng_service/lawView.do?hseq=58361&lang=ENG',
  },
  reportingDeadlines: {
    fatalInjury: 'IMMEDIATE',
    seriousAccident_written: 'P8D',
    nonSeriousInjury: 'P30D',
    occupationalDisease: 'P30D',
  },
  sapaApplicability: {
    minWorkers: 5,
    fatalAccident: 'CEO/director_criminal_liability',
    multipleInjury: 'CEO/director_criminal_liability',
  },
} as const;

/** Generator de Industrial Accident Investigation Table. Pendiente Sprint 44. */
export function generateAccidentInvestigation(): never {
  throw new AdapterNotImplementedError(
    'KR',
    'Accident Investigation generator pendiente — branching SAPA threshold',
  );
}

export function signAccidentInvestigation(): never {
  throw new AdapterNotImplementedError(
    'KR',
    'Accident signer pendiente — i-PIN o WebAuthn',
  );
}

// Praeventio Guard — Bloque 7 (D-COMPL-JP): Japan compliance adapter scaffold.
//
// Esqueleto navegable per ADR-0017.
//
// Normativa Japón clave (Sprint 43 target):
//   - Industrial Safety and Health Act (労働安全衛生法 — ISHA 1972)
//   - Industrial Accident Compensation Insurance Act (労災保険法)
//   - Notification: 労働者死傷病報告 (Roudousha Shishou-byou Houkoku)
//     → equivalente DIAT chileno
//   - Regulador: Ministry of Health, Labour and Welfare (MHLW 厚生労働省)
//     + Labour Standards Inspection Offices (労働基準監督署)
//   - Industria-specific: 建設業 (construcción), 製造業 (manufactura),
//     林業 (forestal), 鉱業 (minería)
//
// Reglas durables del usuario:
//   1. NO push a MHLW — empresa cliente entrega vía Inspección Laboral.
//   2. Reporte ≤1 mes después incident para lesiones >4 días incapacidad.
//   3. Reporte inmediato para fatalidades + >3 lesionados simultáneos.
//   4. Documentos en japonés (要件): nombres en romaji + kanji cuando aplique.
//   5. Considerar 36協定 (Article 36 agreements) en horas extras.

import { AdapterNotImplementedError } from '../jurisdictionErrors.js';

export const JP_JURISDICTION_META = {
  country: 'JP' as const,
  regulator: 'MHLW + Labour Standards Inspection Offices',
  language: 'ja-JP',
  altLanguage: 'en-JP',
  currency: 'JPY',
  reportingFramework: 'ISHA-1972 + Roudousha-Shishou-byou-Houkoku',
  references: {
    MHLW: 'https://www.mhlw.go.jp/',
    ISHA: 'https://www.japaneselawtranslation.go.jp/en/laws/view/2473/en',
    LaborStandardsAct: 'https://www.japaneselawtranslation.go.jp/en/laws/view/3567',
    AccidentReporting: 'https://www.mhlw.go.jp/bunya/roudoukijun/anzeneisei36.html',
  },
  reportingDeadlines: {
    fatalInjury: 'IMMEDIATE',
    multipleInjuries: 'IMMEDIATE',
    injuryOver4Days: 'P30D',
    occupationalDisease: 'P30D',
  },
  industries: ['建設業', '製造業', '林業', '鉱業', 'サービス業'] as const,
} as const;

/** Generator de 労働者死傷病報告. Pendiente Sprint 43. */
export function generateRoudoushaHoukoku(): never {
  throw new AdapterNotImplementedError(
    'JP',
    '労働者死傷病報告 generator pendiente — incluir input romaji+kanji',
  );
}

export function signRoudoushaHoukoku(): never {
  throw new AdapterNotImplementedError(
    'JP',
    'Houkoku signer pendiente — hanko (印鑑) digital o WebAuthn',
  );
}

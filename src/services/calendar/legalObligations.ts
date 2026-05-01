/**
 * Chilean SST normative cadences.
 *
 * Pure module — no IO, no Date.now() usage. All inputs are explicit so the
 * rule engine in predictions.ts can reason deterministically.
 *
 * Sources cited per rule:
 *  - DS 54: Reglamento de Comités Paritarios (sesión mensual obligatoria).
 *  - Ley 16.744 + DS 40: Obligación de Informar (ODI) periódica.
 *  - ISO 45001 cláusula 9.3: revisión por la dirección al menos anualmente.
 *  - NT MINSAL TMERT/PREXOR: vigilancia médica audiométrica anual; se
 *    adelanta a 6 meses cuando la dosis de ruido supera 100 % del valor
 *    límite permisible.
 *  - DS 40 art. 21: revisión periódica de matrices IPER.
 */

export type ObligationKind =
  | 'cphs-meeting'
  | 'odi-training'
  | 'audiometria-prexor'
  | 'iper-review'
  | 'management-review-iso45001'
  | 'climate-risk-review';

export interface ObligationContext {
  /** Audiometric / noise dose as a percentage of TLV (100 = límite). */
  dosePercent?: number;
}

export interface DueDateResult {
  dueDate: Date;
  legalReference: string;
  /** Days from lastDate that the rule resolved to (after any acceleration). */
  cadenceDays: number;
}

interface RuleSpec {
  cadenceDays: number;
  legalReference: string;
}

const BASE_RULES: Record<ObligationKind, RuleSpec> = {
  'cphs-meeting': {
    cadenceDays: 30,
    legalReference: 'DS 54 art. 16 (sesión mensual del Comité Paritario)',
  },
  'odi-training': {
    cadenceDays: 180,
    legalReference: 'Ley 16.744 + DS 40 art. 21 (ODI semestral)',
  },
  'audiometria-prexor': {
    cadenceDays: 365,
    legalReference: 'NT MINSAL PREXOR (vigilancia audiométrica anual)',
  },
  'iper-review': {
    cadenceDays: 180,
    legalReference: 'DS 40 art. 21 (revisión periódica de IPER)',
  },
  'management-review-iso45001': {
    cadenceDays: 365,
    legalReference: 'ISO 45001 cláusula 9.3 (revisión por la dirección anual)',
  },
  'climate-risk-review': {
    cadenceDays: 90,
    legalReference: 'DS 594 + boletín climático regional (revisión trimestral de riesgos climáticos)',
  },
};

export function getLegalReference(kind: ObligationKind): string {
  return BASE_RULES[kind].legalReference;
}

export function getNextDueDate(
  kind: ObligationKind,
  lastDate: Date,
  ctx: ObligationContext = {},
): DueDateResult {
  const rule = BASE_RULES[kind];
  let cadence = rule.cadenceDays;

  // Acceleration logic per rule.
  if (kind === 'audiometria-prexor' && (ctx.dosePercent ?? 0) > 100) {
    // PREXOR: vigilancia se adelanta de anual a semestral cuando se supera
    // el límite permisible.
    cadence = 180;
  }

  const due = new Date(lastDate);
  due.setUTCDate(due.getUTCDate() + cadence);

  return {
    dueDate: due,
    legalReference: rule.legalReference,
    cadenceDays: cadence,
  };
}

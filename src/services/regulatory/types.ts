// Sprint 28 Bucket B1 — Regulatory Framework Abstraction (ADR 0014).
//
// Tipos núcleo de la capa regulatoria. ISO 45001 actúa como baseline
// universal; cada jurisdicción añade `RegulationRef` locales sobre los
// mismos `ComplianceControl` IDs.

export type JurisdictionCode =
  | 'ISO-45001'
  | 'CL'
  | 'US-OSHA'
  | 'EU'
  | 'MX'
  | 'BR'
  | 'UK'
  | 'CA'
  | 'AU';

/**
 * Referencia a una norma concreta. Un control puede tener varias por
 * jurisdicción (ej. PPE en Chile cita DS 594 y NCh 1331).
 */
export interface RegulationRef {
  /** Código corto y estable: 'DS-54', 'OSHA-1910.132', '89/391/EEC',
   *  'ISO-45001:6.1.2', 'NOM-019-STPS'. */
  code: string;
  /** Título corto humano-legible. */
  title: string;
  jurisdiction: JurisdictionCode;
  /** Link a fuente oficial cuando exista. */
  url?: string;
  /** Qué regula, en una línea. */
  scope: string;
}

/**
 * Control HSE abstracto. El ID es simbólico y estable
 * (`PPE_HEAD_PROTECTION`, `WORKER_PARTICIPATION`, ...). El campo
 * `iso45001Clause` ancla el control al baseline universal; las
 * `references` se acumulan desde los adaptadores por jurisdicción.
 */
export interface ComplianceControl {
  /** ID simbólico estable. UPPER_SNAKE_CASE. */
  id: string;
  /** Título corto humano-legible. */
  title: string;
  /** Cláusula ISO 45001 cuando el control mapea directamente al
   *  estándar internacional (ej. '5.4', '6.1.2', '8.1'). */
  iso45001Clause?: string;
  /** Todas las normas que cubren este control, agrupadas por
   *  jurisdicción. Siempre incluye al menos la entrada ISO 45001 si el
   *  control tiene `iso45001Clause`. */
  references: RegulationRef[];
}

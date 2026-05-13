// Praeventio Guard — Sprint 41 Fase F.17: Bloqueo Soft por Requisito Faltante.
//
// Cierra Plan F.17 "Bloqueo suave por requisito faltante (override con
// audit log obligatorio uid + reason + missing + timestamp)".
//
// Política clave:
//   - NUNCA bloqueo duro automático (decisión usuario directiva 2).
//   - El sistema recomienda fuertemente con explicación clara.
//   - Override requiere razón documentada + identificación del que
//     autoriza + log auditable inmutable.
//
// 100% determinístico. Pure logic — la persistencia del audit log la
// hace el caller (Firestore).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type RequirementKind =
  | 'training'
  | 'epp'
  | 'medical_aptitude'
  | 'work_permit'
  | 'document_acknowledgement'
  | 'critical_control_verification'
  | 'license_certification';

export interface Requirement {
  id: string;
  kind: RequirementKind;
  /** Label legible. */
  label: string;
  /** Si NO cumplido bloquea la actividad. */
  isMandatory: boolean;
  /** Norma o política que la exige (citation). */
  citation?: string;
}

export type RequirementStatus =
  | 'satisfied'
  | 'missing'
  | 'expired'
  | 'in_progress'
  | 'overdue';

export interface RequirementCheck {
  requirement: Requirement;
  status: RequirementStatus;
  /** Información extra (ej. expiresAt, daysOverdue). */
  details?: Record<string, string | number | boolean>;
}

export type GateLevel = 'pass' | 'soft_block' | 'cannot_override';

export interface GateDecision {
  level: GateLevel;
  /** Requirements NO cumplidos (drives la decisión). */
  unsatisfied: RequirementCheck[];
  /** Texto human-readable que explica por qué. */
  reasoningText: string;
  /** True si el caller puede aplicar override. */
  canOverride: boolean;
}

export interface OverrideInput {
  authorizingUid: string;
  /** Texto libre con la razón del override. min 20 chars. */
  reason: string;
  /** ISO-8601 cuando se aprobó. */
  approvedAt: string;
  /** Override expira (ISO-8601). Auto-bloqueo después. */
  validUntil?: string;
}

export interface OverrideAuditEntry {
  id: string;
  gateContext: {
    actorUid: string;
    activityId: string;
    activityKind: string;
  };
  unsatisfiedRequirementIds: string[];
  authorizingUid: string;
  reason: string;
  approvedAt: string;
  validUntil?: string;
  /** Hash del entry para inmutabilidad. */
  contentHash: string;
}

export class GateOverrideError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'GateOverrideError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const MIN_OVERRIDE_REASON_LENGTH = 20;

/**
 * Requirements que NUNCA pueden ser overrideados (vida en riesgo
 * inmediato). Política directiva 2: NUNCA bloqueamos maquinaria,
 * pero podemos exigir intervención supervisor para estos casos.
 */
const CANNOT_OVERRIDE_KINDS: Set<RequirementKind> = new Set([
  'critical_control_verification',
  // Otros se pueden agregar por configuración (e.g. licencias específicas).
]);

// ────────────────────────────────────────────────────────────────────────
// Gate decision
// ────────────────────────────────────────────────────────────────────────

export function evaluateGate(checks: RequirementCheck[]): GateDecision {
  const unsatisfied = checks.filter((c) => c.status !== 'satisfied');
  if (unsatisfied.length === 0) {
    return {
      level: 'pass',
      unsatisfied: [],
      reasoningText: 'Todos los requisitos cumplidos.',
      canOverride: false,
    };
  }

  // Si hay un mandatory unsatisfied de tipo cannot_override:
  const blockingCritical = unsatisfied.find(
    (c) => c.requirement.isMandatory && CANNOT_OVERRIDE_KINDS.has(c.requirement.kind),
  );
  if (blockingCritical) {
    const reasonText = `Requisito crítico no superable sin intervención: ${blockingCritical.requirement.label}`;
    return {
      level: 'cannot_override',
      unsatisfied,
      reasoningText: reasonText,
      canOverride: false,
    };
  }

  // Resto = soft block
  const lines = unsatisfied.map((c) => {
    const tag = c.requirement.isMandatory ? 'OBLIGATORIO' : 'recomendado';
    const citation = c.requirement.citation ? ` ${c.requirement.citation}` : '';
    return `[${tag}] ${c.requirement.label} → ${c.status}${citation}`;
  });
  return {
    level: 'soft_block',
    unsatisfied,
    reasoningText: `Hay ${unsatisfied.length} requisito(s) sin cumplir:\n${lines.join('\n')}`,
    canOverride: true,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Override validation
// ────────────────────────────────────────────────────────────────────────

export interface ValidateOverrideInput {
  decision: GateDecision;
  override: OverrideInput;
}

export function validateOverride(input: ValidateOverrideInput): {
  valid: boolean;
  error?: string;
} {
  if (!input.decision.canOverride) {
    return { valid: false, error: 'gate does not allow override' };
  }
  if (!input.override.authorizingUid || input.override.authorizingUid.length === 0) {
    return { valid: false, error: 'authorizingUid required' };
  }
  if (
    !input.override.reason ||
    input.override.reason.trim().length < MIN_OVERRIDE_REASON_LENGTH
  ) {
    return {
      valid: false,
      error: `reason must be at least ${MIN_OVERRIDE_REASON_LENGTH} chars`,
    };
  }
  if (!input.override.approvedAt || !Number.isFinite(Date.parse(input.override.approvedAt))) {
    return { valid: false, error: 'approvedAt must be ISO-8601' };
  }
  return { valid: true };
}

// ────────────────────────────────────────────────────────────────────────
// Audit log construction
// ────────────────────────────────────────────────────────────────────────

export interface BuildAuditEntryInput {
  decision: GateDecision;
  override: OverrideInput;
  gateContext: OverrideAuditEntry['gateContext'];
  /** Hash function (caller provides — SHA-256 typically). */
  hashFn: (content: string) => string;
}

export function buildOverrideAuditEntry(input: BuildAuditEntryInput): OverrideAuditEntry {
  const validation = validateOverride({
    decision: input.decision,
    override: input.override,
  });
  if (!validation.valid) {
    throw new GateOverrideError('INVALID_OVERRIDE', validation.error ?? 'invalid');
  }

  const unsatisfiedIds = input.decision.unsatisfied.map((u) => u.requirement.id).sort();
  const id = `override:${input.gateContext.activityId}:${input.override.approvedAt}`;
  const canonicalContent = JSON.stringify({
    id,
    actor: input.gateContext.actorUid,
    activityId: input.gateContext.activityId,
    activityKind: input.gateContext.activityKind,
    unsatisfiedIds,
    authorizingUid: input.override.authorizingUid,
    reason: input.override.reason.trim(),
    approvedAt: input.override.approvedAt,
    validUntil: input.override.validUntil ?? null,
  });

  return {
    id,
    gateContext: input.gateContext,
    unsatisfiedRequirementIds: unsatisfiedIds,
    authorizingUid: input.override.authorizingUid,
    reason: input.override.reason.trim(),
    approvedAt: input.override.approvedAt,
    validUntil: input.override.validUntil,
    contentHash: input.hashFn(canonicalContent),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Override expiration check
// ────────────────────────────────────────────────────────────────────────

export function isOverrideStillValid(
  entry: OverrideAuditEntry,
  now: Date = new Date(),
): boolean {
  if (!entry.validUntil) return true;
  const exp = Date.parse(entry.validUntil);
  return Number.isFinite(exp) && now.getTime() < exp;
}

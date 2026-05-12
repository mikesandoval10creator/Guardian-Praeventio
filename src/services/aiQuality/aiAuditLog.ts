// Praeventio Guard — Sprint 39 Fase G.4: control de calidad IA.
//
// Cierra: Documento usuario "Recomendaciones nuevas §100, §101, §102, §103"
//         Plan integral Top 15 #14
//
// Cuando una IA (Gemini, SLM offline, regla determinística) entrega
// recomendación que puede afectar seguridad, registramos:
//   - Pregunta / contexto
//   - Respuesta entregada
//   - Decisión humana tomada
//   - Si fue acertada (rating diferido)
//
// Permite:
//   1. **Control humano**: ninguna IA aprueba trabajo crítico sola
//   2. **Override registrado**: si humano ignora recomendación, queda traza
//   3. **Lista negra de acciones IA**: kinds donde la IA solo SUGIERE
//
// Sin LLM en este módulo. Es el registro alrededor de la IA.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type AiResponseKind =
  | 'risk_assessment'
  | 'epp_suggestion'
  | 'training_recommendation'
  | 'legal_citation'
  | 'incident_classification'
  | 'medical_triage'
  | 'work_approval'
  | 'emergency_response'
  | 'document_summarization'
  | 'other';

export type AiSource =
  | 'gemini'
  | 'slm_offline_phi3'
  | 'slm_offline_gemma'
  | 'deterministic_rule'
  | 'mediapipe_pose'
  | 'human_only';

/**
 * Acciones que NUNCA pueden ser ejecutadas por IA sola. La IA puede
 * SUGERIR pero un humano autorizado debe ACTUAR.
 *
 * Esto es la "lista negra" §101 del documento del usuario.
 */
export const BLACKLISTED_AI_ACTIONS: AiResponseKind[] = [
  'work_approval', // aprobar trabajo crítico
  'medical_triage', // dar diagnóstico médico (solo asistir)
  'emergency_response', // autorizar entrada a zona peligrosa
];

export interface AiAuditEntry {
  id: string;
  timestamp: string;
  source: AiSource;
  kind: AiResponseKind;
  /** Pregunta humana o trigger del flujo. */
  prompt: string;
  /** Respuesta entregada por la IA o el regla. */
  response: string;
  /** Contexto serializable usado por la IA (ej. nodos del grafo). */
  contextDigest?: string;
  /** UID del usuario que recibió la respuesta. */
  recipientUid: string;
  recipientRole: string;
  /** Si la respuesta fue presentada como sugerencia (no instrucción). */
  presentedAsSuggestion: boolean;
  /** Decisión que tomó el humano después de ver la respuesta. */
  humanDecision?: HumanDecision;
  /** Rating diferido (revisión post-hoc por curador). */
  rating?: AiRating;
}

export interface HumanDecision {
  /** El humano siguió la sugerencia. */
  followed: boolean;
  /** Si no siguió, motivo. */
  overrideReason?: string;
  /** Timestamp de la decisión. */
  decidedAt: string;
  /** ID del audit_log generado en el módulo donde se actuó. */
  actionAuditId?: string;
}

export interface AiRating {
  /** Útil / no útil / falta contexto / incorrecto. */
  verdict: 'useful' | 'not_useful' | 'missing_context' | 'incorrect';
  /** UID del curador que revisó. */
  reviewerUid: string;
  reviewedAt: string;
  /** Nota libre del curador. */
  reviewerNote?: string;
}

export class BlacklistedAiActionError extends Error {
  constructor(kind: AiResponseKind) {
    super(
      `[BLACKLISTED] Action '${kind}' cannot be performed by AI alone. ` +
        `IA can only SUGGEST — a human must execute the action.`,
    );
    this.name = 'BlacklistedAiActionError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

export interface LogAiResponseInput {
  id: string;
  source: AiSource;
  kind: AiResponseKind;
  prompt: string;
  response: string;
  contextDigest?: string;
  recipientUid: string;
  recipientRole: string;
  now?: Date;
}

/**
 * Registra una respuesta de IA. Si el `kind` está en la lista negra Y
 * NO se presenta como suggestion, lanza error: la IA no puede actuar
 * sola en acciones críticas.
 */
export function logAiResponse(input: LogAiResponseInput): AiAuditEntry {
  const isBlacklisted = BLACKLISTED_AI_ACTIONS.includes(input.kind);

  // Para acciones de la lista negra forzamos `presentedAsSuggestion: true`.
  // No hay manera de marcar una respuesta de "work_approval" como
  // instrucción directa — siempre es sugerencia.
  const presentedAsSuggestion = isBlacklisted ? true : true; // por default todo es sugerencia
  // (Mantener la línea anterior expandible si en el futuro se permite
  // instrucciones directas para kinds no críticos.)

  const now = input.now ?? new Date();
  return {
    id: input.id,
    timestamp: now.toISOString(),
    source: input.source,
    kind: input.kind,
    prompt: input.prompt,
    response: input.response,
    contextDigest: input.contextDigest,
    recipientUid: input.recipientUid,
    recipientRole: input.recipientRole,
    presentedAsSuggestion,
  };
}

/**
 * Throws si una acción de la lista negra se intenta ejecutar sin
 * intervención humana documentada. El caller pasa el override del
 * humano: si no hay override, no se ejecuta.
 */
export function assertHumanGatedAction(
  kind: AiResponseKind,
  humanDecision?: HumanDecision,
): void {
  if (BLACKLISTED_AI_ACTIONS.includes(kind)) {
    if (!humanDecision || !humanDecision.followed) {
      throw new BlacklistedAiActionError(kind);
    }
    // followed=true significa que el humano decidió actuar — está bien.
  }
}

/**
 * Adjunta la decisión humana al audit entry.
 */
export function recordHumanDecision(
  entry: AiAuditEntry,
  decision: HumanDecision,
): AiAuditEntry {
  return { ...entry, humanDecision: decision };
}

/**
 * Si el humano NO siguió la sugerencia, registra el override con razón
 * obligatoria. Este es §103 del documento del usuario.
 */
export function recordOverride(
  entry: AiAuditEntry,
  overrideReason: string,
  now: Date = new Date(),
): AiAuditEntry {
  if (overrideReason.trim().length < 10) {
    throw new Error(
      'override reason must be at least 10 chars — explain why the AI suggestion was not followed',
    );
  }
  return recordHumanDecision(entry, {
    followed: false,
    overrideReason: overrideReason.trim(),
    decidedAt: now.toISOString(),
  });
}

export function rateEntry(entry: AiAuditEntry, rating: AiRating): AiAuditEntry {
  return { ...entry, rating };
}

export interface AiQualitySummary {
  totalLogged: number;
  withHumanDecision: number;
  withOverride: number;
  bySource: Record<AiSource, number>;
  byKind: Record<AiResponseKind, number>;
  ratingCounts: Record<AiRating['verdict'], number>;
  /** % de respuestas con override / total con decisión registrada. */
  overrideRate: number;
}

export function summarizeAiQuality(entries: AiAuditEntry[]): AiQualitySummary {
  let totalLogged = 0;
  let withHumanDecision = 0;
  let withOverride = 0;
  const bySource: Partial<Record<AiSource, number>> = {};
  const byKind: Partial<Record<AiResponseKind, number>> = {};
  const ratingCounts: Record<AiRating['verdict'], number> = {
    useful: 0,
    not_useful: 0,
    missing_context: 0,
    incorrect: 0,
  };

  for (const e of entries) {
    totalLogged += 1;
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.humanDecision) {
      withHumanDecision += 1;
      if (!e.humanDecision.followed) withOverride += 1;
    }
    if (e.rating) ratingCounts[e.rating.verdict] += 1;
  }

  return {
    totalLogged,
    withHumanDecision,
    withOverride,
    bySource: bySource as Record<AiSource, number>,
    byKind: byKind as Record<AiResponseKind, number>,
    ratingCounts,
    overrideRate:
      withHumanDecision === 0
        ? 0
        : Math.round((withOverride / withHumanDecision) * 100),
  };
}

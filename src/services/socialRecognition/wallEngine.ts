// Praeventio Guard — §12.7.3: Reconocimiento social — Muro Dinámico.
//
// Sistema gamificado de feedback peer-to-peer entre trabajadores:
//   - "Enterado y Aplicando" — un trabajador confirma que aplicó una
//     lección aprendida / capacitación / observación
//   - "Kudos de Seguridad" — supervisor / par reconoce comportamiento
//     seguro destacado
//   - "Mentor del Día" — quien transmitió know-how a otros
//
// Composable con `services/gamification/` existente (XP + badges) y
// `services/observations/` (positive observations Sprint 39 §214-215).
//
// Determinístico, sin LLM. La privacidad se respeta: usuarios pueden
// silenciar su muro o requerir aprobación supervisor antes de publicar.

export type RecognitionKind =
  | 'enterado_aplicando'
  | 'kudos_seguridad'
  | 'mentor_del_dia'
  | 'observacion_positiva'
  | 'cero_accidentes_mes';

export interface Recognition {
  /** ID único. */
  id: string;
  /** Tipo de reconocimiento. */
  kind: RecognitionKind;
  /** UID del trabajador reconocido. */
  recipientUid: string;
  /** UID del emisor (par/supervisor/sistema). */
  emitterUid: string;
  /** Comentario libre (opcional, max 500 chars). */
  comment?: string;
  /** Ref opcional: training/lesson/observation que originó. */
  originRef?: { kind: string; id: string };
  /** ISO 8601 timestamp emisión. */
  emittedAt: string;
  /** Tenant + proyecto scoping. */
  tenantId: string;
  projectId: string;
  /**
   * Visibilidad: 'public' (muro), 'team' (solo equipo trabajador),
   * 'private' (solo recipient + supervisor).
   */
  visibility: 'public' | 'team' | 'private';
  /** XP points otorgados (calculado al crear). */
  xpAwarded: number;
}

export interface WallFeedItem extends Recognition {
  /** Cantidad de likes recibidos. */
  likesCount: number;
  /** Cantidad de comments respondidos. */
  commentsCount: number;
}

// Pesos XP por tipo de reconocimiento.
const XP_BY_KIND: Record<RecognitionKind, number> = {
  enterado_aplicando: 5,
  kudos_seguridad: 15,
  mentor_del_dia: 25,
  observacion_positiva: 10,
  cero_accidentes_mes: 50,
};

const MAX_COMMENT_LENGTH = 500;
const MAX_RECOGNITIONS_PER_DAY = 10;

export class WallEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WallEngineError';
    this.code = code;
  }
}

/**
 * Valida + crea un Recognition. NO persiste — la persistencia es
 * responsabilidad del adapter (`wallFirestoreAdapter.ts` cuando se cree).
 *
 * Retorna el record listo para guardar.
 */
export function createRecognition(input: {
  id: string;
  kind: RecognitionKind;
  recipientUid: string;
  emitterUid: string;
  comment?: string;
  originRef?: Recognition['originRef'];
  emittedAt: string;
  tenantId: string;
  projectId: string;
  visibility?: Recognition['visibility'];
}): Recognition {
  // Validaciones
  if (!input.id || !input.recipientUid || !input.emitterUid) {
    throw new WallEngineError(
      'missing_required',
      'id, recipientUid, emitterUid son obligatorios',
    );
  }
  if (input.recipientUid === input.emitterUid) {
    throw new WallEngineError(
      'self_recognition_forbidden',
      'No puedes reconocerte a ti mismo',
    );
  }
  if (input.comment && input.comment.length > MAX_COMMENT_LENGTH) {
    throw new WallEngineError(
      'comment_too_long',
      `comment max ${MAX_COMMENT_LENGTH} chars (recibido ${input.comment.length})`,
    );
  }
  if (!input.emittedAt || isNaN(Date.parse(input.emittedAt))) {
    throw new WallEngineError('invalid_at', 'emittedAt debe ser ISO 8601');
  }
  if (!input.tenantId || !input.projectId) {
    throw new WallEngineError(
      'missing_scope',
      'tenantId + projectId son obligatorios',
    );
  }

  const xpAwarded = XP_BY_KIND[input.kind];
  if (xpAwarded === undefined) {
    throw new WallEngineError(
      'unknown_kind',
      `kind desconocido: ${input.kind}`,
    );
  }

  return {
    id: input.id,
    kind: input.kind,
    recipientUid: input.recipientUid,
    emitterUid: input.emitterUid,
    comment: input.comment,
    originRef: input.originRef,
    emittedAt: input.emittedAt,
    tenantId: input.tenantId,
    projectId: input.projectId,
    visibility: input.visibility ?? 'public',
    xpAwarded,
  };
}

/**
 * Rate limiting check anti-spam — no más de N reconocimientos por día
 * desde el mismo emisor. Retorna { allowed, remaining }.
 *
 * Caller debe proveer los recognitions del emisor en el día actual
 * (responsabilidad de la query Firestore).
 */
export function checkRateLimit(
  emittedToday: Recognition[],
): { allowed: boolean; remaining: number } {
  const count = emittedToday.length;
  return {
    allowed: count < MAX_RECOGNITIONS_PER_DAY,
    remaining: Math.max(0, MAX_RECOGNITIONS_PER_DAY - count),
  };
}

/**
 * Calcula XP total acumulado por un trabajador en un período.
 * Útil para leaderboard del proyecto.
 */
export function calculateRecipientXp(
  recognitions: Recognition[],
  recipientUid: string,
): number {
  return recognitions
    .filter((r) => r.recipientUid === recipientUid)
    .reduce((acc, r) => acc + r.xpAwarded, 0);
}

/**
 * Ranking top-N receptores por XP en el período.
 */
export function buildLeaderboard(
  recognitions: Recognition[],
  topN = 10,
): Array<{ uid: string; xp: number; recognitionsCount: number }> {
  const byUid = new Map<string, { xp: number; count: number }>();
  for (const r of recognitions) {
    const existing = byUid.get(r.recipientUid) ?? { xp: 0, count: 0 };
    existing.xp += r.xpAwarded;
    existing.count += 1;
    byUid.set(r.recipientUid, existing);
  }
  return Array.from(byUid.entries())
    .map(([uid, { xp, count }]) => ({ uid, xp, recognitionsCount: count }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, topN);
}

/**
 * Filtra el feed del muro según visibilidad + caller permissions.
 * Caller pasa el role (worker/supervisor/admin) y su UID.
 */
export function filterWallFeed(
  recognitions: Recognition[],
  callerUid: string,
  callerRole: 'worker' | 'supervisor' | 'admin' | string,
): Recognition[] {
  return recognitions.filter((r) => {
    // Public: cualquiera puede ver
    if (r.visibility === 'public') return true;
    // Private: solo recipient + supervisor + admin
    if (r.visibility === 'private') {
      return (
        r.recipientUid === callerUid ||
        callerRole === 'supervisor' ||
        callerRole === 'admin'
      );
    }
    // Team: visible para todos en el mismo proyecto (asumimos los
    // recognitions ya están filtrados por proyecto del query)
    if (r.visibility === 'team') return true;
    return false;
  });
}

/**
 * Helper para mostrar mensaje human-friendly del recognition en el muro.
 * NO localiza — el caller con i18n traduce las kinds.
 */
export function formatRecognitionForWall(r: Recognition): string {
  const kindLabels: Record<RecognitionKind, string> = {
    enterado_aplicando: 'aplicó una lección aprendida',
    kudos_seguridad: 'recibió Kudos de Seguridad',
    mentor_del_dia: 'fue Mentor del Día',
    observacion_positiva: 'recibió Observación Positiva',
    cero_accidentes_mes: 'celebra Cero Accidentes del Mes',
  };
  const label = kindLabels[r.kind];
  const comment = r.comment ? ` — "${r.comment}"` : '';
  return `${label}${comment} (+${r.xpAwarded} XP)`;
}

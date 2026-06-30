// Praeventio Guard — Sprint 28 Bucket B5: CPHS (Comité Paritario de Higiene
// y Seguridad) typed surface.
//
// ───────────────────────────────────────────────────────────────────────
// REGULATORY ANCHORS
// ───────────────────────────────────────────────────────────────────────
//   • DS 44/2024 (ex DS 54, Chile, MINSEGPRES, 1969, derogado 01-02-2025)
//     art. 66 — exige libro de actas formal, votación documentada, y
//     representación paritaria (3 representantes empleador + 3 trabajadores
//     como mínimo). El DS 54/1969 fue derogado por el DS 44/2024; las
//     constantes DS54_* abajo conservan el nombre legacy pero la norma
//     vigente es el DS 44/2024.
//   • ISO 45001:2018 §5.4 — "Consulta y participación de los trabajadores":
//     requiere registros formales que evidencien la participación efectiva.
//
// El audit hallazgo H29 (P1) detectó que la app menciona CPHS en strings
// (Sidebar, ModuleHub) pero NO tenía un módulo con persistencia formal
// de comités, reuniones, actas firmadas y resoluciones votadas. Este
// módulo cierra esa brecha.
//
// TODO Sprint 28 Bucket B1 — extender a otras jurisdicciones (México
// NOM-019-STPS, Brasil NR-5 CIPA, Perú Ley 29783 CSST). Cada una tiene
// su propio quórum / periodicidad / nombre; el shape `CphsCommittee` ya
// admite cualquier período pero el validador `isValidQuorum` está pinneado
// a Chile DS 44/2024 (ex DS 54, derogado 01-02-2025) hasta que el registro regulatorio del Sprint 28 B1
// exponga `getCphsRequirements(jurisdiction)`.

/** Estado de vida del comité. */
export type CphsCommitteeStatus = 'active' | 'expired' | 'dissolved';

/** Lado paritario al que representa el miembro. */
export type CphsSide = 'employer' | 'worker';

/** Rol funcional dentro del comité. */
export type CphsMemberRole = 'chair' | 'secretary' | 'representative';

/** Estado de la reunión. */
export type CphsMeetingStatus = 'scheduled' | 'held' | 'cancelled';

/** Resultado de la votación de una resolución. */
export type CphsResolutionOutcome = 'approved' | 'rejected' | 'tabled';

/** Período de mandato del comité (ISO date strings, normalmente 2 años). */
export interface CphsPeriod {
  start: string;
  end: string;
}

/** Miembro nominado del comité paritario. */
export interface CphsMember {
  uid: string;
  fullName: string;
  role: CphsMemberRole;
  side: CphsSide;
  /**
   * `true` si el miembro fue elegido (típicamente trabajadores via
   * votación), `false` si fue designado (típicamente empleadores).
   * DS 44/2024 art. 66 (ex DS 54, derogado 01-02-2025) exige que los
   * representantes de los trabajadores sean elegidos por sufragio, mientras
   * que los del empleador son designados.
   */
  elected: boolean;
}

/** Comité paritario constituido para un proyecto. */
export interface CphsCommittee {
  id: string;
  projectId: string;
  /** Período de mandato (típicamente 24 meses por DS 44/2024, ex DS 54 derogado 01-02-2025). */
  period: CphsPeriod;
  /** Mínimo 3 empresa + 3 trabajadores por DS 44/2024 art. 66 (ex DS 54, derogado 01-02-2025). */
  members: CphsMember[];
  status: CphsCommitteeStatus;
  /**
   * `true` si el quórum + representación + paridad cumplen ISO 45001 §5.4.
   * El service lo calcula al constituir y al modificar miembros; el UI
   * lo expone como insignia para que el gerente sepa si el comité es
   * "auditable" frente a una certificación.
   */
  iso45001Compliance: boolean;
  createdAt: string;
  createdBy: string;
}

/** Firma WebAuthn de un acta. */
export interface CphsSignature {
  uid: string;
  signedAt: string;
  /** WebAuthn credential id (base64url) — cruza contra webauthn_credentials. */
  credentialId: string;
  /** ECDSA assertion (base64) sobre sha256(minutes + meetingId). */
  signature: string;
}

/** Resolución votada en una reunión (acuerdo trazable). */
export interface CphsResolution {
  id: string;
  topic: string;
  vote: {
    for: number;
    against: number;
    abstain: number;
  };
  outcome: CphsResolutionOutcome;
  /** ISO date — fecha límite si la resolución es accionable. */
  dueDate?: string;
}

/** Reunión del comité (ordinaria o extraordinaria). */
export interface CphsMeeting {
  id: string;
  committeeId: string;
  /** ISO datetime — agendado a futuro o pasado. */
  scheduledAt: string;
  /** ISO datetime — quedó null hasta que el secretario marca la reunión como realizada. */
  heldAt?: string;
  /** UIDs de asistentes (subset de committee.members). */
  attendees: string[];
  /** Items de agenda (orden importa). */
  agenda: string[];
  /** Texto markdown del acta. Una vez firmada por al menos 1 miembro,
   *  el documento es immutable (mismo patrón que audit_logs). */
  minutes?: string;
  resolutions: CphsResolution[];
  signatures: CphsSignature[];
  status: CphsMeetingStatus;
}

// ───────────────────────────────────────────────────────────────────────
// Validación de quórum DS 44/2024 art. 66 (ex DS 54, derogado 01-02-2025)
// ───────────────────────────────────────────────────────────────────────

/** Miembros mínimos por lado según DS 44/2024 art. 66 (ex DS 54, derogado 01-02-2025). */
export const DS54_MIN_PER_SIDE = 3;

/**
 * Devuelve `true` si la composición de miembros cumple con DS 44/2024 art. 66
 * (ex DS 54, derogado 01-02-2025): al menos 3 representantes empleador + 3
 * representantes trabajadores, y al menos un chair y un secretary.
 *
 * NOTA: ISO 45001 §5.4 NO exige una composición numérica específica,
 * sólo "consulta efectiva". El DS 44/2024 (ex DS 54) es la norma más estricta
 * entre las dos, así que cumplir DS 44/2024 implica cumplir ISO 45001 (en Chile).
 */
export function isValidQuorum(members: readonly CphsMember[]): boolean {
  if (!Array.isArray(members) || members.length < DS54_MIN_PER_SIDE * 2) {
    return false;
  }
  const employers = members.filter((m) => m.side === 'employer').length;
  const workers = members.filter((m) => m.side === 'worker').length;
  if (employers < DS54_MIN_PER_SIDE || workers < DS54_MIN_PER_SIDE) return false;
  const hasChair = members.some((m) => m.role === 'chair');
  const hasSecretary = members.some((m) => m.role === 'secretary');
  return hasChair && hasSecretary;
}

/**
 * Devuelve `true` si todos los representantes de los trabajadores fueron
 * elegidos (`elected === true`). DS 44/2024 art. 66 (ex DS 54, derogado
 * 01-02-2025) exige que los del lado trabajador sean por sufragio; los del
 * empleador son designados (no
 * importa el flag `elected` para ese lado).
 */
export function workersAreElected(members: readonly CphsMember[]): boolean {
  return members
    .filter((m) => m.side === 'worker')
    .every((m) => m.elected === true);
}

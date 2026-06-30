// Praeventio Guard — Sprint 28 Bucket B5: CPHS service.
//
// Cierra audit hallazgo H29 P1. Persistencia formal de comités paritarios
// con quórum DS 44/2024 (ex DS 54, derogado 01-02-2025) + actas firmadas WebAuthn (ISO 27001 §A.9.4.3 +
// ISO 45001 §5.4).
//
// DESIGN
//   • Pure DI (`MinimalCphsDb`) — mismo patrón que
//     `services/curriculum/claims.ts` y `services/auth/projectMembership.ts`.
//     Los tests inyectan un fake in-memory; producción wirea
//     `admin.firestore()` desde server.ts.
//   • Subcolecciones: `cphs_committees/{id}/meetings/{id}`. La lookup de
//     meetings es por id-de-doc plano (segundo collection) más el
//     `committeeId` embebido en cada meeting — esto permite un fake
//     simple basado en Map sin necesidad de simular subcollections.
//   • Una vez que el acta tiene >= 1 firma, las únicas mutaciones
//     permitidas son APPEND a `signatures[]` (otros miembros co-firmando).
//     Ningún campo de la reunión cambia. Mismo patrón que audit_logs.
//   • Firmas WebAuthn: este service NO valida criptográficamente la
//     firma — esa verificación vive en el endpoint server-side
//     `/api/auth/webauthn/verify` (ver `webauthnCredentialStore.ts`).
//     Aquí sólo verificamos que (a) el uid esté en attendees, (b) el
//     credentialId esté presente, (c) la firma sea base64 no vacío.
//     El handler HTTP debe llamar `verifyAuthenticationResponse` antes
//     de invocar `signMinutes`.

import {
  type CphsCommittee,
  type CphsMeeting,
  type CphsMember,
  type CphsPeriod,
  type CphsResolution,
  type CphsSignature,
  isValidQuorum,
  workersAreElected,
} from './types.js';
import { awardXp } from '../gamification/positiveXp.js';

// ───────────────────────────────────────────────────────────────────────
// Firestore-shape DI
// ───────────────────────────────────────────────────────────────────────

/**
 * Subset de la API Firestore que usamos. `admin.firestore()` es
 * estructuralmente compatible.
 */
export interface MinimalCphsDb {
  collection(name: string): {
    add(data: any): Promise<{ id: string }>;
    doc(id: string): {
      get(): Promise<{ exists: boolean; id: string; data(): any }>;
      update(patch: any): Promise<void>;
    };
    where(field: string, op: '==', value: any): {
      get(): Promise<{
        empty: boolean;
        docs: Array<{ id: string; data(): any }>;
      }>;
    };
  };
}

// ───────────────────────────────────────────────────────────────────────
// Errores específicos
// ───────────────────────────────────────────────────────────────────────

export class CphsQuorumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CphsQuorumError';
  }
}

export class CphsImmutableMinutesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CphsImmutableMinutesError';
  }
}

export class CphsSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CphsSignatureError';
  }
}

// ───────────────────────────────────────────────────────────────────────
// Constantes
// ───────────────────────────────────────────────────────────────────────

const COMMITTEES_COLLECTION = 'cphs_committees';
const MEETINGS_COLLECTION = 'cphs_meetings';

// ───────────────────────────────────────────────────────────────────────
// Validadores helpers
// ───────────────────────────────────────────────────────────────────────

function validatePeriod(period: CphsPeriod): void {
  if (!period || typeof period.start !== 'string' || typeof period.end !== 'string') {
    throw new Error('period.start and period.end are required ISO date strings');
  }
  const startMs = Date.parse(period.start);
  const endMs = Date.parse(period.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error('period dates are not parseable ISO strings');
  }
  if (endMs <= startMs) {
    throw new Error('period.end must be strictly after period.start');
  }
}

function assertQuorum(members: CphsMember[]): void {
  if (!isValidQuorum(members)) {
    throw new CphsQuorumError(
      'Quórum DS 44/2024 (ex DS 54, derogado 01-02-2025) no se cumple: requiere ≥3 representantes empleador y ≥3 trabajadores, además de chair y secretary.',
    );
  }
}

// ───────────────────────────────────────────────────────────────────────
// Committees
// ───────────────────────────────────────────────────────────────────────

export interface CreateCommitteeInput {
  projectId: string;
  members: CphsMember[];
  period: CphsPeriod;
  createdBy: string;
}

export async function createCommittee(
  input: CreateCommitteeInput,
  db: MinimalCphsDb,
): Promise<CphsCommittee> {
  if (!input.projectId || typeof input.projectId !== 'string') {
    throw new Error('projectId is required');
  }
  if (!input.createdBy || typeof input.createdBy !== 'string') {
    throw new Error('createdBy is required');
  }
  validatePeriod(input.period);
  assertQuorum(input.members);

  const createdAt = new Date().toISOString();
  // ISO 45001 §5.4 = quórum DS 44/2024 (ex DS 54, derogado 01-02-2025) + representantes-trabajadores elegidos.
  const iso45001Compliance =
    isValidQuorum(input.members) && workersAreElected(input.members);

  const body: Omit<CphsCommittee, 'id'> = {
    projectId: input.projectId,
    period: { start: input.period.start, end: input.period.end },
    members: input.members,
    status: 'active',
    iso45001Compliance,
    createdAt,
    createdBy: input.createdBy,
  };

  const ref = await db.collection(COMMITTEES_COLLECTION).add(body);
  return { ...body, id: ref.id };
}

export async function getCommittee(
  committeeId: string,
  db: MinimalCphsDb,
): Promise<CphsCommittee | null> {
  const snap = await db.collection(COMMITTEES_COLLECTION).doc(committeeId).get();
  if (!snap.exists) return null;
  return { ...(snap.data() as Omit<CphsCommittee, 'id'>), id: snap.id };
}

export async function listCommittees(
  projectId: string,
  db: MinimalCphsDb,
): Promise<CphsCommittee[]> {
  const snap = await db
    .collection(COMMITTEES_COLLECTION)
    .where('projectId', '==', projectId)
    .get();
  if (snap.empty) return [];
  return snap.docs.map((d) => ({
    ...(d.data() as Omit<CphsCommittee, 'id'>),
    id: d.id,
  }));
}

// ───────────────────────────────────────────────────────────────────────
// Meetings
// ───────────────────────────────────────────────────────────────────────

export interface ScheduleMeetingInput {
  committeeId: string;
  scheduledAt: string;
  agenda: string[];
}

export async function scheduleMeeting(
  input: ScheduleMeetingInput,
  db: MinimalCphsDb,
): Promise<CphsMeeting> {
  if (!input.committeeId) throw new Error('committeeId is required');
  const ms = Date.parse(input.scheduledAt);
  if (Number.isNaN(ms)) throw new Error('scheduledAt must be an ISO datetime string');
  if (!Array.isArray(input.agenda) || input.agenda.length === 0) {
    throw new Error('agenda must be a non-empty array of items');
  }

  // Verificamos que el comité exista y esté activo.
  const committee = await getCommittee(input.committeeId, db);
  if (!committee) throw new Error(`committee ${input.committeeId} not found`);
  if (committee.status !== 'active') {
    throw new Error(`committee is ${committee.status}; cannot schedule meetings`);
  }

  const body: Omit<CphsMeeting, 'id'> = {
    committeeId: input.committeeId,
    scheduledAt: input.scheduledAt,
    attendees: [],
    agenda: input.agenda,
    resolutions: [],
    signatures: [],
    status: 'scheduled',
  };

  const ref = await db.collection(MEETINGS_COLLECTION).add(body);
  return { ...body, id: ref.id };
}

export interface RecordMinutesInput {
  meetingId: string;
  minutes: string;
  resolutions: CphsResolution[];
  attendees: string[];
}

export async function recordMinutes(
  input: RecordMinutesInput,
  db: MinimalCphsDb,
): Promise<CphsMeeting> {
  if (!input.meetingId) throw new Error('meetingId is required');
  if (typeof input.minutes !== 'string' || input.minutes.trim().length === 0) {
    throw new Error('minutes text is required');
  }
  if (!Array.isArray(input.attendees) || input.attendees.length === 0) {
    throw new Error('attendees must be a non-empty array of uids');
  }

  const docRef = db.collection(MEETINGS_COLLECTION).doc(input.meetingId);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error(`meeting ${input.meetingId} not found`);
  const meeting = snap.data() as CphsMeeting;

  // Una vez firmada, el acta es immutable. El segundo+ firmante debe
  // pasar por `signMinutes` (que sólo APPENDea a signatures[]).
  if (Array.isArray(meeting.signatures) && meeting.signatures.length > 0) {
    throw new CphsImmutableMinutesError(
      'Acta ya firmada — no se pueden modificar minutes/resolutions/attendees. Usar signMinutes() para co-firmar.',
    );
  }

  const heldAt = new Date().toISOString();
  const patch: Partial<CphsMeeting> = {
    minutes: input.minutes,
    resolutions: input.resolutions ?? [],
    attendees: input.attendees,
    status: 'held',
    heldAt,
  };

  await docRef.update(patch);

  // Sprint 32 wire W4 — gamificación POSITIVA: cada asistente firma su
  // presencia y recibe XP por participar en la sesión CPHS (DS 44/2024, ex DS 54 derogado 01-02-2025).
  // Fire-and-forget; un fallo en awardXp NUNCA debe romper el record-
  // minutes (que tiene valor legal ISO 45001 §5.4).
  for (const attendeeUid of input.attendees) {
    try {
      awardXp('cphs_session_attended', undefined, {
        meetingId: input.meetingId,
        committeeId: meeting.committeeId,
        attendeeUid,
      });
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[cphsService] awardXp(cphs_session_attended) threw — ignored', err);
      }
    }
  }

  return { ...meeting, ...patch, id: input.meetingId };
}

export async function signMinutes(
  meetingId: string,
  uid: string,
  credentialId: string,
  signature: string,
  db: MinimalCphsDb,
): Promise<void> {
  if (!meetingId) throw new Error('meetingId is required');
  if (!uid || typeof uid !== 'string') throw new Error('uid is required');
  if (!credentialId || typeof credentialId !== 'string') {
    throw new CphsSignatureError('credentialId is required');
  }
  if (!signature || typeof signature !== 'string') {
    throw new CphsSignatureError('signature is required');
  }

  const docRef = db.collection(MEETINGS_COLLECTION).doc(meetingId);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error(`meeting ${meetingId} not found`);
  const meeting = snap.data() as CphsMeeting;

  if (meeting.status !== 'held') {
    throw new CphsSignatureError(
      'sólo actas con status=held pueden firmarse; recordMinutes() debe correr primero',
    );
  }
  if (!meeting.attendees.includes(uid)) {
    throw new CphsSignatureError(
      `uid ${uid} no está en attendees de la reunión; no puede firmar`,
    );
  }
  // Idempotencia: un mismo uid no puede firmar dos veces el mismo acta.
  if (meeting.signatures?.some((s) => s.uid === uid)) {
    throw new CphsSignatureError(
      `uid ${uid} ya firmó esta acta`,
    );
  }

  const newSignature: CphsSignature = {
    uid,
    signedAt: new Date().toISOString(),
    credentialId,
    signature,
  };
  const updated = [...(meeting.signatures ?? []), newSignature];
  await docRef.update({ signatures: updated });

  // Sprint 32 wire W4 — gamificación POSITIVA: firmar el acta CPHS por
  // WebAuthn es un acto de compromiso con la cultura preventiva. XP alto
  // (40) refuerza la conducta. Fire-and-forget; el path legal del acta
  // nunca se rompe por gamificación.
  try {
    awardXp('cphs_acta_signed', undefined, {
      meetingId,
      uid,
      credentialId,
    });
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[cphsService] awardXp(cphs_acta_signed) threw — ignored', err);
    }
  }
}

/**
 * Devuelve la próxima reunión `scheduled` (futura) del comité, ordenada
 * por `scheduledAt` ascendente. `null` si no hay ninguna.
 *
 * Pensado para wire al `alertScheduler` (sprint futuro): el scheduler
 * puede pollear esto y emitir un recordatorio T-24h antes.
 */
export async function getNextScheduledMeeting(
  committeeId: string,
  db: MinimalCphsDb,
): Promise<CphsMeeting | null> {
  const snap = await db
    .collection(MEETINGS_COLLECTION)
    .where('committeeId', '==', committeeId)
    .get();
  if (snap.empty) return null;
  const now = Date.now();
  const upcoming = snap.docs
    .map((d) => ({ ...(d.data() as Omit<CphsMeeting, 'id'>), id: d.id }))
    .filter((m) => m.status === 'scheduled' && Date.parse(m.scheduledAt) > now)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  return upcoming[0] ?? null;
}

/** Listado plano de meetings de un comité (futuras + pasadas). */
export async function listMeetings(
  committeeId: string,
  db: MinimalCphsDb,
): Promise<CphsMeeting[]> {
  const snap = await db
    .collection(MEETINGS_COLLECTION)
    .where('committeeId', '==', committeeId)
    .get();
  if (snap.empty) return [];
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<CphsMeeting, 'id'>), id: d.id }))
    .sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt));
}

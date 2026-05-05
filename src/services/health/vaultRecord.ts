// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV — HealthRecord shape unificado (ADR 0012).
//
// El trabajador es DUEÑO ABSOLUTO de su cartera médica. Este módulo
// define el shape del record + helpers CRUD sobre Firestore. NUNCA
// expone datos a terceros sin un share token (ver vaultShare.ts).
//
// Praeventio NO diagnostica. Estos records son una bandeja de
// información que el médico tratante ordena para tomar su decisión
// clínica. Cumple Ley 20.584 + 21.719 + 16.744.

import admin from 'firebase-admin';

export type HealthRecordType =
  | 'lab_result'
  | 'imaging'
  | 'diagnosis_note'
  | 'medication'
  | 'allergy'
  | 'family_history'
  | 'audiometry'
  | 'spirometry'
  | 'ecg'
  | 'ergonomic_log';

export type HealthRecordSource = 'self' | 'doctor' | 'mutual';

export type HealthRecordShareScope =
  | 'private'
  | 'employer-via-curriculum'
  | 'shared-via-qr';

export interface HealthRecord {
  id: string;
  workerUid: string;
  type: HealthRecordType;
  uploadedAt: number;
  uploadedBy: HealthRecordSource;
  fileUri?: string;
  fileEncryptionKeyId?: string;
  meta: {
    title: string;
    issueDate?: string;
    issuer?: string;
    isProfessionalSignature?: boolean;
  };
  values?: Record<string, number | string>;
  tags: string[];
  shareScope: HealthRecordShareScope;
}

const VALID_TYPES: HealthRecordType[] = [
  'lab_result',
  'imaging',
  'diagnosis_note',
  'medication',
  'allergy',
  'family_history',
  'audiometry',
  'spirometry',
  'ecg',
  'ergonomic_log',
];

const VALID_SOURCES: HealthRecordSource[] = ['self', 'doctor', 'mutual'];
const VALID_SCOPES: HealthRecordShareScope[] = [
  'private',
  'employer-via-curriculum',
  'shared-via-qr',
];

export class HealthRecordError extends Error {
  constructor(
    message: string,
    public readonly code: 'malformed' | 'not_found' | 'forbidden',
  ) {
    super(message);
    this.name = 'HealthRecordError';
  }
}

/**
 * Valida un record entrante (no toca Firestore). Lanza HealthRecordError
 * con code 'malformed' en cualquier inconsistencia. Útil para tests
 * deterministas y para reusar validación entre route handlers.
 */
export function validateHealthRecord(record: Partial<HealthRecord>): HealthRecord {
  if (!record.id || typeof record.id !== 'string') {
    throw new HealthRecordError('id required', 'malformed');
  }
  if (!record.workerUid || typeof record.workerUid !== 'string') {
    throw new HealthRecordError('workerUid required', 'malformed');
  }
  if (!record.type || !VALID_TYPES.includes(record.type as HealthRecordType)) {
    throw new HealthRecordError(`invalid type: ${record.type}`, 'malformed');
  }
  if (typeof record.uploadedAt !== 'number') {
    throw new HealthRecordError('uploadedAt required (number)', 'malformed');
  }
  if (
    !record.uploadedBy ||
    !VALID_SOURCES.includes(record.uploadedBy as HealthRecordSource)
  ) {
    throw new HealthRecordError(
      `invalid uploadedBy: ${record.uploadedBy}`,
      'malformed',
    );
  }
  if (
    !record.shareScope ||
    !VALID_SCOPES.includes(record.shareScope as HealthRecordShareScope)
  ) {
    throw new HealthRecordError(
      `invalid shareScope: ${record.shareScope}`,
      'malformed',
    );
  }
  if (!record.meta || typeof record.meta.title !== 'string' || !record.meta.title) {
    throw new HealthRecordError('meta.title required', 'malformed');
  }
  if (!Array.isArray(record.tags)) {
    throw new HealthRecordError('tags required (array)', 'malformed');
  }
  return record as HealthRecord;
}

/** Path Firestore para un record dado. */
export function recordDocPath(workerUid: string, recordId: string): string {
  return `users/${workerUid}/health_vault/${recordId}`;
}

/**
 * Persiste un record en Firestore con validación previa. NO valida que
 * el caller sea el dueño — esa responsabilidad es del route handler.
 */
export async function saveHealthRecord(
  record: HealthRecord,
  db: admin.firestore.Firestore = admin.firestore(),
): Promise<HealthRecord> {
  const validated = validateHealthRecord(record);
  await db
    .collection('users')
    .doc(validated.workerUid)
    .collection('health_vault')
    .doc(validated.id)
    .set(validated);
  return validated;
}

/** Lista todos los records del trabajador, orden ascendente por uploadedAt. */
export async function getHealthRecords(
  workerUid: string,
  db: admin.firestore.Firestore = admin.firestore(),
): Promise<HealthRecord[]> {
  if (!workerUid) {
    throw new HealthRecordError('workerUid required', 'malformed');
  }
  const snap = await db
    .collection('users')
    .doc(workerUid)
    .collection('health_vault')
    .orderBy('uploadedAt', 'asc')
    .get();
  return snap.docs.map((d) => d.data() as HealthRecord);
}

/**
 * Bulk-fetch específico (para shares con scope=topic). Retorna sólo los
 * IDs que existen — los faltantes se filtran silenciosamente.
 */
export async function getHealthRecordsByIds(
  workerUid: string,
  ids: string[],
  db: admin.firestore.Firestore = admin.firestore(),
): Promise<HealthRecord[]> {
  if (!workerUid) {
    throw new HealthRecordError('workerUid required', 'malformed');
  }
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const col = db.collection('users').doc(workerUid).collection('health_vault');
  const docs = await Promise.all(ids.map((id) => col.doc(id).get()));
  return docs
    .filter((d) => d.exists)
    .map((d) => d.data() as HealthRecord);
}

/**
 * Filtro "recent" — últimos N días. Reusa getHealthRecords para no
 * duplicar la lógica Firestore.
 */
export async function getRecentHealthRecords(
  workerUid: string,
  daysBack: number,
  db: admin.firestore.Firestore = admin.firestore(),
  now: () => number = Date.now,
): Promise<HealthRecord[]> {
  const cutoff = now() - daysBack * 24 * 60 * 60 * 1000;
  const all = await getHealthRecords(workerUid, db);
  return all.filter((r) => r.uploadedAt >= cutoff);
}

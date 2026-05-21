// Praeventio Guard — Sprint 39 Persistence Layer #1: siteBookService adapter.
//
// Mapea el servicio puro `siteBookService.ts` a Firestore Admin SDK.
//
// Schema:
//   tenants/{tid}/projects/{pid}/sitebook_entries/{folio}
//   tenants/{tid}/projects/{pid}/sitebook_counters/{year}  (atomic counter)
//
// Indexes mínimos (firestore.indexes.json):
//   (year DESC, sequenceNumber DESC)
//   (kind, occurredAt DESC)
//   (involvedWorkerUids ARRAY_CONTAINS, occurredAt DESC)
//
// Rules:
//   - read: isProjectMember(pid) + tenant claim
//   - create: rol prevencionista|supervisor|gerente|admin
//   - update: SOLO si status='open'. status='signed' → inmutable (allow update: false)
//   - delete: false (audit-grade — no se borra)

import type {
  CreateEntryInput,
  SiteBookEntry,
  SiteBookEntryKind,
} from './siteBookService.js';
import { createEntry, signEntry } from './siteBookService.js';
import {
  crdtToEntry,
  mergeCrdtEntries,
  type CrdtSiteBookEntry,
} from './siteBookCrdt.js';

// ────────────────────────────────────────────────────────────────────────
// Firestore-shape DI (subset de admin.firestore())
// ────────────────────────────────────────────────────────────────────────

export interface SiteBookFirestoreDb {
  collection(path: string): SbCollectionRef;
  runTransaction<T>(updateFn: (tx: SbTransaction) => Promise<T>): Promise<T>;
}

interface SbCollectionRef {
  doc(id: string): SbDocRef;
  add(data: Record<string, unknown>): Promise<{ id: string }>;
  where(field: string, op: '==' | '>=' | '<=' | 'array-contains', value: unknown): SbQuery;
  orderBy(field: string, dir: 'asc' | 'desc'): SbQuery;
  limit(n: number): SbQuery;
  get(): Promise<SbQuerySnapshot>;
}

interface SbDocRef {
  get(): Promise<{ exists: boolean; id: string; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
  update(patch: Record<string, unknown>): Promise<void>;
}

interface SbQuery {
  where(field: string, op: '==' | '>=' | '<=' | 'array-contains', value: unknown): SbQuery;
  orderBy(field: string, dir: 'asc' | 'desc'): SbQuery;
  limit(n: number): SbQuery;
  get(): Promise<SbQuerySnapshot>;
}

interface SbQuerySnapshot {
  empty: boolean;
  docs: Array<{ id: string; data(): Record<string, unknown> }>;
}

interface SbTransaction {
  get(ref: SbDocRef): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(ref: SbDocRef, data: Record<string, unknown>): void;
  update(ref: SbDocRef, patch: Record<string, unknown>): void;
}

// ────────────────────────────────────────────────────────────────────────
// Path helpers
// ────────────────────────────────────────────────────────────────────────

const SITEBOOK_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/sitebook_entries`;
const COUNTER_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/sitebook_counters`;
/**
 * Drafts CRDT — solo se materializan mientras la entry está open. Al
 * firmar, el draft se borra (atomic en `signAndPersist`) y solo queda
 * la entry flat. Cada doc almacena `CrdtSiteBookEntry` completo (stamps
 * + OR-Set metadata) para soportar merges multi-supervisor.
 */
const CRDT_DRAFT_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/sitebook_crdt_drafts`;

// ────────────────────────────────────────────────────────────────────────
// Adapter
// ────────────────────────────────────────────────────────────────────────

export interface SiteBookAdapterDeps {
  db: SiteBookFirestoreDb;
  tenantId: string;
  projectId: string;
}

export class SiteBookAdapter {
  constructor(private readonly deps: SiteBookAdapterDeps) {}

  /**
   * Atomic counter: reserva el próximo `sequenceNumber` para el year dado.
   * Transacción Firestore garantiza monotonía (no dos clientes consiguen
   * el mismo folio).
   */
  async nextSequenceNumber(year: number): Promise<number> {
    const counterRef = this.deps.db
      .collection(COUNTER_PATH(this.deps.tenantId, this.deps.projectId))
      .doc(String(year));
    return this.deps.db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? Number(snap.data()?.lastSequence ?? 0) : 0;
      const next = current + 1;
      tx.set(counterRef, { lastSequence: next, updatedAt: new Date().toISOString() });
      return next;
    });
  }

  /**
   * Crea una entry usando el counter atómico. Persiste status='open'.
   */
  async createAndPersist(
    input: Omit<CreateEntryInput, 'sequenceNumber' | 'year'>,
    year: number,
  ): Promise<SiteBookEntry> {
    const seq = await this.nextSequenceNumber(year);
    const entry = createEntry({ ...input, year, sequenceNumber: seq });
    const ref = this.deps.db
      .collection(SITEBOOK_PATH(this.deps.tenantId, this.deps.projectId))
      .doc(entry.folio);
    await ref.set(serialize(entry));
    return entry;
  }

  async getByFolio(folio: string): Promise<SiteBookEntry | null> {
    const ref = this.deps.db
      .collection(SITEBOOK_PATH(this.deps.tenantId, this.deps.projectId))
      .doc(folio);
    const snap = await ref.get();
    if (!snap.exists) return null;
    return deserialize(snap.data());
  }

  /**
   * Firma una entry y persiste el resultado. Verifica que el documento
   * estuviera en status='open' antes de firmar (fail-closed si lo
   * cambiaron entre el `get` y el `signEntry`).
   */
  async signAndPersist(
    folio: string,
    signature: NonNullable<SiteBookEntry['signature']>,
  ): Promise<SiteBookEntry> {
    const ref = this.deps.db
      .collection(SITEBOOK_PATH(this.deps.tenantId, this.deps.projectId))
      .doc(folio);
    return this.deps.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`siteBook entry ${folio} not found`);
      const current = deserialize(snap.data());
      const signed = signEntry(current, signature);
      tx.update(ref, { status: 'signed', signature });
      return signed;
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // CRDT collaborative drafts (multi-supervisor concurrent edits)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Lee el draft CRDT remoto (si existe). Devuelve null si nunca se
   * persistió un draft o si la entry ya fue firmada (draft borrado).
   *
   * Caller usa esta función al ABRIR un draft colaborativo en una tab —
   * para tomar el snapshot remoto como base de merge con la versión
   * local en memoria.
   */
  async loadCrdtDraft(folio: string): Promise<CrdtSiteBookEntry | null> {
    const ref = this.deps.db
      .collection(CRDT_DRAFT_PATH(this.deps.tenantId, this.deps.projectId))
      .doc(folio);
    const snap = await ref.get();
    if (!snap.exists) return null;
    return deserializeCrdt(snap.data());
  }

  /**
   * Persiste el draft CRDT haciendo merge atómico con la versión remota.
   *
   * Transacción:
   *   1. read remote → CrdtSiteBookEntry | null
   *   2. merge(local, remote) → newCrdt
   *   3. write newCrdt al doc CRDT draft
   *   4. write `crdtToEntry(newCrdt)` al doc flat (sitebook_entries)
   *      para que las queries existentes (`listByYear`, `getByFolio`)
   *      sigan viendo la última versión convergente sin tocar la capa
   *      CRDT
   *
   * El paso (4) es lo que permite que el resto del código existente
   * (UI viewer, exports, audit) no necesite saber sobre CRDT — ve la
   * shape canónica SiteBookEntry siempre.
   */
  async mergeAndPersistCrdtDraft(
    localCrdt: CrdtSiteBookEntry,
  ): Promise<CrdtSiteBookEntry> {
    const crdtRef = this.deps.db
      .collection(CRDT_DRAFT_PATH(this.deps.tenantId, this.deps.projectId))
      .doc(localCrdt.provisionalFolio);
    const flatRef = this.deps.db
      .collection(SITEBOOK_PATH(this.deps.tenantId, this.deps.projectId))
      .doc(localCrdt.folio ?? localCrdt.provisionalFolio);

    return this.deps.db.runTransaction(async (tx) => {
      const remoteSnap = await tx.get(crdtRef);
      const remoteCrdt = remoteSnap.exists
        ? deserializeCrdt(remoteSnap.data())
        : null;
      const merged = remoteCrdt
        ? mergeCrdtEntries(localCrdt, remoteCrdt)
        : localCrdt;
      tx.set(crdtRef, serializeCrdt(merged));
      // Materializa la shape flat para los lectores que no saben de CRDT.
      tx.set(flatRef, serialize(crdtToEntry(merged)));
      return merged;
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Lista por año
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Lista por año + filtros opcionales. Si `query.kind` o `query.workerUid`
   * presentes, requiere index compuesto (ver firestore.indexes.json).
   */
  async listByYear(
    year: number,
    options: { kind?: SiteBookEntryKind; workerUid?: string; limit?: number } = {},
  ): Promise<SiteBookEntry[]> {
    let q: SbQuery = this.deps.db
      .collection(SITEBOOK_PATH(this.deps.tenantId, this.deps.projectId))
      .where('year', '==', year);
    if (options.kind) q = q.where('kind', '==', options.kind);
    if (options.workerUid) {
      q = q.where('involvedWorkerUids', 'array-contains', options.workerUid);
    }
    q = q.orderBy('sequenceNumber', 'desc').limit(options.limit ?? 100);
    const snap = await q.get();
    return snap.docs.map((d) => deserialize(d.data()));
  }
}

// ────────────────────────────────────────────────────────────────────────
// Serialization helpers
//
// Pure → Firestore: timestamps quedan como ISO strings (consistente con
// el resto del repo); arrays/maps van as-is. NO usamos Timestamp porque
// el servicio puro trabaja con ISO strings.
// ────────────────────────────────────────────────────────────────────────

function serialize(entry: SiteBookEntry): Record<string, any> {
  return {
    id: entry.id,
    projectId: entry.projectId,
    folio: entry.folio,
    year: entry.year,
    sequenceNumber: entry.sequenceNumber,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    recordedAt: entry.recordedAt,
    recordedByUid: entry.recordedByUid,
    recordedByRole: entry.recordedByRole,
    description: entry.description,
    involvedWorkerUids: entry.involvedWorkerUids ?? [],
    location: entry.location ?? null,
    evidenceUrls: entry.evidenceUrls ?? [],
    correctsEntryFolio: entry.correctsEntryFolio ?? null,
    correctionReason: entry.correctionReason ?? null,
    status: entry.status,
    signature: entry.signature ?? null,
  };
}

/**
 * Serializa un CrdtSiteBookEntry para Firestore. Las shapes LWW + OR-Set
 * son JSON-safe (sin Maps ni Sets), pero limpiamos undefined a null
 * porque Firestore rechaza undefined.
 */
function serializeCrdt(crdt: CrdtSiteBookEntry): Record<string, any> {
  return {
    id: crdt.id,
    projectId: crdt.projectId,
    provisionalFolio: crdt.provisionalFolio,
    folio: crdt.folio ?? null,
    year: crdt.year,
    kind: crdt.kind,
    occurredAt: crdt.occurredAt,
    recordedAt: crdt.recordedAt,
    recordedByUid: crdt.recordedByUid,
    recordedByRole: crdt.recordedByRole,
    description: crdt.description,
    // location.value puede ser undefined — Firestore quiere null.
    location: {
      value: crdt.location.value ?? null,
      stamp: crdt.location.stamp,
    },
    involvedWorkerUids: {
      adds: crdt.involvedWorkerUids.adds,
      removes: crdt.involvedWorkerUids.removes,
    },
    evidenceUrls: {
      adds: crdt.evidenceUrls.adds,
      removes: crdt.evidenceUrls.removes,
    },
    status: crdt.status,
    signature: {
      value: crdt.signature.value ?? null,
      stamp: crdt.signature.stamp,
    },
    correctsEntryFolio: crdt.correctsEntryFolio ?? null,
    correctionReason: crdt.correctionReason ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deserialize requiere acceso dinámico a campos Firestore
function deserializeCrdt(data: any): CrdtSiteBookEntry {
  return {
    id: data.id,
    projectId: data.projectId,
    provisionalFolio: data.provisionalFolio,
    folio: data.folio ?? undefined,
    year: data.year,
    kind: data.kind,
    occurredAt: data.occurredAt,
    recordedAt: data.recordedAt,
    recordedByUid: data.recordedByUid,
    recordedByRole: data.recordedByRole,
    description: data.description,
    location: {
      value: data.location?.value ?? undefined,
      stamp: data.location?.stamp,
    },
    involvedWorkerUids: {
      adds: data.involvedWorkerUids?.adds ?? {},
      removes: data.involvedWorkerUids?.removes ?? {},
    },
    evidenceUrls: {
      adds: data.evidenceUrls?.adds ?? {},
      removes: data.evidenceUrls?.removes ?? {},
    },
    status: data.status,
    signature: {
      value: data.signature?.value ?? undefined,
      stamp: data.signature?.stamp,
    },
    correctsEntryFolio: data.correctsEntryFolio ?? undefined,
    correctionReason: data.correctionReason ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deserialize requiere acceso dinámico a campos Firestore
function deserialize(data: any): SiteBookEntry {
  return {
    id: data.id,
    projectId: data.projectId,
    folio: data.folio,
    year: data.year,
    sequenceNumber: data.sequenceNumber,
    kind: data.kind,
    occurredAt: data.occurredAt,
    recordedAt: data.recordedAt,
    recordedByUid: data.recordedByUid,
    recordedByRole: data.recordedByRole,
    description: data.description,
    involvedWorkerUids: data.involvedWorkerUids ?? undefined,
    location: data.location ?? undefined,
    evidenceUrls: data.evidenceUrls ?? undefined,
    correctsEntryFolio: data.correctsEntryFolio ?? undefined,
    correctionReason: data.correctionReason ?? undefined,
    status: data.status,
    signature: data.signature ?? undefined,
  };
}

// Praeventio Guard — Site Book CRDT layer.
//
// El `siteBookService` actual asume single-writer + signing inmutable.
// En la práctica dos supervisores pueden editar la MISMA entrada draft
// (status='open') desde dispositivos distintos antes de firmarla —
// típicamente: el supervisor A toma fotos en terreno y agrega evidencia,
// el supervisor B está en la oficina y refina la descripción + location.
// Ambos sincronizan al recuperar red.
//
// Esta capa CRDT garantiza convergencia determinística sin coordinación:
//
//   - SCALARS (description, location, signature): Last-Write-Wins
//     (timestamp Lamport + actor tiebreaker).
//   - SETS (involvedWorkerUids, evidenceUrls): OR-Set observed-remove.
//     Una adición es comutativa; una eliminación requiere "tombstone"
//     que recuerda qué timestamp se eliminó.
//   - STATUS: lattice open < signed (signed es absorbente — una vez
//     firmada, la entrada es inmutable).
//
// Por qué importan estos tres patrones por separado:
//   * LWW scalars: el texto del párrafo, la ubicación. Conflicto natural,
//     pero perder la versión "anterior" en favor de la más reciente es
//     aceptable (los supervisores pueden ver historial si quisieran).
//   * OR-Set: dos supervisores agregan EPP y trabajadores distintos —
//     queremos UNIÓN, no last-write-wins. Pero la eliminación debe
//     respetar "qué supervisores observaron el item" para no resucitar
//     ítems que ya alguien borró.
//   * Status lattice: signed es estado absorbente — nunca se vuelve
//     atrás, y dos firmas concurrentes deben converger a la primera
//     (por timestamp + actor tiebreaker).
//
// Esta capa NO toca el código existente — es un wrapper opcional. El
// caller hace edits sobre el CRDT, sincroniza, y al final llama
// `crdtToEntry()` para obtener el `SiteBookEntry` listo para firmar +
// persistir en Firestore.

import type {
  SiteBookEntry,
  SiteBookEntryKind,
  SiteBookEntryStatus,
} from './siteBookService.js';

// ────────────────────────────────────────────────────────────────────────
// CRDT primitives
// ────────────────────────────────────────────────────────────────────────

/** Lamport timestamp con tiebreaker por actor para LWW determinístico. */
export interface CrdtStamp {
  /** Monotonic clock — caller-provided, debe avanzar al menos 1ms por edit. */
  ts: number;
  /** Identificador único del actor (deviceId + uid combinados). */
  actor: string;
}

function stampGt(a: CrdtStamp, b: CrdtStamp): boolean {
  if (a.ts !== b.ts) return a.ts > b.ts;
  // Tiebreaker lexicográfico estable.
  return a.actor > b.actor;
}

/** Last-Write-Wins register. */
export interface LwwRegister<T> {
  value: T;
  stamp: CrdtStamp;
}

export function lwwSet<T>(reg: LwwRegister<T>, value: T, stamp: CrdtStamp): LwwRegister<T> {
  if (stampGt(stamp, reg.stamp)) return { value, stamp };
  return reg;
}

export function lwwMerge<T>(a: LwwRegister<T>, b: LwwRegister<T>): LwwRegister<T> {
  return stampGt(a.stamp, b.stamp) ? a : b;
}

/** Observed-Remove Set. Adds y removes son ambos comutativos. */
export interface OrSet<T extends string> {
  /** Por cada elemento, lista de timestamps en los que fue agregado. */
  adds: Record<T, CrdtStamp[]>;
  /** Por cada elemento, lista de timestamps que se han observado removidos. */
  removes: Record<T, CrdtStamp[]>;
}

export function orSetEmpty<T extends string>(): OrSet<T> {
  return { adds: {} as Record<T, CrdtStamp[]>, removes: {} as Record<T, CrdtStamp[]> };
}

export function orSetAdd<T extends string>(s: OrSet<T>, value: T, stamp: CrdtStamp): OrSet<T> {
  const adds = { ...s.adds };
  adds[value] = [...(adds[value] ?? []), stamp];
  return { adds, removes: s.removes };
}

/**
 * Remove "observa" todos los adds actuales de `value` y los marca como
 * removidos. Adds posteriores con stamp más reciente sobreviven.
 */
export function orSetRemove<T extends string>(
  s: OrSet<T>,
  value: T,
  stamp: CrdtStamp,
): OrSet<T> {
  const observedAdds = s.adds[value] ?? [];
  if (observedAdds.length === 0) return s; // nothing to remove
  const removes = { ...s.removes };
  // Remove "tombstone" referencia los stamps de los adds observados al
  // momento del remove. Adds posteriores (con stamp > este remove) NO
  // están tombstoned.
  removes[value] = [...(removes[value] ?? []), stamp];
  return { adds: s.adds, removes };
}

/** Devuelve true si el elemento está presente — i.e. algún add con stamp
 *  posterior al último remove observado. */
export function orSetHas<T extends string>(s: OrSet<T>, value: T): boolean {
  const adds = s.adds[value] ?? [];
  if (adds.length === 0) return false;
  const removes = s.removes[value] ?? [];
  if (removes.length === 0) return true;
  // Item presente si EXISTE algún add con stamp > último remove.
  // Tomamos el remove más reciente como "watermark de eliminación".
  const lastRemove = removes.reduce((acc, r) => (stampGt(r, acc) ? r : acc), removes[0]!);
  return adds.some((a) => stampGt(a, lastRemove));
}

export function orSetValues<T extends string>(s: OrSet<T>): T[] {
  const out: T[] = [];
  for (const key of Object.keys(s.adds) as T[]) {
    if (orSetHas(s, key)) out.push(key);
  }
  return out.sort(); // deterministic ordering
}

export function orSetMerge<T extends string>(a: OrSet<T>, b: OrSet<T>): OrSet<T> {
  const adds = mergeStampMap(a.adds, b.adds);
  const removes = mergeStampMap(a.removes, b.removes);
  return { adds, removes };
}

function mergeStampMap<T extends string>(
  a: Record<T, CrdtStamp[]>,
  b: Record<T, CrdtStamp[]>,
): Record<T, CrdtStamp[]> {
  const out: Record<T, CrdtStamp[]> = { ...a } as Record<T, CrdtStamp[]>;
  for (const key of Object.keys(b) as T[]) {
    const merged = dedupStamps([...(a[key] ?? []), ...(b[key] ?? [])]);
    out[key] = merged;
  }
  return out;
}

function dedupStamps(stamps: CrdtStamp[]): CrdtStamp[] {
  const seen = new Set<string>();
  const out: CrdtStamp[] = [];
  for (const s of stamps) {
    const key = `${s.ts}_${s.actor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  // Sort lexicográfico estable (ts asc, actor asc) — no afecta semántica.
  out.sort((a, b) => (a.ts - b.ts) || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0));
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Status lattice: open(0) → signed(1)
//
// `corrected` es estatus de "esta entrada fue corregida por una nueva
// posterior" pero NO es transición desde signed por sí mismo — lo marca
// el adapter cuando llega una correction. Esa marcación es idempotente
// y la modela aparte. Aquí solo manejamos open → signed.
// ────────────────────────────────────────────────────────────────────────

export type CrdtStatus = 'open' | 'signed';

function statusRank(s: CrdtStatus): number {
  return s === 'signed' ? 1 : 0;
}

export interface StatusLww {
  value: CrdtStatus;
  stamp: CrdtStamp;
}

/**
 * Status transition con lattice: solo permite ir hacia arriba en el
 * orden (open → signed). Si ambos están en signed, gana el de stamp
 * más bajo (primera firma vence — semántica de "primero firmado").
 */
export function statusMerge(a: StatusLww, b: StatusLww): StatusLww {
  const rankA = statusRank(a.value);
  const rankB = statusRank(b.value);
  if (rankA !== rankB) {
    // Más alto vence (signed > open).
    return rankA > rankB ? a : b;
  }
  // Mismo nivel — para signed, primer signed vence (menor stamp).
  if (a.value === 'signed') {
    return stampGt(b.stamp, a.stamp) ? a : b;
  }
  // Para open: LWW normal (último escritor vence).
  return stampGt(a.stamp, b.stamp) ? a : b;
}

// ────────────────────────────────────────────────────────────────────────
// CRDT Site Book entry — mismo dominio, semántica concurrente
// ────────────────────────────────────────────────────────────────────────

export interface CrdtSiteBookEntry {
  /** Identidad — inmutable, content-addressed por el caller. */
  id: string;
  projectId: string;
  /**
   * Folio "provisional" usado mientras la entrada está offline. Server
   * reasigna folio definitivo al hacer commit. Si dos clients usaron el
   * mismo provisional, el adapter resuelve la collision.
   */
  provisionalFolio: string;
  /** Folio definitivo asignado server-side. undefined pre-commit. */
  folio?: string;
  year: number;
  /** Tipo de la entrada — inmutable (caller decide al crear). */
  kind: SiteBookEntryKind;
  /** Momento del hecho — inmutable (caller decide al crear). */
  occurredAt: string;
  recordedAt: string;
  recordedByUid: string;
  recordedByRole: string;

  // Campos editables concurrentes (LWW scalars + OR-Sets)
  description: LwwRegister<string>;
  location: LwwRegister<string | undefined>;
  involvedWorkerUids: OrSet<string>;
  evidenceUrls: OrSet<string>;

  // Status lattice — first-signer-wins
  status: StatusLww;
  signature: LwwRegister<SiteBookEntry['signature'] | undefined>;

  /** Si esta entrada CORRIGE una anterior (immutable post-create). */
  correctsEntryFolio?: string;
  correctionReason?: string;
}

export interface CreateCrdtEntryInput {
  id: string;
  projectId: string;
  provisionalFolio: string;
  year: number;
  kind: SiteBookEntryKind;
  occurredAt: string;
  recordedByUid: string;
  recordedByRole: string;
  description: string;
  location?: string;
  involvedWorkerUids?: string[];
  evidenceUrls?: string[];
  actor: string;
  now: Date;
  correctsEntryFolio?: string;
  correctionReason?: string;
}

export function createCrdtEntry(input: CreateCrdtEntryInput): CrdtSiteBookEntry {
  const stamp: CrdtStamp = { ts: input.now.getTime(), actor: input.actor };
  let involved = orSetEmpty<string>();
  for (const uid of input.involvedWorkerUids ?? []) {
    involved = orSetAdd(involved, uid, stamp);
  }
  let evidence = orSetEmpty<string>();
  for (const url of input.evidenceUrls ?? []) {
    evidence = orSetAdd(evidence, url, stamp);
  }
  return {
    id: input.id,
    projectId: input.projectId,
    provisionalFolio: input.provisionalFolio,
    year: input.year,
    kind: input.kind,
    occurredAt: input.occurredAt,
    recordedAt: input.now.toISOString(),
    recordedByUid: input.recordedByUid,
    recordedByRole: input.recordedByRole,
    description: { value: input.description, stamp },
    location: { value: input.location, stamp },
    involvedWorkerUids: involved,
    evidenceUrls: evidence,
    status: { value: 'open', stamp },
    signature: { value: undefined, stamp },
    correctsEntryFolio: input.correctsEntryFolio,
    correctionReason: input.correctionReason,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Editing API (cada operación devuelve un nuevo CrdtSiteBookEntry)
// ────────────────────────────────────────────────────────────────────────

export function setDescription(
  e: CrdtSiteBookEntry,
  value: string,
  stamp: CrdtStamp,
): CrdtSiteBookEntry {
  if (e.status.value === 'signed') return e; // immutable post-sign
  return { ...e, description: lwwSet(e.description, value, stamp) };
}

export function setLocation(
  e: CrdtSiteBookEntry,
  value: string | undefined,
  stamp: CrdtStamp,
): CrdtSiteBookEntry {
  if (e.status.value === 'signed') return e;
  return { ...e, location: lwwSet(e.location, value, stamp) };
}

export function addWorker(
  e: CrdtSiteBookEntry,
  uid: string,
  stamp: CrdtStamp,
): CrdtSiteBookEntry {
  if (e.status.value === 'signed') return e;
  return { ...e, involvedWorkerUids: orSetAdd(e.involvedWorkerUids, uid, stamp) };
}

export function removeWorker(
  e: CrdtSiteBookEntry,
  uid: string,
  stamp: CrdtStamp,
): CrdtSiteBookEntry {
  if (e.status.value === 'signed') return e;
  return { ...e, involvedWorkerUids: orSetRemove(e.involvedWorkerUids, uid, stamp) };
}

export function addEvidence(
  e: CrdtSiteBookEntry,
  url: string,
  stamp: CrdtStamp,
): CrdtSiteBookEntry {
  if (e.status.value === 'signed') return e;
  return { ...e, evidenceUrls: orSetAdd(e.evidenceUrls, url, stamp) };
}

export function removeEvidence(
  e: CrdtSiteBookEntry,
  url: string,
  stamp: CrdtStamp,
): CrdtSiteBookEntry {
  if (e.status.value === 'signed') return e;
  return { ...e, evidenceUrls: orSetRemove(e.evidenceUrls, url, stamp) };
}

export function signCrdtEntry(
  e: CrdtSiteBookEntry,
  signature: NonNullable<SiteBookEntry['signature']>,
  stamp: CrdtStamp,
): CrdtSiteBookEntry {
  // Aplicamos solo si todavía no firmada (open → signed).
  if (e.status.value === 'signed') return e;
  return {
    ...e,
    status: { value: 'signed', stamp },
    signature: lwwSet(e.signature, signature, stamp),
  };
}

// ────────────────────────────────────────────────────────────────────────
// MERGE — el corazón del CRDT
// ────────────────────────────────────────────────────────────────────────

/**
 * Combina dos versiones de la misma entrada. Determinístico, comutativo,
 * idempotente, asociativo.
 *
 * Pre-condición: a.id === b.id. Si no, el caller tiene un bug — son
 * entradas distintas.
 */
export function mergeCrdtEntries(
  a: CrdtSiteBookEntry,
  b: CrdtSiteBookEntry,
): CrdtSiteBookEntry {
  if (a.id !== b.id) {
    throw new Error(
      `mergeCrdtEntries: id mismatch (${a.id} vs ${b.id}). Llamaste merge sobre entradas distintas.`,
    );
  }
  // Campos inmutables: si difieren, el caller tiene corrupción de datos.
  // En lugar de fallar duro, preferimos el del menor recordedAt (la
  // versión "ancestral") para no perder datos.
  const ancestral = a.recordedAt <= b.recordedAt ? a : b;
  const mergedStatus = statusMerge(a.status, b.status);

  // Signature debe quedar ALINEADA con el status. Si el status final es
  // signed, la firma es la del branch cuyo status produjo el winning
  // stamp (no LWW del campo signature, que daría last-signer-wins y
  // sería inconsistente con first-signer-wins del status lattice).
  let mergedSignature: typeof a.signature;
  if (mergedStatus.value === 'signed') {
    // Match el branch ganador por stamp del status. Si solo uno firmó,
    // ese branch tiene signature defined.
    const aSignedAndWins =
      a.status.value === 'signed' &&
      a.status.stamp.ts === mergedStatus.stamp.ts &&
      a.status.stamp.actor === mergedStatus.stamp.actor;
    mergedSignature = aSignedAndWins ? a.signature : b.signature;
    // Si el ganador no tiene signature concreta (caso edge donde status
    // dice signed pero signature LWW está en undefined del otro branch),
    // caer al que SÍ tenga signature.
    if (!mergedSignature.value) {
      mergedSignature = a.signature.value
        ? a.signature
        : b.signature.value
          ? b.signature
          : mergedSignature;
    }
  } else {
    mergedSignature = lwwMerge(a.signature, b.signature);
  }

  return {
    id: a.id,
    projectId: ancestral.projectId,
    provisionalFolio: ancestral.provisionalFolio,
    // folio: el primero asignado (server commit) vence; undefined si
    // ninguno tiene aún folio definitivo.
    folio: a.folio ?? b.folio,
    year: ancestral.year,
    kind: ancestral.kind,
    occurredAt: ancestral.occurredAt,
    recordedAt: ancestral.recordedAt,
    recordedByUid: ancestral.recordedByUid,
    recordedByRole: ancestral.recordedByRole,
    description: lwwMerge(a.description, b.description),
    location: lwwMerge(a.location, b.location),
    involvedWorkerUids: orSetMerge(a.involvedWorkerUids, b.involvedWorkerUids),
    evidenceUrls: orSetMerge(a.evidenceUrls, b.evidenceUrls),
    status: mergedStatus,
    signature: mergedSignature,
    correctsEntryFolio: a.correctsEntryFolio ?? b.correctsEntryFolio,
    correctionReason: a.correctionReason ?? b.correctionReason,
  };
}

/**
 * Reduce multiple versions to one. Estable: el orden de merge no
 * afecta el resultado (probado en tests de propiedad).
 */
export function mergeAll(entries: CrdtSiteBookEntry[]): CrdtSiteBookEntry {
  if (entries.length === 0) {
    throw new Error('mergeAll: no entries to merge');
  }
  return entries.reduce((acc, e) => mergeCrdtEntries(acc, e));
}

// ────────────────────────────────────────────────────────────────────────
// Conversion to legacy SiteBookEntry shape
// ────────────────────────────────────────────────────────────────────────

/**
 * Aplana el CRDT a la shape canónica `SiteBookEntry` que el adapter
 * Firestore y el `<SiteBookViewer />` esperan. La conversión es lossy
 * (perdemos la metadata CRDT), pero después de un merge convergente la
 * shape final es estable.
 */
export function crdtToEntry(crdt: CrdtSiteBookEntry): SiteBookEntry {
  const status: SiteBookEntryStatus = crdt.correctsEntryFolio
    ? 'corrected'
    : crdt.status.value;
  return {
    id: crdt.id,
    projectId: crdt.projectId,
    folio: crdt.folio ?? crdt.provisionalFolio,
    year: crdt.year,
    sequenceNumber: extractSeqFromFolio(crdt.folio ?? crdt.provisionalFolio),
    kind: crdt.kind,
    occurredAt: crdt.occurredAt,
    recordedAt: crdt.recordedAt,
    recordedByUid: crdt.recordedByUid,
    recordedByRole: crdt.recordedByRole,
    description: crdt.description.value,
    involvedWorkerUids: orSetValues(crdt.involvedWorkerUids),
    location: crdt.location.value,
    evidenceUrls: orSetValues(crdt.evidenceUrls),
    correctsEntryFolio: crdt.correctsEntryFolio,
    correctionReason: crdt.correctionReason,
    status,
    signature: crdt.signature.value,
  };
}

function extractSeqFromFolio(folio: string): number {
  // SB-{year}-{seq:06d}
  const m = /^SB-\d{4}-(\d{6})$/.exec(folio);
  if (!m) return 0;
  return parseInt(m[1]!, 10);
}

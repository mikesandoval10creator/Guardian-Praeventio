import { describe, it, expect } from 'vitest';
import {
  type CrdtSiteBookEntry,
  type CrdtStamp,
  createCrdtEntry,
  setDescription,
  setLocation,
  addWorker,
  removeWorker,
  addEvidence,
  removeEvidence,
  signCrdtEntry,
  mergeCrdtEntries,
  mergeAll,
  crdtToEntry,
  orSetEmpty,
  orSetAdd,
  orSetRemove,
  orSetHas,
  orSetValues,
  orSetMerge,
  lwwSet,
  lwwMerge,
  statusMerge,
} from './siteBookCrdt.js';

const baseCreate = () =>
  createCrdtEntry({
    id: 'entry-1',
    projectId: 'proj-1',
    provisionalFolio: 'SB-2026-000042',
    year: 2026,
    kind: 'inspection',
    occurredAt: '2026-05-14T08:00:00.000Z',
    recordedByUid: 'sup-A',
    recordedByRole: 'supervisor',
    description: 'Inspección de túnel 4 — visibilidad reducida y polvo elevado.',
    actor: 'device-A',
    now: new Date('2026-05-14T10:00:00.000Z'),
  });

function stamp(ts: number, actor: string): CrdtStamp {
  return { ts, actor };
}

// ────────────────────────────────────────────────────────────────────────
// LWW register
// ────────────────────────────────────────────────────────────────────────

describe('LWW register', () => {
  it('write con stamp mayor reemplaza', () => {
    const a = { value: 'v1', stamp: stamp(1, 'A') };
    const b = lwwSet(a, 'v2', stamp(2, 'A'));
    expect(b.value).toBe('v2');
  });

  it('write con stamp menor NO reemplaza', () => {
    const a = { value: 'v1', stamp: stamp(5, 'A') };
    const b = lwwSet(a, 'v2', stamp(2, 'A'));
    expect(b.value).toBe('v1');
  });

  it('tiebreaker por actor lexicográfico (mismo ts)', () => {
    const a = { value: 'v1', stamp: stamp(5, 'A') };
    const b = lwwSet(a, 'v2', stamp(5, 'B'));
    expect(b.value).toBe('v2'); // B > A
  });

  it('merge comutativo: lwwMerge(a,b) = lwwMerge(b,a)', () => {
    const a = { value: 'v1', stamp: stamp(5, 'A') };
    const b = { value: 'v2', stamp: stamp(7, 'B') };
    expect(lwwMerge(a, b)).toEqual(lwwMerge(b, a));
  });
});

// ────────────────────────────────────────────────────────────────────────
// OR-Set
// ────────────────────────────────────────────────────────────────────────

describe('OR-Set', () => {
  it('add: elemento presente', () => {
    let s = orSetEmpty<string>();
    s = orSetAdd(s, 'worker-1', stamp(1, 'A'));
    expect(orSetHas(s, 'worker-1')).toBe(true);
  });

  it('add + remove: elemento ausente', () => {
    let s = orSetEmpty<string>();
    s = orSetAdd(s, 'worker-1', stamp(1, 'A'));
    s = orSetRemove(s, 'worker-1', stamp(2, 'A'));
    expect(orSetHas(s, 'worker-1')).toBe(false);
  });

  it('add + remove + add (con stamp mayor): presente (resurrected)', () => {
    let s = orSetEmpty<string>();
    s = orSetAdd(s, 'worker-1', stamp(1, 'A'));
    s = orSetRemove(s, 'worker-1', stamp(2, 'A'));
    s = orSetAdd(s, 'worker-1', stamp(3, 'A'));
    expect(orSetHas(s, 'worker-1')).toBe(true);
  });

  it('add concurrente desde dos actores: union', () => {
    let sA = orSetEmpty<string>();
    sA = orSetAdd(sA, 'worker-1', stamp(1, 'A'));
    let sB = orSetEmpty<string>();
    sB = orSetAdd(sB, 'worker-2', stamp(1, 'B'));
    const merged = orSetMerge(sA, sB);
    expect(orSetHas(merged, 'worker-1')).toBe(true);
    expect(orSetHas(merged, 'worker-2')).toBe(true);
    expect(orSetValues(merged)).toEqual(['worker-1', 'worker-2']);
  });

  it('add(A,ts=5) merge remove(B,ts=3): elemento PRESENTE (add posterior al remove)', () => {
    let sA = orSetEmpty<string>();
    sA = orSetAdd(sA, 'x', stamp(5, 'A'));
    let sB = orSetEmpty<string>();
    sB = orSetAdd(sB, 'x', stamp(1, 'B'));
    sB = orSetRemove(sB, 'x', stamp(3, 'B'));
    const merged = orSetMerge(sA, sB);
    expect(orSetHas(merged, 'x')).toBe(true);
  });

  it('orSetMerge es comutativo', () => {
    let sA = orSetEmpty<string>();
    sA = orSetAdd(sA, 'a', stamp(1, 'A'));
    let sB = orSetEmpty<string>();
    sB = orSetAdd(sB, 'b', stamp(1, 'B'));
    const ab = orSetMerge(sA, sB);
    const ba = orSetMerge(sB, sA);
    expect(orSetValues(ab)).toEqual(orSetValues(ba));
  });

  it('orSetMerge es idempotente', () => {
    let s = orSetEmpty<string>();
    s = orSetAdd(s, 'a', stamp(1, 'A'));
    const once = orSetMerge(s, s);
    const twice = orSetMerge(once, s);
    expect(orSetValues(once)).toEqual(orSetValues(twice));
  });

  it('orSetValues devuelve ordenado lex (estable)', () => {
    let s = orSetEmpty<string>();
    s = orSetAdd(s, 'c', stamp(1, 'A'));
    s = orSetAdd(s, 'a', stamp(2, 'A'));
    s = orSetAdd(s, 'b', stamp(3, 'A'));
    expect(orSetValues(s)).toEqual(['a', 'b', 'c']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Status lattice
// ────────────────────────────────────────────────────────────────────────

describe('Status lattice', () => {
  it('open < signed → signed gana', () => {
    const merged = statusMerge(
      { value: 'open', stamp: stamp(5, 'A') },
      { value: 'signed', stamp: stamp(3, 'B') },
    );
    expect(merged.value).toBe('signed');
  });

  it('dos signed concurrentes: primero (ts menor) gana', () => {
    const merged = statusMerge(
      { value: 'signed', stamp: stamp(3, 'A') },
      { value: 'signed', stamp: stamp(5, 'B') },
    );
    expect(merged.value).toBe('signed');
    expect(merged.stamp.actor).toBe('A');
  });

  it('dos open: LWW normal', () => {
    const merged = statusMerge(
      { value: 'open', stamp: stamp(3, 'A') },
      { value: 'open', stamp: stamp(5, 'B') },
    );
    expect(merged.stamp.actor).toBe('B');
  });
});

// ────────────────────────────────────────────────────────────────────────
// createCrdtEntry + simple edits
// ────────────────────────────────────────────────────────────────────────

describe('createCrdtEntry + edits', () => {
  it('crea entrada con descripción + status=open', () => {
    const e = baseCreate();
    expect(e.id).toBe('entry-1');
    expect(e.status.value).toBe('open');
    expect(e.description.value).toMatch(/Inspección de túnel 4/);
  });

  it('setDescription cambia el valor con stamp mayor', () => {
    const e1 = baseCreate();
    const e2 = setDescription(e1, 'Nueva versión', stamp(2_000_000_000_000, 'A'));
    expect(e2.description.value).toBe('Nueva versión');
  });

  it('setDescription NO aplica si status=signed', () => {
    let e = baseCreate();
    e = signCrdtEntry(
      e,
      {
        signerUid: 'sup-A',
        signedAt: '2026-05-14T11:00:00.000Z',
        algorithm: 'webauthn-ecdsa-p256',
        payloadHashHex: 'deadbeef',
      },
      stamp(1_700_000_001_000, 'A'),
    );
    const e2 = setDescription(e, 'intento de cambio post-firma', stamp(9_999_999_999_999, 'A'));
    expect(e2.description.value).toBe(e.description.value);
    expect(e2.status.value).toBe('signed');
  });

  it('addWorker + removeWorker funcionan', () => {
    let e = baseCreate();
    e = addWorker(e, 'w-1', stamp(2_000_000_000_001, 'A'));
    e = addWorker(e, 'w-2', stamp(2_000_000_000_002, 'A'));
    e = removeWorker(e, 'w-1', stamp(2_000_000_000_003, 'A'));
    const flat = crdtToEntry(e);
    expect(flat.involvedWorkerUids).toEqual(['w-2']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// MERGE — concurrent multi-supervisor scenarios
// ────────────────────────────────────────────────────────────────────────

describe('mergeCrdtEntries — concurrent supervisors', () => {
  it('A edita descripción, B agrega trabajador: ambos se preservan', () => {
    const base = baseCreate();
    // Supervisor A edita descripción
    const a = setDescription(base, 'A actualizó: polvo crítico', stamp(2_000_000_000_001, 'A'));
    // Supervisor B agrega trabajador
    const b = addWorker(base, 'worker-99', stamp(2_000_000_000_002, 'B'));
    const merged = mergeCrdtEntries(a, b);
    expect(merged.description.value).toBe('A actualizó: polvo crítico');
    expect(orSetHas(merged.involvedWorkerUids, 'worker-99')).toBe(true);
  });

  it('A y B agregan trabajadores distintos: union (no se pierde nada)', () => {
    const base = baseCreate();
    const a = addWorker(base, 'w-A', stamp(2_000_000_000_010, 'A'));
    const b = addWorker(base, 'w-B', stamp(2_000_000_000_011, 'B'));
    const merged = mergeCrdtEntries(a, b);
    const flat = crdtToEntry(merged);
    expect(flat.involvedWorkerUids?.sort()).toEqual(['w-A', 'w-B']);
  });

  it('A edita descripción ts=2, B edita ts=3: B gana (LWW)', () => {
    const base = baseCreate();
    const a = setDescription(base, 'A version', stamp(2_000_000_000_002, 'A'));
    const b = setDescription(base, 'B version', stamp(2_000_000_000_003, 'B'));
    const merged = mergeCrdtEntries(a, b);
    expect(merged.description.value).toBe('B version');
  });

  it('A firma ts=10, B firma ts=12: A gana (primer firmante)', () => {
    const base = baseCreate();
    const a = signCrdtEntry(
      base,
      {
        signerUid: 'sup-A',
        signedAt: '2026-05-14T11:00:00.000Z',
        algorithm: 'webauthn-ecdsa-p256',
        payloadHashHex: 'aa',
      },
      stamp(2_000_000_000_010, 'A'),
    );
    const b = signCrdtEntry(
      base,
      {
        signerUid: 'sup-B',
        signedAt: '2026-05-14T11:00:02.000Z',
        algorithm: 'webauthn-ecdsa-p256',
        payloadHashHex: 'bb',
      },
      stamp(2_000_000_000_012, 'B'),
    );
    const merged = mergeCrdtEntries(a, b);
    expect(merged.status.value).toBe('signed');
    expect(merged.signature.value?.signerUid).toBe('sup-A');
  });

  it('merge es COMUTATIVO: mergeCrdtEntries(a,b) === mergeCrdtEntries(b,a)', () => {
    const base = baseCreate();
    const a = setDescription(base, 'va', stamp(2_000_000_000_002, 'A'));
    const b = addWorker(base, 'wb', stamp(2_000_000_000_003, 'B'));
    const ab = crdtToEntry(mergeCrdtEntries(a, b));
    const ba = crdtToEntry(mergeCrdtEntries(b, a));
    expect(ab).toEqual(ba);
  });

  it('merge es IDEMPOTENTE: merge(a,a) === a (en shape final)', () => {
    const base = baseCreate();
    const a = setDescription(base, 'una version', stamp(2_000_000_000_002, 'A'));
    const flat1 = crdtToEntry(a);
    const flat2 = crdtToEntry(mergeCrdtEntries(a, a));
    expect(flat1).toEqual(flat2);
  });

  it('merge es ASOCIATIVO: merge(merge(a,b),c) === merge(a,merge(b,c))', () => {
    const base = baseCreate();
    const a = setDescription(base, 'A', stamp(2_000_000_000_001, 'A'));
    const b = addWorker(base, 'B', stamp(2_000_000_000_002, 'B'));
    const c = addEvidence(base, 'https://storage/photo1.jpg', stamp(2_000_000_000_003, 'C'));
    const left = crdtToEntry(mergeCrdtEntries(mergeCrdtEntries(a, b), c));
    const right = crdtToEntry(mergeCrdtEntries(a, mergeCrdtEntries(b, c)));
    expect(left).toEqual(right);
  });

  it('id mismatch: throws', () => {
    const a = baseCreate();
    const b = { ...a, id: 'entry-2' };
    expect(() => mergeCrdtEntries(a, b)).toThrow(/id mismatch/);
  });

  it('mergeAll converge sin importar orden', () => {
    const base = baseCreate();
    const versions = [
      setDescription(base, 'v1', stamp(2_000_000_000_001, 'A')),
      addWorker(base, 'w-2', stamp(2_000_000_000_002, 'B')),
      addEvidence(base, 'https://storage/e1.jpg', stamp(2_000_000_000_003, 'C')),
      removeWorker(addWorker(base, 'w-X', stamp(1_700_000_000_000, 'D')), 'w-X', stamp(2_000_000_000_004, 'D')),
    ];
    const r1 = crdtToEntry(mergeAll(versions));
    const r2 = crdtToEntry(mergeAll([...versions].reverse()));
    const r3 = crdtToEntry(mergeAll([versions[2]!, versions[0]!, versions[3]!, versions[1]!]));
    expect(r1).toEqual(r2);
    expect(r1).toEqual(r3);
  });
});

// ────────────────────────────────────────────────────────────────────────
// crdtToEntry — conversion fidelity
// ────────────────────────────────────────────────────────────────────────

describe('crdtToEntry', () => {
  it('shape final tiene los campos esperados', () => {
    const base = baseCreate();
    const flat = crdtToEntry(base);
    expect(flat.id).toBe('entry-1');
    expect(flat.folio).toBe('SB-2026-000042');
    expect(flat.sequenceNumber).toBe(42);
    expect(flat.kind).toBe('inspection');
    expect(flat.status).toBe('open');
    expect(flat.signature).toBeUndefined();
  });

  it('signed CRDT → status=signed en shape final', () => {
    let e = baseCreate();
    e = signCrdtEntry(
      e,
      {
        signerUid: 'sup-A',
        signedAt: '2026-05-14T11:00:00.000Z',
        algorithm: 'webauthn-ecdsa-p256',
        payloadHashHex: 'cafe',
      },
      stamp(2_000_000_000_010, 'A'),
    );
    const flat = crdtToEntry(e);
    expect(flat.status).toBe('signed');
    expect(flat.signature?.signerUid).toBe('sup-A');
  });

  it('correctsEntryFolio set → status=corrected en shape final', () => {
    const base: CrdtSiteBookEntry = {
      ...baseCreate(),
      correctsEntryFolio: 'SB-2026-000041',
      correctionReason: 'Se omitió mencionar uso de andamio externo',
    };
    const flat = crdtToEntry(base);
    expect(flat.status).toBe('corrected');
  });

  it('evidenceUrls + involvedWorkerUids derivados del OR-Set', () => {
    let e = baseCreate();
    e = addWorker(e, 'w-A', stamp(2_000_000_000_001, 'A'));
    e = addWorker(e, 'w-B', stamp(2_000_000_000_002, 'A'));
    e = addEvidence(e, 'https://photo1', stamp(2_000_000_000_003, 'A'));
    e = removeEvidence(e, 'https://photo1', stamp(2_000_000_000_004, 'A'));
    const flat = crdtToEntry(e);
    expect(flat.involvedWorkerUids?.sort()).toEqual(['w-A', 'w-B']);
    expect(flat.evidenceUrls).toEqual([]);
  });
});

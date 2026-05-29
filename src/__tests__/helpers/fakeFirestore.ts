// Reusable in-memory Firestore-admin fake for real-router supertest coverage
// (Plan v3 Fase 1 — server lever). The existing test-server.ts InMemoryFirestore
// is flat (no subcollections, no orderBy/getAll/range ops/transactions), which
// most src/server/routes/* handlers need. This fake supports the full surface
// the routes actually use so we can mount the REAL routers and exercise them.
//
// Usage (per test file — vi.mock must be hoisted, so use a holder):
//
//   const H = vi.hoisted(() => ({ db: null }));
//   vi.mock('firebase-admin', () => adminMock(() => H.db));
//   import { createFakeFirestore } from '../helpers/fakeFirestore';
//   beforeEach(() => { H.db = createFakeFirestore(); H.db._seed('projects/p1', {...}); });
//
// Paths are slash-joined: 'projects/p1/workers/w1'. A collection path has an
// odd segment count from a doc's perspective; we don't enforce that — `where`
// just scans docs that live directly under the queried collection path.

type DocData = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getField(doc: DocData | undefined, path: string): unknown {
  if (!doc) return undefined;
  return path.split('.').reduce<unknown>((acc, k) => (acc == null ? acc : (acc as DocData)[k]), doc);
}
function setField(target: DocData, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]] as DocData;
  }
  cur[parts[parts.length - 1]] = value;
}
function deleteField(target: DocData, path: string): void {
  const parts = path.split('.');
  let cur: DocData = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) return;
    cur = cur[parts[i]] as DocData;
  }
  delete cur[parts[parts.length - 1]];
}

interface FV { __fv: string; items?: unknown[]; n?: number }
function isFV(v: unknown): v is FV {
  return isPlainObject(v) && typeof (v as { __fv?: unknown }).__fv === 'string';
}

export const FieldValue = {
  serverTimestamp: (): FV => ({ __fv: 'serverTimestamp' }),
  arrayUnion: (...items: unknown[]): FV => ({ __fv: 'arrayUnion', items }),
  arrayRemove: (...items: unknown[]): FV => ({ __fv: 'arrayRemove', items }),
  increment: (n: number): FV => ({ __fv: 'increment', n }),
  delete: (): FV => ({ __fv: 'delete' }),
};

export const Timestamp = {
  now: () => ({ toDate: () => new Date(), toMillis: () => Date.now(), seconds: 0, nanoseconds: 0 }),
  fromDate: (d: Date) => ({ toDate: () => d, toMillis: () => d.getTime() }),
};

function applyWrite(base: DocData, patch: DocData, opts: { merge?: boolean } = {}): DocData {
  const out: DocData = opts.merge ? { ...base } : {};
  if (!opts.merge) {
    // set without merge replaces — but still resolve FieldValues.
    for (const [k, v] of Object.entries(patch)) writeOne(out, k, v, base);
    return out;
  }
  for (const [k, v] of Object.entries(patch)) writeOne(out, k, v, base);
  return out;
}
function writeOne(out: DocData, k: string, v: unknown, base: DocData): void {
  if (isFV(v)) {
    const cur = getField(base, k);
    if (v.__fv === 'serverTimestamp') setField(out, k, new Date().toISOString());
    else if (v.__fv === 'arrayUnion') {
      const arr = Array.isArray(cur) ? [...cur] : [];
      for (const it of v.items ?? []) if (!arr.includes(it)) arr.push(it);
      setField(out, k, arr);
    } else if (v.__fv === 'arrayRemove') {
      setField(out, k, Array.isArray(cur) ? cur.filter((x) => !(v.items ?? []).includes(x)) : []);
    } else if (v.__fv === 'increment') {
      setField(out, k, (typeof cur === 'number' ? cur : 0) + (v.n ?? 0));
    } else if (v.__fv === 'delete') {
      deleteField(out, k);
    }
  } else {
    setField(out, k, v);
  }
}

interface Filter { field: string; op: string; value: unknown }
function passes(doc: DocData, f: Filter): boolean {
  const v = getField(doc, f.field);
  switch (f.op) {
    case '==': return v === f.value;
    case '!=': return v !== f.value;
    case '>': return (v as number) > (f.value as number);
    case '>=': return (v as number) >= (f.value as number);
    case '<': return (v as number) < (f.value as number);
    case '<=': return (v as number) <= (f.value as number);
    case 'in': return Array.isArray(f.value) && f.value.includes(v);
    case 'not-in': return Array.isArray(f.value) && !f.value.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(f.value);
    case 'array-contains-any': return Array.isArray(v) && Array.isArray(f.value) && f.value.some((x) => v.includes(x));
    default: return false;
  }
}

export interface FakeFirestore {
  collection(path: string): FakeCollectionRef;
  doc(path: string): FakeDocRef;
  getAll(...refs: FakeDocRef[]): Promise<FakeDocSnap[]>;
  runTransaction<T>(fn: (txn: FakeTxn) => Promise<T>): Promise<T>;
  batch(): FakeBatch;
  _seed(path: string, data: DocData): void;
  _dump(): Record<string, DocData>;
  _store: Map<string, DocData>;
}
interface FakeDocSnap { id: string; exists: boolean; ref: FakeDocRef; data(): DocData | undefined; get(field: string): unknown }
interface FakeDocRef {
  id: string;
  path: string;
  get(): Promise<FakeDocSnap>;
  set(data: DocData, opts?: { merge?: boolean }): Promise<void>;
  update(data: DocData): Promise<void>;
  delete(): Promise<void>;
  collection(name: string): FakeCollectionRef;
}
interface FakeQuery {
  where(field: string, op: string, value: unknown): FakeQuery;
  orderBy(field: string, dir?: 'asc' | 'desc'): FakeQuery;
  limit(n: number): FakeQuery;
  get(): Promise<FakeQuerySnap>;
  count(): { get(): Promise<{ data(): { count: number } }> };
}
interface FakeCollectionRef extends FakeQuery {
  doc(id?: string): FakeDocRef;
  add(data: DocData): Promise<FakeDocRef>;
  path: string;
}
interface FakeQuerySnap {
  empty: boolean;
  size: number;
  docs: FakeDocSnap[];
  forEach(cb: (d: FakeDocSnap) => void): void;
}
interface FakeTxn {
  get(ref: FakeDocRef | FakeQuery): Promise<FakeDocSnap | FakeQuerySnap>;
  set(ref: FakeDocRef, data: DocData, opts?: { merge?: boolean }): FakeTxn;
  update(ref: FakeDocRef, data: DocData): FakeTxn;
  delete(ref: FakeDocRef): FakeTxn;
  create(ref: FakeDocRef, data: DocData): FakeTxn;
}
interface FakeBatch {
  set(ref: FakeDocRef, data: DocData, opts?: { merge?: boolean }): FakeBatch;
  update(ref: FakeDocRef, data: DocData): FakeBatch;
  delete(ref: FakeDocRef): FakeBatch;
  commit(): Promise<void>;
}

let autoCounter = 0;

export function createFakeFirestore(seed: Record<string, DocData> = {}): FakeFirestore {
  const store = new Map<string, DocData>();
  for (const [k, v] of Object.entries(seed)) store.set(k, { ...v });

  function docRef(path: string): FakeDocRef {
    const id = path.split('/').pop()!;
    return {
      id,
      path,
      async get(): Promise<FakeDocSnap> {
        return snapOf(path);
      },
      async set(data, opts) {
        const base = store.get(path) ?? {};
        store.set(path, applyWrite(base, data, { merge: opts?.merge }));
      },
      async update(data) {
        if (!store.has(path)) {
          const e = new Error(`No document to update: ${path}`) as Error & { code: number };
          e.code = 5;
          throw e;
        }
        store.set(path, applyWrite(store.get(path)!, data, { merge: true }));
      },
      async delete() {
        store.delete(path);
      },
      collection(name) {
        return collectionRef(`${path}/${name}`);
      },
    };
  }

  function snapOf(path: string): FakeDocSnap {
    const data = store.get(path);
    const id = path.split('/').pop()!;
    return {
      id,
      exists: data !== undefined,
      ref: docRef(path),
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => getField(data, field),
    };
  }

  function runQuery(colPath: string, filters: Filter[], order: { field: string; dir: string } | null, lim: number | null): FakeQuerySnap {
    const depth = colPath.split('/').length;
    let docs: FakeDocSnap[] = [];
    for (const [key, value] of store.entries()) {
      if (!key.startsWith(`${colPath}/`)) continue;
      // direct children only: one extra segment beyond the collection path.
      if (key.split('/').length !== depth + 1) continue;
      if (!filters.every((f) => passes(value, f))) continue;
      docs.push(snapOf(key));
    }
    if (order) {
      docs.sort((a, b) => {
        const av = getField(a.data(), order.field) as number;
        const bv = getField(b.data(), order.field) as number;
        const c = av < bv ? -1 : av > bv ? 1 : 0;
        return order.dir === 'desc' ? -c : c;
      });
    }
    if (lim != null) docs = docs.slice(0, lim);
    return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb) => docs.forEach(cb) };
  }

  function query(colPath: string, filters: Filter[], order: { field: string; dir: string } | null, lim: number | null): FakeQuery {
    return {
      where: (field, op, value) => query(colPath, [...filters, { field, op, value }], order, lim),
      orderBy: (field, dir = 'asc') => query(colPath, filters, { field, dir }, lim),
      limit: (n) => query(colPath, filters, order, n),
      get: async () => runQuery(colPath, filters, order, lim),
      count: () => ({
        get: async () => ({ data: () => ({ count: runQuery(colPath, filters, null, null).size }) }),
      }),
    };
  }

  function collectionRef(colPath: string): FakeCollectionRef {
    const q = query(colPath, [], null, null);
    return {
      ...q,
      path: colPath,
      doc(id?: string) {
        const realId = id ?? `auto_${(autoCounter++).toString(36)}`;
        return docRef(`${colPath}/${realId}`);
      },
      async add(data) {
        const id = `auto_${(autoCounter++).toString(36)}`;
        const path = `${colPath}/${id}`;
        store.set(path, { ...data });
        return docRef(path);
      },
    };
  }

  const txn: FakeTxn = {
    async get(ref) {
      if ('get' in ref && 'path' in ref) return (ref as FakeDocRef).get();
      return (ref as FakeQuery).get();
    },
    set(ref, data, opts) {
      const base = store.get(ref.path) ?? {};
      store.set(ref.path, applyWrite(base, data, { merge: opts?.merge }));
      return txn;
    },
    update(ref, data) {
      store.set(ref.path, applyWrite(store.get(ref.path) ?? {}, data, { merge: true }));
      return txn;
    },
    delete(ref) {
      store.delete(ref.path);
      return txn;
    },
    create(ref, data) {
      store.set(ref.path, { ...data });
      return txn;
    },
  };

  return {
    collection: (path) => collectionRef(path),
    doc: (path) => docRef(path),
    async getAll(...refs) {
      return refs.map((r) => snapOf(r.path));
    },
    async runTransaction(fn) {
      return fn(txn);
    },
    batch() {
      const ops: Array<() => void> = [];
      const b: FakeBatch = {
        set(ref, data, opts) { ops.push(() => { store.set(ref.path, applyWrite(store.get(ref.path) ?? {}, data, { merge: opts?.merge })); }); return b; },
        update(ref, data) { ops.push(() => { store.set(ref.path, applyWrite(store.get(ref.path) ?? {}, data, { merge: true })); }); return b; },
        delete(ref) { ops.push(() => { store.delete(ref.path); }); return b; },
        async commit() { ops.forEach((op) => op()); },
      };
      return b;
    },
    _seed(path, data) { store.set(path, { ...data }); },
    _dump() { return Object.fromEntries(store.entries()); },
    _store: store,
  };
}

/**
 * Build the `vi.mock('firebase-admin', ...)` factory return value. Pass a
 * getter so the db can be (re)assigned in beforeEach while the module mock is
 * created once at import time.
 */
export function adminMock(getDb: () => FakeFirestore, authImpl?: unknown) {
  const firestoreFn = Object.assign(() => getDb(), {
    FieldValue,
    Timestamp,
    FieldPath: { documentId: () => '__name__' },
  });
  const adminObj = {
    firestore: firestoreFn,
    apps: [{ name: '[DEFAULT]' }],
    app: () => ({ name: '[DEFAULT]' }),
    initializeApp: () => ({ name: '[DEFAULT]' }),
    credential: { cert: () => ({}), applicationDefault: () => ({}) },
    auth: () => authImpl ?? { verifyIdToken: async () => ({ uid: 'test' }), getUser: async () => ({ uid: 'test' }) },
  };
  return { __esModule: true, default: adminObj, ...adminObj };
}

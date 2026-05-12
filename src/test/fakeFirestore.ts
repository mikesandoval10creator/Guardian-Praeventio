// Praeventio Guard — Sprint 39 Persistence Layer: fake Firestore for tests.
//
// Mini in-memory Firestore con la superficie que usan los adapters:
//   - collection(path).doc(id).get()/set()/update()
//   - collection(path).where(...).orderBy(...).limit(n).get()
//   - runTransaction(fn) — sequential read/write (no aislamiento real)
//
// Suficiente para tests; NO para producción.

export interface FakeFirestoreDoc {
  exists: boolean;
  id: string;
  data: () => any;
}

export interface FakeFirestoreSnapshot {
  empty: boolean;
  docs: FakeFirestoreDoc[];
}

export interface FakeFirestoreDocRef {
  _path: string;
  _id: string;
  get(): Promise<FakeFirestoreDoc>;
  set(data: any): Promise<void>;
  update(patch: any): Promise<void>;
}

export interface FakeFirestoreQuery {
  where(
    field: string,
    op: '==' | '>=' | '<=' | '!=' | 'array-contains',
    value: any,
  ): FakeFirestoreQuery;
  orderBy(field: string, dir: 'asc' | 'desc'): FakeFirestoreQuery;
  limit(n: number): FakeFirestoreQuery;
  get(): Promise<FakeFirestoreSnapshot>;
}

export interface FakeFirestoreCollectionRef {
  doc(id: string): FakeFirestoreDocRef;
  add(data: any): Promise<{ id: string }>;
  where(
    field: string,
    op: '==' | '>=' | '<=' | '!=' | 'array-contains',
    value: any,
  ): FakeFirestoreQuery;
  orderBy(field: string, dir: 'asc' | 'desc'): FakeFirestoreQuery;
  limit(n: number): FakeFirestoreQuery;
  get(): Promise<FakeFirestoreSnapshot>;
}

export interface FakeTransaction {
  get(ref: FakeFirestoreDocRef): Promise<{ exists: boolean; data(): any }>;
  set(ref: FakeFirestoreDocRef, data: any): void;
  update(ref: FakeFirestoreDocRef, patch: any): void;
}

export interface FakeFirestoreDb {
  collection(path: string): FakeFirestoreCollectionRef;
  runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T>;
  _dump(): Map<string, Map<string, any>>;
}

export function createFakeFirestore(): FakeFirestoreDb {
  const collections = new Map<string, Map<string, any>>();
  function getCol(p: string): Map<string, any> {
    if (!collections.has(p)) collections.set(p, new Map());
    return collections.get(p)!;
  }

  function readPath(data: any, field: string): any {
    // Soporta dot notation (e.g. 'subjectRef.id') sobre objetos planos.
    if (data == null) return undefined;
    if (!field.includes('.')) return data[field];
    return field.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), data);
  }

  function matchFilter(value: any, op: string, target: any): boolean {
    switch (op) {
      case '==':
        return value === target;
      case '!=':
        return value !== target;
      case '>=':
        return value >= target;
      case '<=':
        return value <= target;
      case 'array-contains':
        return Array.isArray(value) && value.includes(target);
      default:
        return true;
    }
  }

  function makeQuery(
    path: string,
    filters: Array<{ field: string; op: string; value: any }> = [],
    sorts: Array<{ field: string; dir: 'asc' | 'desc' }> = [],
    limitN?: number,
  ): FakeFirestoreQuery {
    return {
      where: (field, op, value) =>
        makeQuery(path, [...filters, { field, op, value }], sorts, limitN),
      orderBy: (field, dir) => makeQuery(path, filters, [...sorts, { field, dir }], limitN),
      limit: (n) => makeQuery(path, filters, sorts, n),
      get: async () => {
        let docs: FakeFirestoreDoc[] = Array.from(getCol(path).entries()).map(([id, data]) => ({
          exists: true,
          id,
          data: () => data,
        }));
        for (const f of filters) {
          docs = docs.filter((d) => matchFilter(readPath(d.data(), f.field), f.op, f.value));
        }
        for (const s of sorts) {
          docs.sort((a, b) => {
            const av = readPath(a.data(), s.field);
            const bv = readPath(b.data(), s.field);
            const c = av < bv ? -1 : av > bv ? 1 : 0;
            return s.dir === 'asc' ? c : -c;
          });
        }
        if (limitN !== undefined) docs = docs.slice(0, limitN);
        return { empty: docs.length === 0, docs };
      },
    };
  }

  function makeDocRef(path: string, id: string): FakeFirestoreDocRef {
    return {
      _path: path,
      _id: id,
      get: async () => {
        const col = getCol(path);
        const data = col.get(id);
        return { exists: data !== undefined, id, data: () => data };
      },
      set: async (data: any) => {
        getCol(path).set(id, data);
      },
      update: async (patch: any) => {
        const col = getCol(path);
        const existing = col.get(id) ?? {};
        col.set(id, { ...existing, ...patch });
      },
    };
  }

  function makeColRef(path: string): FakeFirestoreCollectionRef {
    const col = getCol(path);
    return {
      doc: (id) => makeDocRef(path, id),
      add: async (data: any) => {
        const id = `auto-${col.size + 1}`;
        col.set(id, data);
        return { id };
      },
      where: (field, op, value) => makeQuery(path, [{ field, op, value }]),
      orderBy: (field, dir) => makeQuery(path, [], [{ field, dir }]),
      limit: (n) => makeQuery(path, [], [], n),
      get: async () => makeQuery(path).get(),
    };
  }

  return {
    collection: (p) => makeColRef(p),
    runTransaction: async <T>(fn: (tx: FakeTransaction) => Promise<T>) => {
      const tx: FakeTransaction = {
        get: async (ref) => {
          const r = await ref.get();
          return { exists: r.exists, data: () => r.data() };
        },
        set: (ref, data) => {
          getCol(ref._path).set(ref._id, data);
        },
        update: (ref, patch) => {
          const col = getCol(ref._path);
          const existing = col.get(ref._id) ?? {};
          col.set(ref._id, { ...existing, ...patch });
        },
      };
      return fn(tx);
    },
    _dump: () => collections,
  };
}

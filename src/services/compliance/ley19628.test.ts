// Praeventio Guard — Sprint 23 Bucket FF tests.
//
// In-memory MinimalComplianceDb fake. Mirrors the pattern used by
// `src/services/auth/projectMembership.test.ts`. No firebase-admin import.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger } from '../../utils/logger.js';
import {
  recordConsent,
  revokeConsent,
  getConsentStatus,
  requestDataAccess,
  processDataAccessRequest,
  exportUserData,
  eraseUserData,
  getProcessingActivities,
  PROCESSING_ACTIVITIES,
  ComplianceError,
  type MinimalComplianceDb,
  type MinimalCollectionRef,
  type MinimalDocRef,
  type MinimalDocSnap,
  type MinimalQuerySnap,
} from './ley19628.js';



interface DocRecord {
  id: string;
  data: Record<string, any>;
}

function makeDb(
  initial: Record<string, DocRecord[]> = {},
  ignoreUidFilterFor?: string,
  ignoreFilterField?: string,
): MinimalComplianceDb {
  const store: Record<string, Map<string, Record<string, any>>> = {};
  for (const [coll, rows] of Object.entries(initial)) {
    store[coll] = new Map(rows.map((r) => [r.id, { ...r.data }]));
  }

  let autoIdSeq = 0;
  const nextAutoId = (): string => `auto-${++autoIdSeq}`;

  function collection(name: string, filter?: { field: string; value: any }): MinimalCollectionRef {
    if (!store[name]) store[name] = new Map();
    const ref: MinimalCollectionRef = {
      doc(id?: string): MinimalDocRef {
        const docId = id ?? nextAutoId();
        return {
          id: docId,
          async get(): Promise<MinimalDocSnap> {
            const data = store[name].get(docId);
            return {
              exists: data !== undefined,
              id: docId,
              data: () => (data ? { ...data } : undefined),
            };
          },
          async set(data: any, options?: { merge?: boolean }): Promise<void> {
            if (options?.merge && store[name].has(docId)) {
              store[name].set(docId, { ...store[name].get(docId)!, ...data });
            } else {
              store[name].set(docId, { ...data });
            }
          },
          async update(data: any): Promise<void> {
            const existing = store[name].get(docId) ?? {};
            store[name].set(docId, { ...existing, ...data });
          },
          async delete(): Promise<void> {
            store[name].delete(docId);
          },
        };
      },
      async add(data: any): Promise<MinimalDocRef> {
        const docId = nextAutoId();
        store[name].set(docId, { ...data });
        return ref.doc(docId);
      },
      async get(): Promise<MinimalQuerySnap> {
        const docs: MinimalDocSnap[] = [];
        for (const [docId, data] of store[name].entries()) {
          const ignoreFilter = name === ignoreUidFilterFor &&
            (!ignoreFilterField || filter?.field === ignoreFilterField);
          if (filter && !ignoreFilter && data[filter.field] !== filter.value) continue;
          docs.push({
            exists: true,
            id: docId,
            data: () => ({ ...data }),
          });
        }
        return { empty: docs.length === 0, docs };
      },
      where(field: string, op: string, value: any): MinimalCollectionRef {
        if (op !== '==') {
          throw new Error(`fake supports only '==' (got ${op})`);
        }
        return collection(name, { field, value });
      },
    };
    return ref;
  }

  return { collection: (name: string) => collection(name) };
}

describe('compliance/ley19628', () => {
  let db: MinimalComplianceDb;
  beforeEach(() => {
    db = makeDb();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('1. recordConsent persists with grantedAt and is queryable by uid', async () => {
    const rec = await recordConsent(db, {
      uid: 'uid-A',
      purpose: 'analytics',
      granted: true,
      legalBasis: 'consent',
      textVersion: 'consent_v1.0',
    });
    expect(rec.uid).toBe('uid-A');
    expect(rec.granted).toBe(true);
    expect(typeof rec.grantedAt).toBe('number');
    expect(rec.grantedAt).toBeGreaterThan(0);

    const status = await getConsentStatus(db, 'uid-A');
    expect(status.analytics).toBeDefined();
    expect(status.analytics.granted).toBe(true);
    expect(status.analytics.textVersion).toBe('consent_v1.0');
  });

  it('2. revokeConsent updates record to granted:false with revokedAt', async () => {
    await recordConsent(db, {
      uid: 'uid-A',
      purpose: 'marketing',
      granted: true,
      legalBasis: 'consent',
      textVersion: 'consent_v1.0',
    });
    await revokeConsent(db, 'uid-A', 'marketing');

    const status = await getConsentStatus(db, 'uid-A');
    expect(status.marketing.granted).toBe(false);
    expect(status.marketing.revokedAt).toBeGreaterThan(0);
  });

  it('2b. revokeConsent for core_service is rejected (account erasure required)', async () => {
    await expect(revokeConsent(db, 'uid-A', 'core_service')).rejects.toBeInstanceOf(
      ComplianceError,
    );
  });

  it('3. getConsentStatus returns latest record per purpose, scoped to uid', async () => {
    await recordConsent(db, {
      uid: 'uid-A',
      purpose: 'analytics',
      granted: true,
      legalBasis: 'consent',
      textVersion: 'v1',
    });
    await recordConsent(db, {
      uid: 'uid-B',
      purpose: 'analytics',
      granted: false,
      legalBasis: 'consent',
      textVersion: 'v1',
    });

    const statusA = await getConsentStatus(db, 'uid-A');
    expect(statusA.analytics.granted).toBe(true);

    const statusB = await getConsentStatus(db, 'uid-B');
    expect(statusB.analytics.granted).toBe(false);

    // Cross-tenant safety: uid-A status must NOT contain uid-B's data.
    expect(Object.keys(statusA)).toEqual(['analytics']);
  });

  it('4. requestDataAccess creates a pending DataAccessRequest', async () => {
    const req = await requestDataAccess(db, 'uid-A', 'access');
    expect(req.id).toBeTruthy();
    expect(req.uid).toBe('uid-A');
    expect(req.type).toBe('access');
    expect(req.status).toBe('pending');
    expect(typeof req.requestedAt).toBe('number');
  });

  it('4b. requestDataAccess rejects unknown types', async () => {
    await expect(
      requestDataAccess(db, 'uid-A', 'bogus' as any),
    ).rejects.toBeInstanceOf(ComplianceError);
  });

  it('5. exportUserData includes ONLY the requested uid (no cross-tenant leak)', async () => {
    // Seed 3 users — only uid-A is being exported.
    db = makeDb({
      users: [
        { id: 'doc-A', data: { uid: 'uid-A', name: 'Alice' } },
        { id: 'doc-B', data: { uid: 'uid-B', name: 'Bob' } },
        { id: 'doc-C', data: { uid: 'uid-C', name: 'Carol' } },
      ],
      compliance_consents: [
        {
          id: 'uid-A__analytics',
          data: {
            uid: 'uid-A',
            purpose: 'analytics',
            granted: true,
            legalBasis: 'consent',
            textVersion: 'v1',
            grantedAt: 1,
          },
        },
        {
          id: 'uid-B__analytics',
          data: {
            uid: 'uid-B',
            purpose: 'analytics',
            granted: true,
            legalBasis: 'consent',
            textVersion: 'v1',
            grantedAt: 1,
          },
        },
      ],
    });

    const out = await exportUserData(db, 'uid-A');
    expect(out.uid).toBe('uid-A');
    expect(out.data.users).toEqual([{ id: 'doc-A', uid: 'uid-A', name: 'Alice' }]);
    expect(out.data.compliance_consents).toHaveLength(1);
    expect((out.data.compliance_consents[0] as any).uid).toBe('uid-A');

    // Make doubly sure uid-B doesn't appear anywhere.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('uid-B');
    expect(serialized).not.toContain('Bob');
    expect(serialized).not.toContain('uid-C');
    expect(serialized).not.toContain('Carol');
  });

  it('6. eraseUserData with keepLegalRecords:true preserves audit_logs (Ley 16.744)', async () => {
    db = makeDb({
      users: [{ id: 'doc-A', data: { uid: 'uid-A', name: 'Alice' } }],
      audit_logs: [
        { id: 'audit-1', data: { userId: 'uid-A', action: 'login' } },
      ],
      incidents: [
        { id: 'inc-1', data: { reporterUid: 'uid-A', title: 'fall' } },
      ],
    });

    const result = await eraseUserData(db, 'uid-A', { keepLegalRecords: true });
    expect(result.preserved).toContain('audit_logs');
    expect(result.preserved).toContain('incidents');
    // users row should have been erased.
    const usersAfter = await db.collection('users').where('uid', '==', 'uid-A').get();
    expect(usersAfter.empty).toBe(true);
    // audit_logs row must remain.
    const auditAfter = await db
      .collection('audit_logs')
      .where('userId', '==', 'uid-A')
      .get();
    expect(auditAfter.docs).toHaveLength(1);
  });

  it('7. eraseUserData with keepLegalRecords:false purges audit_logs too', async () => {
    db = makeDb({
      users: [{ id: 'doc-A', data: { uid: 'uid-A', name: 'Alice' } }],
      audit_logs: [
        { id: 'audit-1', data: { userId: 'uid-A', action: 'login' } },
        { id: 'audit-2', data: { userId: 'uid-B', action: 'login' } },
      ],
    });

    const result = await eraseUserData(db, 'uid-A', { keepLegalRecords: false });
    expect(result.preserved).toEqual([]);
    // uid-A audit row gone.
    const auditA = await db
      .collection('audit_logs')
      .where('userId', '==', 'uid-A')
      .get();
    expect(auditA.empty).toBe(true);
    // uid-B audit row preserved (not part of the erasure target).
    const auditB = await db
      .collection('audit_logs')
      .where('userId', '==', 'uid-B')
      .get();
    expect(auditB.docs).toHaveLength(1);
  });

  it('stops erasure when an overbroad query returns another subject', async () => {
    db = makeDb(
      { users: [{ id: 'foreign', data: { uid: 'uid-B', name: 'Bob' } }] },
      'users',
    );

    const outcome = await eraseUserData(db, 'uid-A').catch((error: unknown) => error);

    // Inspect durable fake state: a failing response alone cannot undo a delete.
    expect((await db.collection('users').doc('foreign').get()).exists).toBe(true);
    expect(outcome).toBeInstanceOf(ComplianceError);
    expect(outcome).toMatchObject({
      code: 'erasure_subject_mismatch',
      httpStatus: 409,
    });
  });

  it('stops explicit legal purge when a query returns another subject', async () => {
    db = makeDb(
      { audit_logs: [{ id: 'foreign-audit', data: { userId: 'uid-B', action: 'login' } }] },
      'audit_logs',
    );

    const outcome = await eraseUserData(db, 'uid-A', { keepLegalRecords: false })
      .catch((error: unknown) => error);

    expect((await db.collection('audit_logs').doc('foreign-audit').get()).exists).toBe(true);
    expect(outcome).toBeInstanceOf(ComplianceError);
    expect(outcome).toMatchObject({ code: 'erasure_subject_mismatch', httpStatus: 409 });
  });

  it('signals a subject mismatch without adding personal data to warning metadata', async () => {
    db = makeDb(
      { users: [{ id: 'private-doc', data: { uid: 'uid-B', name: 'Bob' } }] },
      'users',
    );

    await expect(eraseUserData(db, 'uid-A')).rejects.toBeInstanceOf(ComplianceError);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'compliance_erasure_subject_mismatch',
      { collection: 'users' },
    );
    const warning = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    for (const privateValue of ['uid-A', 'uid-B', 'private-doc', 'Bob']) {
      expect(warning).not.toContain(privateValue);
    }
  });

  it.each([
    ['users', 'uid'],
    ['compliance_consents', 'uid'],
    ['compliance_data_requests', 'uid'],
    ['curriculum_claims', 'uid'],
    ['gamification_xp', 'uid'],
    ['commute_sessions', 'uid'],
    ['notifications', 'recipientUid'],
  ])('checks the configured subject field in %s.%s', async (collection, field) => {
    db = makeDb(
      { [collection]: [{ id: 'foreign', data: { uid: 'uid-A', [field]: 'uid-B' } }] },
      collection,
    );

    await expect(eraseUserData(db, 'uid-A')).rejects.toMatchObject({
      code: 'erasure_subject_mismatch',
    });
    expect((await db.collection(collection).doc('foreign').get()).exists).toBe(true);
  });

  it.each([undefined, null, 42, { uid: 'uid-A' }])(
    'fails closed for missing or invalid record ownership (%j)',
    async (owner) => {
      db = makeDb({ users: [{ id: 'unowned', data: { uid: owner } }] }, 'users');

      await expect(eraseUserData(db, 'uid-A')).rejects.toMatchObject({
        code: 'erasure_subject_mismatch',
      });
      expect((await db.collection('users').doc('unowned').get()).exists).toBe(true);
    },
  );

  it.each([false, true])(
    'validates the entire snapshot before deleting any mixed row (reverse=%s)',
    async (reverse) => {
      const rows = [
        { id: 'own', data: { uid: 'uid-A' } },
        { id: 'foreign', data: { uid: 'uid-B' } },
      ];
      db = makeDb({ users: reverse ? rows.reverse() : rows }, 'users');

      await expect(eraseUserData(db, 'uid-A')).rejects.toBeInstanceOf(ComplianceError);
      for (const id of ['own', 'foreign']) {
        expect((await db.collection('users').doc(id).get()).exists).toBe(true);
      }
    },
  );

  it.each(
    ['audit_logs', 'incidents', 'sos_alerts'].flatMap((collection) =>
      ['userId', 'reporterUid', 'workerUid', 'uid'].map((field) => [collection, field]),
    ),
  )('checks each explicit legal-purge query in %s.%s', async (collection, field) => {
    db = makeDb(
      { [collection]: [{ id: 'foreign', data: { [field]: 'uid-B' } }] },
      collection,
      field,
    );

    await expect(eraseUserData(db, 'uid-A', { keepLegalRecords: false }))
      .rejects.toMatchObject({ code: 'erasure_subject_mismatch' });
    expect((await db.collection(collection).doc('foreign').get()).exists).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'compliance_erasure_subject_mismatch',
      { collection },
    );
  });

  it.each([undefined, true])('keeps legal records without querying them (%s)', async (keepLegalRecords) => {
    db = makeDb({
      audit_logs: [{ id: 'a', data: { userId: 'uid-A' } }],
      incidents: [{ id: 'i', data: { reporterUid: 'uid-A' } }],
      sos_alerts: [{ id: 's', data: { workerUid: 'uid-A' } }],
    });
    const collectionSpy = vi.spyOn(db, 'collection');

    const result = await eraseUserData(db, 'uid-A', { keepLegalRecords });
    expect(result.preserved).toEqual(['audit_logs', 'incidents', 'sos_alerts']);
    expect(result.erased).toEqual([]);
    for (const collection of ['audit_logs', 'incidents', 'sos_alerts']) {
      expect(collectionSpy).not.toHaveBeenCalledWith(collection);
    }
    for (const [collection, id] of [['audit_logs', 'a'], ['incidents', 'i'], ['sos_alerts', 's']]) {
      expect((await db.collection(collection).doc(id).get()).exists).toBe(true);
    }
  });

  it('rejects the processing request instead of marking an anomalous erasure completed', async () => {
    db = makeDb({ users: [{ id: 'foreign', data: { uid: 'uid-B' } }] }, 'users');
    const req = await requestDataAccess(db, 'uid-A', 'erasure');

    await expect(processDataAccessRequest(db, req.id, {
      onErase: async (pending) => { await eraseUserData(db, pending.uid); },
    })).rejects.toMatchObject({ code: 'erasure_subject_mismatch' });

    const stored = (await db.collection('compliance_data_requests').doc(req.id).get()).data();
    expect(stored?.status).toBe('rejected');
    expect(stored?.rejectionReason).toBe('Erasure stopped: document subject does not match the request.');
    expect((await db.collection('users').doc('foreign').get()).exists).toBe(true);
  });

  it.each(['get', 'delete'])('propagates explicit legal-purge %s failures', async (stage) => {
    db = makeDb({ audit_logs: [{ id: 'own', data: { userId: 'uid-A' } }] });
    const failure = new Error('storage unavailable');
    const originalCollection = db.collection.bind(db);
    vi.spyOn(db, 'collection').mockImplementation((name) => {
      const ref = originalCollection(name);
      if (name !== 'audit_logs') return ref;
      if (stage === 'delete') {
        return { ...ref, doc: (id) => ({
          ...ref.doc(id),
          delete: async () => { throw failure; },
        }) };
      }
      return { ...ref, where: (field, op, value) => ({
        ...ref.where(field, op, value),
        get: async () => { throw failure; },
      }) };
    });

    await expect(eraseUserData(db, 'uid-A', { keepLegalRecords: false }))
      .rejects.toBe(failure);
    expect((await db.collection('audit_logs').doc('own').get()).exists).toBe(true);
  });

  it.each([
    ['users', 'uid'],
    ['compliance_consents', 'uid'],
    ['compliance_data_requests', 'uid'],
    ['curriculum_claims', 'uid'],
    ['gamification_xp', 'uid'],
    ['commute_sessions', 'uid'],
    ['notifications', 'recipientUid'],
  ])('still erases only matching subjects in %s.%s', async (collection, field) => {
    db = makeDb({ [collection]: [
      { id: 'own', data: { [field]: 'uid-A' } },
      { id: 'foreign', data: { [field]: 'uid-B' } },
    ] });

    const result = await eraseUserData(db, 'uid-A');
    expect(result.erased).toContain(`${collection}:1`);
    expect((await db.collection(collection).doc('own').get()).exists).toBe(false);
    expect((await db.collection(collection).doc('foreign').get()).exists).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(
    ['audit_logs', 'incidents', 'sos_alerts'].flatMap((collection) =>
      ['userId', 'reporterUid', 'workerUid', 'uid'].map((field) => [collection, field]),
    ),
  )('still purges only matching legal records in %s.%s', async (collection, field) => {
    db = makeDb({ [collection]: [
      { id: 'own', data: { [field]: 'uid-A' } },
      { id: 'foreign', data: { [field]: 'uid-B' } },
    ] });

    const result = await eraseUserData(db, 'uid-A', { keepLegalRecords: false });
    expect(result.preserved).toEqual([]);
    expect(result.erased).toContain(`${collection}:legal_purged`);
    expect((await db.collection(collection).doc('own').get()).exists).toBe(false);
    expect((await db.collection(collection).doc('foreign').get()).exists).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('8. PROCESSING_ACTIVITIES catalog has every required field for each entry', () => {
    const activities = getProcessingActivities();
    expect(activities.length).toBeGreaterThanOrEqual(5);
    expect(activities).toBe(PROCESSING_ACTIVITIES);
    for (const a of activities) {
      expect(a.id).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(a.purpose).toBeTruthy();
      expect(a.legalBasis).toBeTruthy();
      expect(Array.isArray(a.dataCategories)).toBe(true);
      expect(a.dataCategories.length).toBeGreaterThan(0);
      expect(Array.isArray(a.dataSubjects)).toBe(true);
      expect(Array.isArray(a.recipients)).toBe(true);
      expect(typeof a.internationalTransfer).toBe('boolean');
      expect(a.retention).toBeTruthy();
      expect(Array.isArray(a.technicalMeasures)).toBe(true);
    }
    // IDs must be unique.
    const ids = activities.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('9. processDataAccessRequest dispatches export handler and marks completed', async () => {
    const req = await requestDataAccess(db, 'uid-A', 'access');
    const onExport = async () => ({ downloadUrl: 'https://signed.example/abc' });
    const completed = await processDataAccessRequest(db, req.id, { onExport });
    expect(completed.status).toBe('completed');
    expect(completed.exportedToUrl).toBe('https://signed.example/abc');
    expect(completed.completedAt).toBeGreaterThan(0);
  });
});

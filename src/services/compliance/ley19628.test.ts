// Praeventio Guard — Sprint 23 Bucket FF tests.
//
// In-memory MinimalComplianceDb fake. Mirrors the pattern used by
// `src/services/auth/projectMembership.test.ts`. No firebase-admin import.

import { describe, it, expect, beforeEach } from 'vitest';
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

function makeDb(initial: Record<string, DocRecord[]> = {}): MinimalComplianceDb {
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
          if (filter && data[filter.field] !== filter.value) continue;
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
  });

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

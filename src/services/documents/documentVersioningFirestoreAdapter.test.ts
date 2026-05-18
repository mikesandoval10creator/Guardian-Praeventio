// Praeventio Guard — DocumentVersioningAdapter unit tests.

import { describe, it, expect } from 'vitest';
import {
  DocumentVersioningAdapter,
  DocumentVersionImmutabilityViolation,
} from './documentVersioningFirestoreAdapter.js';
import type { DocumentVersion } from './documentVersioning.js';

interface DocStub {
  data: Record<string, unknown> | null;
}

function makeDb() {
  const store = new Map<string, Map<string, DocStub>>();
  const getCol = (path: string) => {
    if (!store.has(path)) store.set(path, new Map());
    return store.get(path)!;
  };
  return {
    collection(path: string) {
      const col = getCol(path);
      return {
        doc(id: string) {
          return {
            id,
            async get() {
              const d = col.get(id);
              return {
                exists: !!d,
                data: () => d?.data ?? undefined,
              };
            },
            async set(
              data: Record<string, unknown>,
              opts?: { merge?: boolean },
            ) {
              const prev = col.get(id)?.data ?? null;
              if (opts?.merge && prev) {
                col.set(id, { data: { ...prev, ...data } });
              } else {
                col.set(id, { data: { ...data } });
              }
            },
          };
        },
        async get() {
          return {
            docs: [...col.entries()].map(([id, d]) => ({
              id,
              data: () => d.data ?? {},
            })),
          };
        },
      };
    },
    __store: store,
  };
}

const TENANT = 'tenant_acme';
const PROJECT = 'project_norte';
const DOC_ID = 'pts-altura-norte';

function buildVersion(over: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    documentId: DOC_ID,
    versionId: '1.0.0',
    content: '# PTS Trabajo en altura',
    contentHash: 'a'.repeat(64),
    status: 'draft',
    authorUid: 'author_pedro',
    createdAt: '2026-05-18T10:00:00Z',
    ...over,
  };
}

describe('DocumentVersioningAdapter.saveNewVersion', () => {
  it('persists a fresh version and mirrors latest on chain doc', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    const v = buildVersion();
    await adapter.saveNewVersion(v);
    const fetched = await adapter.getVersion(DOC_ID, '1.0.0');
    expect(fetched?.versionId).toBe('1.0.0');
    // Chain doc mirror
    const chainDoc = await db
      .collection(`tenants/${TENANT}/projects/${PROJECT}/document_chains`)
      .doc(DOC_ID)
      .get();
    expect(chainDoc.exists).toBe(true);
    expect(chainDoc.data()?.latestVersionId).toBe('1.0.0');
  });

  it('refuses to overwrite an existing version (immutability guard)', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    await adapter.saveNewVersion(buildVersion());
    await expect(adapter.saveNewVersion(buildVersion())).rejects.toBeInstanceOf(
      DocumentVersionImmutabilityViolation,
    );
  });
});

describe('DocumentVersioningAdapter.setStatus', () => {
  it('stamps approverUid + approvedAt when transitioning to approved', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    await adapter.saveNewVersion(buildVersion({ status: 'in_review' }));
    await adapter.setStatus(DOC_ID, '1.0.0', 'approved', 'approver_juan');
    const fetched = await adapter.getVersion(DOC_ID, '1.0.0');
    expect(fetched?.status).toBe('approved');
    expect(fetched?.approvedByUid).toBe('approver_juan');
    expect(fetched?.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects approve without approverUid (forces audit trail)', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    await adapter.saveNewVersion(buildVersion({ status: 'in_review' }));
    await expect(
      adapter.setStatus(DOC_ID, '1.0.0', 'approved'),
    ).rejects.toBeInstanceOf(DocumentVersionImmutabilityViolation);
  });

  it('rejects status transitions away from terminal superseded', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    await adapter.saveNewVersion(buildVersion({ status: 'superseded' }));
    await expect(
      adapter.setStatus(DOC_ID, '1.0.0', 'approved', 'approver_juan'),
    ).rejects.toBeInstanceOf(DocumentVersionImmutabilityViolation);
  });

  it('rejects status transitions away from terminal retired', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    await adapter.saveNewVersion(buildVersion({ status: 'retired' }));
    await expect(
      adapter.setStatus(DOC_ID, '1.0.0', 'approved', 'approver_juan'),
    ).rejects.toBeInstanceOf(DocumentVersionImmutabilityViolation);
  });

  it('is a no-op when the version does not exist (silent skip)', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    await expect(
      adapter.setStatus(DOC_ID, '99.9.9', 'approved', 'a'),
    ).resolves.toBeUndefined();
  });
});

describe('DocumentVersioningAdapter.supersedeVersion', () => {
  it('marks previous as superseded and stamps the link', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    await adapter.saveNewVersion(buildVersion({ versionId: '1.0.0', status: 'approved' }));
    await adapter.saveNewVersion(buildVersion({ versionId: '1.1.0' }));
    await adapter.supersedeVersion(DOC_ID, '1.0.0', '1.1.0');
    const old = await adapter.getVersion(DOC_ID, '1.0.0');
    expect(old?.status).toBe('superseded');
    expect(old?.supersededByVersionId).toBe('1.1.0');
    expect(old?.supersededAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('DocumentVersioningAdapter.getChain', () => {
  it('returns all versions when chain has multiple entries', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    await adapter.saveNewVersion(buildVersion({ versionId: '1.0.0', status: 'approved' }));
    await adapter.saveNewVersion(
      buildVersion({ versionId: '1.1.0', status: 'in_review' }),
    );
    const chain = await adapter.getChain(DOC_ID);
    expect(chain?.versions).toHaveLength(2);
    expect(chain?.documentId).toBe(DOC_ID);
  });

  it('returns null for a documentId with no versions', async () => {
    const db = makeDb();
    const adapter = new DocumentVersioningAdapter(db, TENANT, PROJECT);
    const chain = await adapter.getChain('unknown_doc');
    expect(chain).toBeNull();
  });
});

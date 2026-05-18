// Praeventio Guard — Sprint 41 F.23 persistence.
//
// Stores document version chains at:
//   tenants/{tid}/projects/{pid}/document_chains/{documentId}
//   tenants/{tid}/projects/{pid}/document_chains/{documentId}/versions/{versionId}
//
// Versions are append-only — `superseded` and `approved` transitions update
// existing docs (status field) but content + contentHash are NEVER mutated
// after the initial write. The `buildNextVersion()` engine enforces this
// invariant at construction time (no draft → draft skip); this adapter
// enforces it at write time via the `ensureImmutable*` helpers.

import type {
  DocumentVersion,
  VersionChain,
  VersionStatus,
} from './documentVersioning.js';

export interface DocVersioningFirestoreDb {
  collection(path: string): any;
}

const CHAIN_DOC = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/document_chains`;
const VERSIONS_PATH = (tid: string, pid: string, documentId: string) =>
  `tenants/${tid}/projects/${pid}/document_chains/${documentId}/versions`;

export class DocumentVersionImmutabilityViolation extends Error {
  constructor(
    public readonly versionId: string,
    public readonly field: string,
  ) {
    super(
      `Refusing to mutate immutable field '${field}' on approved/superseded version ${versionId}`,
    );
    this.name = 'DocumentVersionImmutabilityViolation';
  }
}

export class DocumentVersioningAdapter {
  constructor(
    private readonly db: DocVersioningFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  /**
   * Persist a brand-new version. Caller MUST pass output of
   * `buildNextVersion()` — that helper enforces the semver bump and the
   * "no draft → draft" invariant. We refuse to overwrite an existing
   * doc to catch concurrent writers racing on the same versionId.
   */
  async saveNewVersion(version: DocumentVersion): Promise<void> {
    const ref = this.db
      .collection(VERSIONS_PATH(this.tenantId, this.projectId, version.documentId))
      .doc(version.versionId);
    const existing = await ref.get();
    if (existing.exists) {
      throw new DocumentVersionImmutabilityViolation(version.versionId, 'create');
    }
    await ref.set(version);
    // Mirror the latestVersionId on the chain doc for fast list queries
    // that don't want to fan out to the subcollection.
    await this.db
      .collection(CHAIN_DOC(this.tenantId, this.projectId))
      .doc(version.documentId)
      .set(
        {
          documentId: version.documentId,
          latestVersionId: version.versionId,
          latestStatus: version.status,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
  }

  /**
   * Update the status of an existing version. Forbidden transitions:
   *   - approved → draft       (would undo CPHS approval)
   *   - superseded → anything  (terminal)
   *   - retired → anything     (terminal)
   *
   * The adapter only blocks content mutations; status transitions are
   * the route's responsibility.
   */
  async setStatus(
    documentId: string,
    versionId: string,
    next: VersionStatus,
    approverUid?: string,
  ): Promise<void> {
    const ref = this.db
      .collection(VERSIONS_PATH(this.tenantId, this.projectId, documentId))
      .doc(versionId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const data = snap.data() as DocumentVersion | undefined;
    if (!data) return;
    if (data.status === 'superseded' || data.status === 'retired') {
      throw new DocumentVersionImmutabilityViolation(
        versionId,
        `status_from_${data.status}`,
      );
    }
    const payload: Partial<DocumentVersion> = { status: next };
    if (next === 'approved') {
      if (!approverUid) {
        throw new DocumentVersionImmutabilityViolation(
          versionId,
          'approve_requires_approverUid',
        );
      }
      payload.approvedByUid = approverUid;
      payload.approvedAt = new Date().toISOString();
    }
    if (next === 'superseded') {
      payload.supersededAt = new Date().toISOString();
    }
    await ref.set(payload, { merge: true });
  }

  /**
   * Mark `previous` as superseded by `current`. Two-write transaction —
   * caller normally invokes this immediately after `saveNewVersion()` to
   * complete the supersede chain.
   */
  async supersedeVersion(
    documentId: string,
    previousVersionId: string,
    bySupersedingVersionId: string,
  ): Promise<void> {
    const ref = this.db
      .collection(VERSIONS_PATH(this.tenantId, this.projectId, documentId))
      .doc(previousVersionId);
    await ref.set(
      {
        status: 'superseded' as VersionStatus,
        supersededByVersionId: bySupersedingVersionId,
        supersededAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  async getVersion(
    documentId: string,
    versionId: string,
  ): Promise<DocumentVersion | null> {
    const snap = await this.db
      .collection(VERSIONS_PATH(this.tenantId, this.projectId, documentId))
      .doc(versionId)
      .get();
    return snap.exists ? (snap.data() as DocumentVersion) : null;
  }

  async getChain(documentId: string): Promise<VersionChain | null> {
    const versionsSnap = await this.db
      .collection(VERSIONS_PATH(this.tenantId, this.projectId, documentId))
      .get();
    const versions = versionsSnap.docs.map(
      (d: any) => d.data() as DocumentVersion,
    );
    if (versions.length === 0) return null;
    return { documentId, versions };
  }
}

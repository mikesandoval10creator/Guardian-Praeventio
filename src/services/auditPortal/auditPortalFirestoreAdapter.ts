// Persistence #8: externalAuditPortal adapter.
// Schema:
//   tenants/{tid}/audit_portals/{id}                  ← portal config
//   tenants/{tid}/audit_portals/{id}/access_logs/{at} ← subcollection logs
//
// CRITICAL: Storing the accessToken in plaintext leaks the auditor's key
// to anyone with Firestore read access. We store SHA-256 of the token
// (`accessTokenHash`) and use that for lookups. The plaintext token is
// returned ONLY once at create time so the operator can hand it to the
// auditor.
//
// Indexes: (accessTokenHash), (expiresAt), (auditorAffiliation, createdAt desc)

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
  AuditPortalConfig,
  PortalAccessLog,
  AuditorAffiliation,
} from './externalAuditPortal.js';

export interface AuditPortalFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string) => `tenants/${tid}/audit_portals`;
const LOG_PATH = (tid: string, portalId: string) =>
  `tenants/${tid}/audit_portals/${portalId}/access_logs`;

export function hashAccessToken(token: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

/** Portal as stored in Firestore: token is replaced by hash. */
export type StoredAuditPortal = Omit<AuditPortalConfig, 'accessToken'> & {
  accessTokenHash: string;
};

export class AuditPortalAdapter {
  constructor(
    private readonly db: AuditPortalFirestoreDb,
    private readonly tenantId: string,
  ) {}

  /** Persist portal. The plaintext token is hashed before storage. */
  async save(portal: AuditPortalConfig): Promise<void> {
    const { accessToken, ...rest } = portal;
    const stored: StoredAuditPortal = {
      ...rest,
      accessTokenHash: hashAccessToken(accessToken),
    };
    await this.db.collection(PATH(this.tenantId)).doc(portal.id).set(stored);
  }

  async getById(id: string): Promise<StoredAuditPortal | null> {
    const snap = await this.db.collection(PATH(this.tenantId)).doc(id).get();
    return snap.exists ? (snap.data() as StoredAuditPortal) : null;
  }

  /** Resolve portal by token (hashing the incoming token to compare). */
  async findByToken(token: string): Promise<StoredAuditPortal | null> {
    const hash = hashAccessToken(token);
    const snap = await this.db
      .collection(PATH(this.tenantId))
      .where('accessTokenHash', '==', hash)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data() as StoredAuditPortal;
  }

  async markRevoked(
    portalId: string,
    revokedAt: string,
    revokedByUid: string,
    revokedReason: string,
  ): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId))
      .doc(portalId)
      .update({ revokedAt, revokedByUid, revokedReason });
  }

  async listByAffiliation(
    auditorAffiliation: AuditorAffiliation,
    limitN = 50,
  ): Promise<StoredAuditPortal[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId))
      .where('auditorAffiliation', '==', auditorAffiliation)
      .orderBy('createdAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as StoredAuditPortal);
  }

  /** Log subcollection write — log id = accessedAt ISO (assumed unique). */
  async appendAccessLog(log: PortalAccessLog): Promise<void> {
    await this.db
      .collection(LOG_PATH(this.tenantId, log.portalId))
      .doc(log.accessedAt)
      .set(log);
  }

  async listAccessLogs(portalId: string, limitN = 200): Promise<PortalAccessLog[]> {
    const snap = await this.db
      .collection(LOG_PATH(this.tenantId, portalId))
      .orderBy('accessedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as PortalAccessLog);
  }
}

// Praeventio Guard — Sprint 41 F.22 persistence.
//
// Stores completed MicroTrainingSession docs at:
//   tenants/{tid}/projects/{pid}/microtraining_sessions/{auto}
//
// Certified modules per worker live at:
//   tenants/{tid}/projects/{pid}/workers/{workerUid}/microtraining_certs/{moduleId}
//
// Two writes happen on a passing certifyOnPass session:
//   1. session doc (immutable record)
//   2. cert doc (one-per-(worker, module), so the next selector skips it)
//
// We use simple set+merge — no transactions because the cert doc is
// idempotent on (workerUid, moduleId).

import type {
  MicroTrainingSession,
  MicroTrainingModule,
  RiskCategory,
} from './lightningTrainingService.js';

export interface MicrotrainingFirestoreDb {
  collection(path: string): any;
}

const SESSIONS_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/microtraining_sessions`;
const CERTS_PATH = (tid: string, pid: string, workerUid: string) =>
  `tenants/${tid}/projects/${pid}/workers/${workerUid}/microtraining_certs`;

export interface StoredMicroTrainingCert {
  moduleId: string;
  workerUid: string;
  /** Score 0-100 of the session that earned the cert. */
  score: number;
  /** Risk category covered. */
  riskCategory: RiskCategory;
  /** ISO timestamp of certification. */
  certifiedAt: string;
  /** Source session id, for audit. */
  sessionId: string;
}

export class MicrotrainingAdapter {
  constructor(
    private readonly db: MicrotrainingFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  /**
   * Persist a completed session. Returns the auto-generated id so the
   * caller can correlate it with the cert (if one is granted).
   */
  async saveSession(session: MicroTrainingSession): Promise<string> {
    const ref = this.db.collection(SESSIONS_PATH(this.tenantId, this.projectId)).doc();
    const id = ref.id;
    await ref.set({ ...session, id, recordedAt: new Date().toISOString() });
    return id;
  }

  /**
   * Idempotent cert write at `{workerUid}/{moduleId}`. Subsequent passes
   * for the same module update the score/timestamp without spawning
   * duplicate docs (the selector only checks presence).
   */
  async grantCert(
    workerUid: string,
    moduleId: string,
    cert: Omit<StoredMicroTrainingCert, 'moduleId' | 'workerUid'>,
  ): Promise<void> {
    const ref = this.db
      .collection(CERTS_PATH(this.tenantId, this.projectId, workerUid))
      .doc(moduleId);
    await ref.set(
      {
        moduleId,
        workerUid,
        ...cert,
      } satisfies StoredMicroTrainingCert,
      { merge: true },
    );
  }

  async listCertsForWorker(
    workerUid: string,
  ): Promise<StoredMicroTrainingCert[]> {
    const snap = await this.db
      .collection(CERTS_PATH(this.tenantId, this.projectId, workerUid))
      .get();
    return snap.docs.map((d: any) => d.data() as StoredMicroTrainingCert);
  }

  /**
   * Workers don't need every detail of a module on the homepage — the
   * `certifiedModuleIds` projection is enough for `selectMicroModule`.
   */
  async listCertifiedModuleIds(workerUid: string): Promise<string[]> {
    const certs = await this.listCertsForWorker(workerUid);
    return certs.map((c) => c.moduleId);
  }

  async listSessionsForWorker(
    workerUid: string,
    limitN = 20,
  ): Promise<MicroTrainingSession[]> {
    const snap = await this.db
      .collection(SESSIONS_PATH(this.tenantId, this.projectId))
      .where('workerUid', '==', workerUid)
      .orderBy('startedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as MicroTrainingSession);
  }
}

/**
 * Convenience: build a `StoredMicroTrainingCert` from a passing session.
 */
export function buildCertFromSession(
  session: MicroTrainingSession,
  module: MicroTrainingModule,
  sessionId: string,
): Omit<StoredMicroTrainingCert, 'moduleId' | 'workerUid'> {
  return {
    score: session.score ?? 0,
    riskCategory: module.riskCategory,
    certifiedAt: new Date(session.completedAt ?? Date.now()).toISOString(),
    sessionId,
  };
}

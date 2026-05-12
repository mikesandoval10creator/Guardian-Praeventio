// Persistence #20: confidential reports adapter.
// Schema:
//   tenants/{tid}/projects/{pid}/confidential_reports/{id}
//   tenants/{tid}/projects/{pid}/confidential_reports/{id}/audit/{at}
//
// CRITICAL: solo `confidential_handler`, `legal_counsel`, `hr_director`
// y el autor identificado pueden leer. Firestore rules deben enforce
// la misma política — este adapter NO valida acceso (el servidor sí).
//
// Audit subcollection inmutable: cada acceso queda registrado.

import type {
  ConfidentialReport,
  ConfidentialReportKind,
  ReportStatus,
} from './confidentialReportsService.js';

export interface ConfidentialReportsFirestoreDb {
  collection(path: string): any;
}

const REPORT_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/confidential_reports`;
const AUDIT_PATH = (tid: string, pid: string, reportId: string) =>
  `tenants/${tid}/projects/${pid}/confidential_reports/${reportId}/audit`;

export interface ReportAuditEvent {
  /** ISO-8601 — doc id. */
  at: string;
  actorUid: string;
  actorRole: string;
  kind: 'read' | 'status_change' | 'note_added' | 'handler_assigned' | 'exported';
  detail?: string;
}

export class ConfidentialReportsAdapter {
  constructor(
    private readonly db: ConfidentialReportsFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(report: ConfidentialReport): Promise<void> {
    await this.db
      .collection(REPORT_PATH(this.tenantId, this.projectId))
      .doc(report.id)
      .set(report);
  }

  async getById(id: string): Promise<ConfidentialReport | null> {
    const snap = await this.db
      .collection(REPORT_PATH(this.tenantId, this.projectId))
      .doc(id)
      .get();
    return snap.exists ? (snap.data() as ConfidentialReport) : null;
  }

  async updateStatus(
    id: string,
    status: ReportStatus,
    patch: Partial<
      Pick<
        ConfidentialReport,
        'acknowledgedAt' | 'investigationStartedAt' | 'resolvedAt' | 'resolutionNotes' | 'handlerUid'
      >
    > = {},
  ): Promise<void> {
    await this.db
      .collection(REPORT_PATH(this.tenantId, this.projectId))
      .doc(id)
      .update({ status, ...patch });
  }

  async listByKind(
    kind: ConfidentialReportKind,
    limitN = 50,
  ): Promise<ConfidentialReport[]> {
    const snap = await this.db
      .collection(REPORT_PATH(this.tenantId, this.projectId))
      .where('kind', '==', kind)
      .orderBy('submittedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as ConfidentialReport);
  }

  async listPendingByHandler(handlerUid: string): Promise<ConfidentialReport[]> {
    const snap = await this.db
      .collection(REPORT_PATH(this.tenantId, this.projectId))
      .where('handlerUid', '==', handlerUid)
      .get();
    return snap.docs
      .map((d: any) => d.data() as ConfidentialReport)
      .filter(
        (r: ConfidentialReport) =>
          r.status !== 'resolved_substantiated' &&
          r.status !== 'resolved_unsubstantiated' &&
          r.status !== 'transferred_to_external',
      );
  }

  /** Append immutable audit event. Doc id = at ISO timestamp. */
  async appendAudit(reportId: string, event: ReportAuditEvent): Promise<void> {
    await this.db
      .collection(AUDIT_PATH(this.tenantId, this.projectId, reportId))
      .doc(event.at)
      .set(event);
  }

  async listAudit(reportId: string): Promise<ReportAuditEvent[]> {
    const snap = await this.db
      .collection(AUDIT_PATH(this.tenantId, this.projectId, reportId))
      .orderBy('at', 'desc')
      .get();
    return snap.docs.map((d: any) => d.data() as ReportAuditEvent);
  }
}

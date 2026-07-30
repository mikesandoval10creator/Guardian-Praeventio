import { NodeType, type RiskNode } from '../../types';
import type { ExpressBundleInput } from './expressBundleBuilder';
import type {
  CategoryStatus,
  ComplianceCategory,
  ComplianceTrafficLightResult,
  TrafficLight,
} from '../compliance/trafficLightEngine';

export type ExpressBundleData = ExpressBundleInput['data'];

type Metadata = Record<string, unknown>;

const LEGAL_CATEGORIES = new Set([
  'committee',
  'training',
  'process',
  'document',
  'medical',
  'epp',
]);

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadata(node: RiskNode): Metadata {
  return node.metadata ?? {};
}

function documentStatus(value: unknown): 'vigente' | 'vencido' | 'pendiente_firma' | null {
  const token = text(value)?.toLocaleLowerCase('es-CL').replace(/[\s-]+/g, '_');
  if (token === 'vigente' || token === 'valid') return 'vigente';
  if (token === 'vencido' || token === 'vencida' || token === 'expired') return 'vencido';
  if (token === 'pendiente' || token === 'pendiente_firma' || token === 'pending_signature') {
    return 'pendiente_firma';
  }
  return null;
}

function trainingStatus(value: unknown): 'vigente' | 'vencido' | null {
  const status = documentStatus(value);
  return status === 'vigente' || status === 'vencido' ? status : null;
}

function severity(value: unknown): 'low' | 'medium' | 'high' | 'critical' | null {
  const token = text(value)?.toLocaleLowerCase('es-CL');
  if (token === 'low' || token === 'bajo' || token === 'baja') return 'low';
  if (token === 'medium' || token === 'medio' || token === 'media') return 'medium';
  if (token === 'high' || token === 'alto' || token === 'alta') return 'high';
  if (token === 'critical' || token === 'crítico' || token === 'crítica') return 'critical';
  return null;
}

function categoryStatus(
  category: ComplianceCategory,
  light: TrafficLight,
  summary: string,
  criticalItemIds: string[] = [],
  warningCount = 0,
): CategoryStatus {
  return { category, light, summary, criticalItemIds, warningCount };
}

function buildComplianceSnapshot(
  nodes: RiskNode[],
  data: Omit<ExpressBundleData, 'complianceSnapshot'>,
  computedAt: string,
): ComplianceTrafficLightResult {
  const expiredDocuments = data.documents.filter((item) => item.status === 'vencido');
  const pendingDocuments = data.documents.filter((item) => item.status === 'pendiente_firma');
  const expiredTrainings = data.trainings.filter((item) => item.status === 'vencido');
  const audits = nodes.filter((node) => node.type === NodeType.AUDIT);
  const incompleteAudits = audits.filter((node) => {
    const status = text(metadata(node).status)?.toLocaleLowerCase('es-CL');
    return !['completada', 'completado', 'completed', 'ejecutada', 'ejecutado'].includes(status ?? '');
  });

  const byCategory: CategoryStatus[] = [
    data.applicableProtocols.length > 0
      ? categoryStatus(
        'legal',
        'yellow',
        `${data.applicableProtocols.length} requisito(s) trazable(s); cobertura total no demostrada`,
        [],
        1,
      )
      : categoryStatus('legal', 'yellow', 'Sin evidencia legal consolidada', [], 1),
    data.documents.length === 0
      ? categoryStatus('documentation', 'yellow', 'Sin documentos schema-valid disponibles', [], 1)
      : expiredDocuments.length > 0
        ? categoryStatus('documentation', 'red', `${expiredDocuments.length} documento(s) vencido(s)`, expiredDocuments.map((item) => item.id))
        : pendingDocuments.length > 0
          ? categoryStatus('documentation', 'yellow', `${pendingDocuments.length} documento(s) pendiente(s) de firma`, [], pendingDocuments.length)
          : categoryStatus(
            'documentation',
            'yellow',
            'Sin vencidos entre documentos incluidos; cobertura total no demostrada',
            [],
            1,
          ),
    data.trainings.length === 0
      ? categoryStatus('training', 'yellow', 'Sin capacitaciones schema-valid disponibles', [], 1)
      : expiredTrainings.length > 0
        ? categoryStatus('training', 'red', `${expiredTrainings.length} capacitación(es) vencida(s)`, expiredTrainings.map((item) => item.id))
        : categoryStatus(
          'training',
          'yellow',
          'Sin vencidos entre capacitaciones incluidas; cobertura total no demostrada',
          [],
          1,
        ),
    data.eppAssignments.length > 0
      ? categoryStatus(
        'epp',
        'yellow',
        `${data.eppAssignments.length} asignación(es) trazable(s); cobertura total no demostrada`,
        [],
        1,
      )
      : categoryStatus('epp', 'yellow', 'Sin asignaciones EPP schema-valid disponibles', [], 1),
    categoryStatus('emergencies', 'yellow', 'Sin evidencia de emergencias consolidada en este índice', [], 1),
    categoryStatus('occupational_health', 'yellow', 'Sin evidencia de salud ocupacional consolidada en este índice', [], 1),
    categoryStatus('maintenance', 'yellow', 'Sin evidencia de mantenimiento consolidada en este índice', [], 1),
    audits.length === 0
      ? categoryStatus('audits', 'yellow', 'Sin auditorías disponibles', [], 1)
      : incompleteAudits.length > 0
        ? categoryStatus('audits', 'yellow', `${incompleteAudits.length} auditoría(s) no completada(s)`, [], incompleteAudits.length)
        : categoryStatus(
          'audits',
          'yellow',
          'Auditorías incluidas completadas; cobertura total no demostrada',
          [],
          1,
        ),
  ];

  const lights = byCategory.map((item) => item.light);
  const overall: TrafficLight = lights.includes('red')
    ? 'red'
    : lights.includes('yellow')
      ? 'yellow'
      : 'green';
  const green = lights.filter((light) => light === 'green').length;
  const yellow = lights.filter((light) => light === 'yellow').length;

  return {
    overall,
    byCategory,
    score: Math.round(((green + yellow * 0.5) / byCategory.length) * 100),
    computedAt,
  };
}

export function buildExpressBundleData(
  nodes: RiskNode[],
  projectId: string,
  now = new Date(),
): ExpressBundleData {
  const scoped = nodes.filter((node) => node.projectId === projectId);

  const documents = scoped.flatMap((node) => {
    if (node.type !== NodeType.DOCUMENT) return [];
    const meta = metadata(node);
    const status = documentStatus(meta.status);
    if (!status) return [];
    const storageUrl = text(meta.storageUrl) ?? text(meta.url);
    return [{
      id: node.id,
      type: text(meta.type) ?? 'Documento',
      title: node.title,
      status,
      ...(storageUrl ? { storageUrl } : {}),
    }];
  });

  const iperMatrix = scoped.flatMap((node) => {
    if (node.type !== NodeType.RISK) return [];
    const meta = metadata(node);
    const normalizedSeverity = severity(meta.severity ?? meta.criticidad);
    if (!normalizedSeverity) return [];
    const mitigation = text(meta.mitigation) ?? text(meta.mitigacion);
    return [{
      id: node.id,
      risk: node.title,
      severity: normalizedSeverity,
      ...(mitigation ? { mitigation } : {}),
    }];
  });

  const trainings = scoped.flatMap((node) => {
    if (node.type !== NodeType.TRAINING) return [];
    const meta = metadata(node);
    const workerName = text(meta.workerName);
    const workerRut = text(meta.workerRut);
    const status = trainingStatus(meta.status);
    if (!workerName || !workerRut || !status) return [];
    const validUntil = text(meta.validUntil);
    return [{
      id: node.id,
      course: node.title,
      workerName,
      workerRut,
      ...(validUntil ? { validUntil } : {}),
      status,
    }];
  });

  const eppAssignments = scoped.flatMap((node) => {
    if (node.type !== NodeType.EPP) return [];
    const meta = metadata(node);
    const workerName = text(meta.workerName);
    const workerRut = text(meta.workerRut);
    const label = text(meta.label) ?? text(meta.eppItemName) ?? node.title;
    const receivedAt = text(meta.receivedAt) ?? text(meta.assignedAt);
    if (!workerName || !workerRut || !receivedAt) return [];
    const expiresAt = text(meta.expiresAt);
    return [{
      workerName,
      workerRut,
      items: [{ label, receivedAt, ...(expiresAt ? { expiresAt } : {}) }],
    }];
  });

  const activeWorkers = scoped.flatMap((node) => {
    if (node.type !== NodeType.WORKER) return [];
    const meta = metadata(node);
    const status = text(meta.status)?.toLocaleLowerCase('es-CL');
    if (!['active', 'activo', 'activa'].includes(status ?? '')) return [];
    const rut = text(meta.rut);
    const role = text(meta.role);
    if (!rut || !role) return [];
    const startDate = text(meta.startDate) ?? text(meta.joinedAt);
    return [{
      uid: node.id,
      fullName: node.title,
      rut,
      role,
      ...(startDate ? { startDate } : {}),
    }];
  });

  const applicableProtocols: ExpressBundleData['applicableProtocols'] = scoped.flatMap((node) => {
    if (node.type !== NodeType.NORMATIVE) return [];
    const meta = metadata(node);
    const category = text(meta.category);
    const recommendation = text(meta.recommendation);
    const legalCitation = text(meta.legalCitation);
    const urgencyToken = text(meta.urgency);
    const urgency = urgencyToken === 'critical' || urgencyToken === 'recommended'
      ? urgencyToken
      : null;
    if (
      !category || !LEGAL_CATEGORIES.has(category) || !recommendation || !legalCitation ||
      !urgency
    ) return [];
    const suggestedDeadline = text(meta.suggestedDeadline);
    return [{
      ruleId: node.id,
      category: category as 'committee' | 'training' | 'process' | 'document' | 'medical' | 'epp',
      recommendation,
      legalCitation,
      urgency,
      ...(suggestedDeadline ? { suggestedDeadline } : {}),
    }];
  });

  const photoEvidences = scoped.flatMap((node) => {
    const meta = metadata(node);
    if (text(meta.evidenceType) !== 'photo') return [];
    const storageUrl = text(meta.storageUrl) ?? text(meta.url);
    const takenAt = text(meta.takenAt);
    if (!storageUrl || !takenAt) return [];
    return [{ id: node.id, caption: text(meta.caption) ?? node.title, storageUrl, takenAt }];
  });

  const recentAuditLogs = scoped.flatMap((node) => {
    if (node.type !== NodeType.AUDIT) return [];
    const meta = metadata(node);
    const action = text(meta.action);
    const timestamp = text(meta.timestamp);
    if (!action || !timestamp) return [];
    const userId = text(meta.userId) ?? null;
    if (
      meta.details !== undefined &&
      (meta.details === null || typeof meta.details !== 'object' || Array.isArray(meta.details))
    ) return [];
    const details = meta.details as Record<string, unknown> | undefined;
    return [{ action, timestamp, userId, ...(details ? { details } : {}) }];
  });

  const withoutCompliance = {
    documents,
    iperMatrix,
    trainings,
    eppAssignments,
    activeWorkers,
    applicableProtocols,
    photoEvidences,
    recentAuditLogs,
  };

  return {
    ...withoutCompliance,
    complianceSnapshot: buildComplianceSnapshot(scoped, withoutCompliance, now.toISOString()),
  };
}

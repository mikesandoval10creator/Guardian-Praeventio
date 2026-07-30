import { describe, expect, it } from 'vitest';
import { NodeType, type RiskNode } from '../../types';
import { buildExpressBundleData } from './expressBundlePayload';

function node(overrides: Partial<RiskNode> & Pick<RiskNode, 'id' | 'type' | 'title'>): RiskNode {
  return {
    description: '',
    tags: [],
    metadata: {},
    connections: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildExpressBundleData', () => {
  it('maps schema-valid EPP, legal, photo and audit evidence', () => {
    const data = buildExpressBundleData([
      node({
        id: 'epp-1', type: NodeType.EPP, title: 'Casco', projectId: 'p1',
        metadata: {
          workerName: 'Ana', workerRut: '11.111.111-1', label: 'Casco MSA',
          receivedAt: '2026-01-02', expiresAt: '2028-01-02',
        },
      }),
      node({
        id: 'law-1', type: NodeType.NORMATIVE, title: 'DS 44', projectId: 'p1',
        metadata: {
          category: 'document', recommendation: 'Mantener registro vigente',
          legalCitation: 'DS 44 art. 12', urgency: 'critical',
        },
      }),
      node({
        id: 'photo-1', type: NodeType.DOCUMENT, title: 'Baranda instalada', projectId: 'p1',
        metadata: {
          evidenceType: 'photo', storageUrl: 'https://storage/photo.jpg',
          takenAt: '2026-07-30T12:00:00.000Z', caption: 'Control implementado',
        },
      }),
      node({
        id: 'audit-1', type: NodeType.AUDIT, title: 'Auditoría julio', projectId: 'p1',
        metadata: {
          status: 'completed', action: 'audit.completed',
          timestamp: '2026-07-30T13:00:00.000Z', userId: 'u1', details: { score: 95 },
        },
      }),
    ], 'p1', new Date('2026-07-30T14:00:00.000Z'));

    expect(data.eppAssignments).toEqual([
      {
        workerName: 'Ana', workerRut: '11.111.111-1',
        items: [{ label: 'Casco MSA', receivedAt: '2026-01-02', expiresAt: '2028-01-02' }],
      },
    ]);
    expect(data.applicableProtocols).toEqual([
      {
        ruleId: 'law-1', category: 'document', recommendation: 'Mantener registro vigente',
        legalCitation: 'DS 44 art. 12', urgency: 'critical',
      },
    ]);
    expect(data.photoEvidences).toEqual([
      {
        id: 'photo-1', caption: 'Control implementado',
        storageUrl: 'https://storage/photo.jpg', takenAt: '2026-07-30T12:00:00.000Z',
      },
    ]);
    expect(data.recentAuditLogs).toEqual([
      {
        action: 'audit.completed', timestamp: '2026-07-30T13:00:00.000Z',
        userId: 'u1', details: { score: 95 },
      },
    ]);
    expect(data.complianceSnapshot.byCategory.every((item) => item.light !== 'green')).toBe(true);
  });

  it('drops foreign, unknown and incomplete records instead of coercing them', () => {
    const data = buildExpressBundleData([
      node({
        id: 'foreign', type: NodeType.DOCUMENT, title: 'Otro tenant', projectId: 'p2',
        metadata: { status: 'vigente', type: 'RIOHS' },
      }),
      node({
        id: 'unknown-doc', type: NodeType.DOCUMENT, title: 'Estado desconocido', projectId: 'p1',
        metadata: { status: 'quizás', type: 'RIOHS' },
      }),
      node({
        id: 'bad-training', type: NodeType.TRAINING, title: 'Altura', projectId: 'p1',
        metadata: { workerName: 'Ana', status: 'vigente' },
      }),
      node({
        id: 'inactive', type: NodeType.WORKER, title: 'Ex trabajador', projectId: 'p1',
        metadata: { rut: '1-9', role: 'Operario', status: 'inactive' },
      }),
      node({
        id: 'statusless-worker', type: NodeType.WORKER, title: 'Estado desconocido', projectId: 'p1',
        metadata: { rut: '2-7', role: 'Operario' },
      }),
      node({
        id: 'array-details', type: NodeType.AUDIT, title: 'Log malformado', projectId: 'p1',
        metadata: {
          action: 'audit.completed', timestamp: '2026-07-30T13:00:00.000Z', details: ['bad'],
        },
      }),
      node({
        id: 'bad-law', type: NodeType.NORMATIVE, title: 'Regla', projectId: 'p1',
        metadata: {
          category: 'document', recommendation: 'Hacer algo',
          legalCitation: 'Ley X', urgency: 'eventual',
        },
      }),
      node({
        id: 'bad-epp', type: NodeType.EPP, title: 'Casco', projectId: 'p1',
        metadata: { workerName: 'Ana', workerRut: '1-9' },
      }),
    ], 'p1');

    expect(data.documents).toEqual([]);
    expect(data.trainings).toEqual([]);
    expect(data.activeWorkers).toEqual([]);
    expect(data.applicableProtocols).toEqual([]);
    expect(data.eppAssignments).toEqual([]);
    expect(data.recentAuditLogs).toEqual([]);
    expect(data.complianceSnapshot.overall).toBe('yellow');
    expect(data.complianceSnapshot.byCategory.every((item) => item.light !== 'green')).toBe(true);
  });

  it('marks expired documents and trainings red with traceable item ids', () => {
    const data = buildExpressBundleData([
      node({
        id: 'doc-expired', type: NodeType.DOCUMENT, title: 'RIOHS', projectId: 'p1',
        metadata: { type: 'RIOHS', status: 'vencido' },
      }),
      node({
        id: 'training-expired', type: NodeType.TRAINING, title: 'Altura', projectId: 'p1',
        metadata: {
          workerName: 'Ana', workerRut: '11.111.111-1', status: 'vencido',
        },
      }),
    ], 'p1');

    expect(data.complianceSnapshot.overall).toBe('red');
    expect(data.complianceSnapshot.byCategory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'documentation', light: 'red', criticalItemIds: ['doc-expired'],
      }),
      expect.objectContaining({
        category: 'training', light: 'red', criticalItemIds: ['training-expired'],
      }),
    ]));
  });
});

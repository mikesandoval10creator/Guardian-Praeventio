import { describe, it, expect } from 'vitest';
import { buildExpressBundleManifest } from './expressBundleBuilder.js';
import type { ComplianceTrafficLightResult } from '../compliance/trafficLightEngine.js';

const FIXED_NOW = new Date('2026-05-11T14:00:00Z');

function emptyComplianceSnapshot(): ComplianceTrafficLightResult {
  return {
    overall: 'green',
    byCategory: [
      { category: 'legal', light: 'green', summary: 'ok', criticalItemIds: [], warningCount: 0 },
      { category: 'documentation', light: 'green', summary: 'ok', criticalItemIds: [], warningCount: 0 },
      { category: 'training', light: 'green', summary: 'ok', criticalItemIds: [], warningCount: 0 },
      { category: 'epp', light: 'green', summary: 'ok', criticalItemIds: [], warningCount: 0 },
      { category: 'emergencies', light: 'green', summary: 'ok', criticalItemIds: [], warningCount: 0 },
      { category: 'occupational_health', light: 'green', summary: 'ok', criticalItemIds: [], warningCount: 0 },
      { category: 'maintenance', light: 'green', summary: 'ok', criticalItemIds: [], warningCount: 0 },
      { category: 'audits', light: 'green', summary: 'ok', criticalItemIds: [], warningCount: 0 },
    ],
    score: 100,
    computedAt: FIXED_NOW.toISOString(),
  };
}

describe('buildExpressBundleManifest', () => {
  it('genera manifest con PDF index válido', async () => {
    const manifest = await buildExpressBundleManifest({
      projectId: 'p1',
      projectName: 'Faena Norte',
      generatedBy: { uid: 'u1', fullName: 'Ana', role: 'Prevencionista' },
      generatedAt: FIXED_NOW,
      data: {
        documents: [],
        iperMatrix: [],
        trainings: [],
        eppAssignments: [],
        activeWorkers: [],
        applicableProtocols: [],
        photoEvidences: [],
        recentAuditLogs: [],
        complianceSnapshot: emptyComplianceSnapshot(),
      },
    });

    expect(manifest.indexPdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(manifest.indexPdf.length).toBeGreaterThan(1000);
    expect(manifest.generatedAt).toBe(FIXED_NOW.toISOString());
  });

  it('counts summary correcto con datos reales', async () => {
    const manifest = await buildExpressBundleManifest({
      projectId: 'p1',
      projectName: 'Mina Sur',
      generatedBy: { uid: 'u1', fullName: 'Ana', role: 'Prevencionista' },
      generatedAt: FIXED_NOW,
      data: {
        documents: [
          { id: 'd1', type: 'RIOHS', title: 'Reglamento Interno', status: 'vigente' },
          { id: 'd2', type: 'ODI', title: 'Obligación de Informar', status: 'vigente' },
        ],
        iperMatrix: [
          { id: 'i1', risk: 'altura', severity: 'high' },
          { id: 'i2', risk: 'químico', severity: 'medium' },
          { id: 'i3', risk: 'ruido', severity: 'low' },
        ],
        trainings: [
          { id: 't1', course: 'altura R1', workerName: 'Juan', workerRut: '1-1', status: 'vigente' },
          { id: 't2', course: 'confinados', workerName: 'María', workerRut: '2-2', status: 'vencido' },
        ],
        eppAssignments: [
          { workerName: 'Juan', workerRut: '1-1', items: [{ label: 'Casco', receivedAt: '2026-01-01' }] },
        ],
        activeWorkers: [
          { uid: 'w1', fullName: 'Juan', rut: '1-1', role: 'operador' },
          { uid: 'w2', fullName: 'María', rut: '2-2', role: 'supervisora' },
        ],
        applicableProtocols: [],
        photoEvidences: [
          { id: 'photo-1', caption: 'EPP entrega', storageUrl: 'gs://x', takenAt: '2026-04-01' },
        ],
        recentAuditLogs: [
          { action: 'ppe.expired', timestamp: '2026-05-01', userId: null },
        ],
        complianceSnapshot: emptyComplianceSnapshot(),
      },
    });

    expect(manifest.summary.documentsCount).toBe(2);
    expect(manifest.summary.iperItems).toBe(3);
    expect(manifest.summary.trainings.vigentes).toBe(1);
    expect(manifest.summary.trainings.vencidos).toBe(1);
    expect(manifest.summary.eppAssignments).toBe(1);
    expect(manifest.summary.activeWorkers).toBe(2);
    expect(manifest.summary.photoEvidences).toBe(1);
    expect(manifest.summary.recentAuditLogs).toBe(1);
    // fileCount = documents + photoEvidences + 1 (index)
    expect(manifest.summary.fileCount).toBe(2 + 1 + 1);
  });

  it('incluye complianceSnapshot en el manifest', async () => {
    const snap: ComplianceTrafficLightResult = {
      ...emptyComplianceSnapshot(),
      overall: 'red',
      score: 60,
    };
    const manifest = await buildExpressBundleManifest({
      projectId: 'p1',
      projectName: 'Test',
      generatedBy: { uid: 'u1', fullName: 'X', role: 'r' },
      generatedAt: FIXED_NOW,
      data: {
        documents: [], iperMatrix: [], trainings: [], eppAssignments: [],
        activeWorkers: [], applicableProtocols: [], photoEvidences: [],
        recentAuditLogs: [], complianceSnapshot: snap,
      },
    });
    expect(manifest.complianceSnapshot.overall).toBe('red');
    expect(manifest.complianceSnapshot.score).toBe(60);
  });

  it('PDF index termina con %%EOF (PDF spec 7.5.5)', async () => {
    const manifest = await buildExpressBundleManifest({
      projectId: 'p1',
      projectName: 'Test',
      generatedBy: { uid: 'u1', fullName: 'X', role: 'r' },
      generatedAt: FIXED_NOW,
      data: {
        documents: [], iperMatrix: [], trainings: [], eppAssignments: [],
        activeWorkers: [], applicableProtocols: [], photoEvidences: [],
        recentAuditLogs: [], complianceSnapshot: emptyComplianceSnapshot(),
      },
    });
    const tail = manifest.indexPdf
      .subarray(Math.max(0, manifest.indexPdf.length - 50))
      .toString('binary');
    expect(tail).toMatch(/%%EOF/);
  });
});

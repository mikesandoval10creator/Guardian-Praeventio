import { describe, it, expect } from 'vitest';
import {
  buildDataConfidenceReport,
  type ConfidenceInputs,
} from './dataConfidencePanel.js';

const NOW = new Date('2026-05-12T22:00:00Z');

function perfectInputs(): ConfidenceInputs {
  return {
    coverage: {
      workersExpected: 50,
      workersPresent: 50,
      eppItemsExpected: 100,
      eppItemsPresent: 100,
      documentsRequired: 12,
      documentsPresent: 12,
    },
    freshness: {
      workersLastUpdateDays: 0,
      eppInventoryLastUpdateDays: 0,
      incidentsLastWriteDays: 0,
      documentsLastReviewDays: 0,
    },
    completeness: {
      workersWithFullProfileRatio: 1,
      eppWithExpirationRatio: 1,
      incidentsWithRootCauseRatio: 1,
      documentsWithApproverRatio: 1,
    },
    traceability: {
      workersWithAuditLogRatio: 1,
      eppWithAuditLogRatio: 1,
      incidentsWithAuditLogRatio: 1,
      documentsWithAuditLogRatio: 1,
    },
    concordance: { inconsistenciesCount: 0, totalEntitiesScanned: 100 },
  };
}

describe('buildDataConfidenceReport', () => {
  it('inputs perfectos → score 100 + level high + sin red flags', () => {
    const r = buildDataConfidenceReport(perfectInputs(), { now: NOW });
    expect(r.overallScore).toBe(100);
    expect(r.overallLevel).toBe('high');
    expect(r.redFlags).toHaveLength(0);
    expect(r.recommendations).toHaveLength(0);
    expect(r.dimensions).toHaveLength(5);
  });

  it('cobertura baja (workers 50%) → coverage score baja', () => {
    const inputs = perfectInputs();
    inputs.coverage.workersPresent = 25; // 50% of 50
    const r = buildDataConfidenceReport(inputs, { now: NOW });
    const cov = r.dimensions.find((d) => d.name === 'coverage')!;
    expect(cov.score).toBeLessThan(85);
  });

  it('frescura 60+ días en algún feed → score baja sustancialmente', () => {
    const inputs = perfectInputs();
    inputs.freshness.workersLastUpdateDays = 90;
    const r = buildDataConfidenceReport(inputs, { now: NOW });
    const fre = r.dimensions.find((d) => d.name === 'freshness')!;
    expect(fre.score).toBeLessThan(85);
  });

  it('completitud RCA 0% + EPP 0% → completeness score baja + recomendación RCA', () => {
    const inputs = perfectInputs();
    inputs.completeness.incidentsWithRootCauseRatio = 0;
    inputs.completeness.eppWithExpirationRatio = 0;
    const r = buildDataConfidenceReport(inputs, { now: NOW });
    const com = r.dimensions.find((d) => d.name === 'completeness')!;
    expect(com.score).toBeLessThan(70);
    expect(r.recommendations.some((x) => /causa raíz/i.test(x))).toBe(true);
  });

  it('audit_log faltante → traceability red flag', () => {
    const inputs = perfectInputs();
    inputs.traceability.incidentsWithAuditLogRatio = 0.1;
    inputs.traceability.workersWithAuditLogRatio = 0.2;
    inputs.traceability.eppWithAuditLogRatio = 0.2;
    inputs.traceability.documentsWithAuditLogRatio = 0.2;
    const r = buildDataConfidenceReport(inputs, { now: NOW });
    const tra = r.dimensions.find((d) => d.name === 'traceability')!;
    expect(tra.score).toBeLessThan(50);
    expect(r.redFlags.some((f) => /traceability/i.test(f))).toBe(true);
  });

  it('inconsistencias 5/100 → concordance ~50', () => {
    const inputs = perfectInputs();
    inputs.concordance.inconsistenciesCount = 5;
    const r = buildDataConfidenceReport(inputs, { now: NOW });
    const con = r.dimensions.find((d) => d.name === 'concordance')!;
    expect(con.score).toBeGreaterThanOrEqual(40);
    expect(con.score).toBeLessThanOrEqual(60);
  });

  it('todo malo → overall level critical', () => {
    const inputs: ConfidenceInputs = {
      coverage: {
        workersExpected: 50,
        workersPresent: 5,
        eppItemsExpected: 100,
        eppItemsPresent: 10,
        documentsRequired: 12,
        documentsPresent: 1,
      },
      freshness: {
        workersLastUpdateDays: 120,
        eppInventoryLastUpdateDays: 120,
        incidentsLastWriteDays: 120,
        documentsLastReviewDays: 120,
      },
      completeness: {
        workersWithFullProfileRatio: 0.1,
        eppWithExpirationRatio: 0.1,
        incidentsWithRootCauseRatio: 0.1,
        documentsWithApproverRatio: 0.1,
      },
      traceability: {
        workersWithAuditLogRatio: 0,
        eppWithAuditLogRatio: 0,
        incidentsWithAuditLogRatio: 0,
        documentsWithAuditLogRatio: 0,
      },
      concordance: { inconsistenciesCount: 80, totalEntitiesScanned: 100 },
    };
    const r = buildDataConfidenceReport(inputs, { now: NOW });
    expect(r.overallLevel).toBe('critical');
    expect(r.overallScore).toBeLessThan(40);
    expect(r.redFlags.length).toBeGreaterThanOrEqual(4);
    expect(r.recommendations.length).toBeLessThanOrEqual(5);
  });

  it('pesos suman 1', () => {
    const r = buildDataConfidenceReport(perfectInputs(), { now: NOW });
    const sum = r.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it('totalEntitiesScanned 0 → concordance asume 100', () => {
    const inputs = perfectInputs();
    inputs.concordance = { inconsistenciesCount: 0, totalEntitiesScanned: 0 };
    const r = buildDataConfidenceReport(inputs, { now: NOW });
    const con = r.dimensions.find((d) => d.name === 'concordance')!;
    expect(con.score).toBe(100);
  });

  it('cobertura sin entidades esperadas → asumir 100 (no NaN)', () => {
    const inputs = perfectInputs();
    inputs.coverage.workersExpected = 0;
    inputs.coverage.workersPresent = 0;
    const r = buildDataConfidenceReport(inputs, { now: NOW });
    const cov = r.dimensions.find((d) => d.name === 'coverage')!;
    expect(Number.isFinite(cov.score)).toBe(true);
    expect(cov.score).toBeGreaterThan(0);
  });
});

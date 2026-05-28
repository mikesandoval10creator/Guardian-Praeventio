// Tests §12.5.1 split step 12 — gemini/operations.ts.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../ragService', () => ({
  searchRelevantContext: vi.fn(async () => 'mock-ctx'),
}));

import {
  generateISOAuditChecklist,
  processDocumentToNodes,
  auditAISuggestion,
  analyzeDocumentCompliance,
  investigateIncidentWithAI,
  auditProjectComplianceWithAI,
  analyzeAttendancePatterns,
} from './operations';

describe('operations — sin API_KEY', () => {
  it('generateISOAuditChecklist throws', async () => {
    await expect(generateISOAuditChecklist('topic', 'ctx')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('processDocumentToNodes throws', async () => {
    await expect(processDocumentToNodes('doc text')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('auditAISuggestion throws', async () => {
    await expect(auditAISuggestion('s', 'c')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('analyzeDocumentCompliance throws', async () => {
    await expect(analyzeDocumentCompliance('doc', 'norm')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('investigateIncidentWithAI throws', async () => {
    await expect(
      investigateIncidentWithAI('title', 'desc', 'ctx'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('auditProjectComplianceWithAI throws', async () => {
    await expect(
      auditProjectComplianceWithAI('proyecto', 'pCtx', 'normCtx'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('analyzeAttendancePatterns throws', async () => {
    await expect(
      analyzeAttendancePatterns('proyecto', 'data'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });
});

describe('operations — contract', () => {
  it('7 funciones son async', () => {
    for (const fn of [
      generateISOAuditChecklist,
      processDocumentToNodes,
      auditAISuggestion,
      analyzeDocumentCompliance,
      investigateIncidentWithAI,
      auditProjectComplianceWithAI,
      analyzeAttendancePatterns,
    ]) {
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});

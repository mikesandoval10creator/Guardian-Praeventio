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

  it('analyzeDocumentCompliance throws sin API_KEY cuando hay texto analizable', async () => {
    await expect(
      analyzeDocumentCompliance('texto real del documento '.repeat(4), 'norm'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('analyzeDocumentCompliance NO declara cumplimiento sin texto analizable', async () => {
    // Sin API_KEY y con texto insuficiente: el guard de análisis gana y
    // devuelve el resultado explícito en vez de lanzar (tarea P1).
    const result = await analyzeDocumentCompliance('', 'norm');
    expect(result.isCompliant).toBe(false);
    expect(result.complianceScore).toBe(0);
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

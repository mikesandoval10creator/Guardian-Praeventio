import { describe, it, expect } from 'vitest';
import {
  validateReportData,
  renderReport,
  checkReportDue,
  CANONICAL_TEMPLATES,
} from './reportsAutomation.js';

describe('validateReportData', () => {
  it('detecta secciones obligatorias faltantes', () => {
    const template = CANONICAL_TEMPLATES[0];
    const r = validateReportData(template, { contents: { kpis: 'x' } });
    expect(r.isValid).toBe(false);
    expect(r.missingSections.length).toBeGreaterThan(0);
  });

  it('válido si todas las required tienen contenido', () => {
    const template = CANONICAL_TEMPLATES[0];
    const contents: Record<string, string> = {};
    for (const s of template.sections) {
      if (s.required) contents[s.key] = 'x';
    }
    expect(validateReportData(template, { contents }).isValid).toBe(true);
  });
});

describe('renderReport', () => {
  it('produce PublishedReport con todas las secciones', () => {
    const template = CANONICAL_TEMPLATES[0];
    const contents: Record<string, string> = {};
    for (const s of template.sections) {
      if (s.required) contents[s.key] = `content ${s.key}`;
    }
    const r = renderReport({
      template,
      data: { contents },
      periodLabel: '2026-05',
      reportId: 'r1',
      publishedAt: '2026-05-31T23:59:00Z',
      distributedTo: ['client@x.com'],
    });
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.renderedSections.length).toBe(template.sections.length);
      expect(r.audience).toBe('client');
    }
  });

  it('devuelve error si missing required', () => {
    const r = renderReport({
      template: CANONICAL_TEMPLATES[0],
      data: { contents: {} },
      periodLabel: '2026-05',
      reportId: 'r1',
      publishedAt: '2026-05-31',
      distributedTo: [],
    });
    expect('error' in r).toBe(true);
  });
});

describe('checkReportDue', () => {
  it('sin lastPublishedAt → isDue=true', () => {
    const r = checkReportDue({ templateId: 't1', period: 'monthly' });
    expect(r.isDue).toBe(true);
  });

  it('lastPublishedAt reciente → no isDue', () => {
    const r = checkReportDue(
      { templateId: 't1', period: 'monthly', lastPublishedAt: '2026-04-25T00:00:00Z' },
      '2026-05-11T00:00:00Z',
    );
    expect(r.isDue).toBe(false);
  });

  it('lastPublishedAt >30d → isDue', () => {
    const r = checkReportDue(
      { templateId: 't1', period: 'monthly', lastPublishedAt: '2026-04-01T00:00:00Z' },
      '2026-05-11T00:00:00Z',
    );
    expect(r.isDue).toBe(true);
  });

  it('anual: solo isDue si >=365d', () => {
    const r = checkReportDue(
      { templateId: 't1', period: 'annual', lastPublishedAt: '2025-06-01T00:00:00Z' },
      '2026-05-11T00:00:00Z',
    );
    expect(r.isDue).toBe(false);
  });
});

describe('CANONICAL_TEMPLATES', () => {
  it('incluye monthly-client, quarterly-internal y annual-regulatory', () => {
    const ids = CANONICAL_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('monthly-client');
    expect(ids).toContain('quarterly-internal');
    expect(ids).toContain('annual-regulatory');
  });
});

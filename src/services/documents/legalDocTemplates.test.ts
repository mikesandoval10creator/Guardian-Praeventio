import { describe, it, expect } from 'vitest';
import {
  TEMPLATES,
  validateInput,
  renderLegalDoc,
  listTemplates,
  type LegalDocTemplateKind,
} from './legalDocTemplates.js';

describe('TEMPLATES catalog', () => {
  it('contiene los 5 tipos canónicos', () => {
    const keys = Object.keys(TEMPLATES);
    expect(keys.sort()).toEqual(['CPHS_ACTA', 'DDR', 'ODI', 'PTS', 'RIOHS']);
  });

  it('cada plantilla declara legalReferences', () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(t.legalReferences.length).toBeGreaterThan(0);
    }
  });
});

describe('validateInput', () => {
  it('reporta todos los tokens faltantes', () => {
    const v = validateInput({ kind: 'RIOHS', data: {} });
    expect(v.ok).toBe(false);
    expect(v.missingTokens).toContain('companyName');
    expect(v.missingTokens).toContain('projectName');
  });

  it('tokens whitespace-only cuentan como faltantes', () => {
    const v = validateInput({
      kind: 'DDR',
      data: { workerName: '   ', workerRut: 'x', position: 'y', companyName: 'z', date: 'd' },
    });
    expect(v.ok).toBe(false);
    expect(v.missingTokens).toContain('workerName');
  });

  it('ok cuando todos los tokens están provistos', () => {
    const v = validateInput({
      kind: 'DDR',
      data: {
        workerName: 'Ana',
        workerRut: '12345678-9',
        position: 'Soldadora',
        companyName: 'Praeventio',
        date: '2026-05-12',
      },
    });
    expect(v.ok).toBe(true);
    expect(v.missingTokens).toEqual([]);
  });

  it('tipo desconocido reporta __unknown_template_kind', () => {
    const v = validateInput({ kind: 'INVALID' as LegalDocTemplateKind, data: {} });
    expect(v.ok).toBe(false);
    expect(v.missingTokens[0]).toBe('__unknown_template_kind');
  });
});

describe('renderLegalDoc', () => {
  it('falla con tokens faltantes', () => {
    const r = renderLegalDoc({ kind: 'RIOHS', data: {} });
    expect(r.ok).toBe(false);
    expect(r.missingTokens?.length).toBeGreaterThan(0);
  });

  it('sustituye todos los tokens', () => {
    const r = renderLegalDoc({
      kind: 'DDR',
      data: {
        workerName: 'Ana Soto',
        workerRut: '11222333-4',
        position: 'Soldadora',
        companyName: 'Constructora Andes',
        date: '2026-05-12',
        supervisor: 'José Pérez',
      },
    });
    expect(r.ok).toBe(true);
    expect(r.markdown).toMatch(/Ana Soto/);
    expect(r.markdown).toMatch(/Constructora Andes/);
    expect(r.markdown).toMatch(/2026-05-12/);
    expect(r.markdown).not.toMatch(/\{\{/);
  });

  it('opcionales sin valor → reemplazados por —', () => {
    const r = renderLegalDoc({
      kind: 'ODI',
      data: {
        workerName: 'B',
        workerRut: 'r',
        position: 'p',
        companyName: 'c',
        date: 'd',
        specificRisks: 'Trabajo en altura > 1.8m',
      },
    });
    expect(r.ok).toBe(true);
    // supervisor + industry son opcionales y aquí no se pasaron
    expect(r.markdown).not.toMatch(/\{\{/);
  });

  it('emite referencias normativas', () => {
    const r = renderLegalDoc({
      kind: 'RIOHS',
      data: {
        companyName: 'X',
        companyRut: '76.111.222-3',
        projectName: 'Obra Y',
        date: '2026-05-12',
        workerCount: '120',
      },
    });
    expect(r.references).toContain('DS 40/1969');
    expect(r.references).toContain('Ley 16.744 art. 67');
  });
});

describe('listTemplates', () => {
  it('devuelve metadata de los 5 templates', () => {
    const list = listTemplates();
    expect(list).toHaveLength(5);
    const kinds = list.map((m) => m.kind).sort();
    expect(kinds).toEqual(['CPHS_ACTA', 'DDR', 'ODI', 'PTS', 'RIOHS']);
  });

  it('cada template reporta su required token count', () => {
    const list = listTemplates();
    for (const m of list) {
      expect(m.requiredTokenCount).toBeGreaterThan(0);
    }
  });
});

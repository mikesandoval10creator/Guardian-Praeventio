// Praeventio Guard — legal-document PDF generator tests.
//
// Mocking strategy mirrors `ds67Notification.test.ts`: replace `jspdf` with a
// lightweight fake that records text + save calls + page count so we can assert
// the rendered content, pagination and filename without invoking the real
// rendering pipeline.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const textCalls: string[] = [];
const saveCalls: string[] = [];
let pageCount = 1;
let currentFontSize = 10;

vi.mock('jspdf', () => {
  class FakeJsPDF {
    internal = {
      pageSize: { width: 210, height: 297 },
      getNumberOfPages: () => pageCount,
    };
    text(content: string | string[]) {
      const s = Array.isArray(content) ? content.join(' ') : content;
      textCalls.push(s);
      return this;
    }
    addPage() {
      pageCount += 1;
      return this;
    }
    getFontSize() {
      return currentFontSize;
    }
    setFontSize(n: number) {
      currentFontSize = n;
      return this;
    }
    setFillColor() {
      return this;
    }
    setDrawColor() {
      return this;
    }
    setTextColor() {
      return this;
    }
    setFont() {
      return this;
    }
    setLineWidth() {
      return this;
    }
    rect() {
      return this;
    }
    roundedRect() {
      return this;
    }
    line() {
      return this;
    }
    // Naive wrap: split very long lines so pagination is exercised.
    splitTextToSize(input: string) {
      if (input.length <= 90) return [input];
      const out: string[] = [];
      for (let i = 0; i < input.length; i += 90) out.push(input.slice(i, i + 90));
      return out;
    }
    save(name: string) {
      saveCalls.push(name);
      return this;
    }
  }
  return { jsPDF: FakeJsPDF, default: FakeJsPDF };
});

import {
  generateLegalDocPdf,
  downloadLegalDocPdf,
  type LegalDocPdfInput,
} from './legalDocPdf';

const baseInput: LegalDocPdfInput = {
  title: 'Reglamento Interno de Orden, Higiene y Seguridad',
  markdown: `# Reglamento Interno de Orden, Higiene y Seguridad
**Empresa**: Constructora Andes SpA (76.111.222-3)
**Faena**: Obra Andina

## I. Disposiciones generales
El presente Reglamento se dicta en cumplimiento del DS 44/2024 y la Ley 16.744.

## II. Obligaciones
1. Cumplir las normas de higiene y seguridad.
2. Usar EPP entregado.
`,
  references: ['DS 44/2024', 'Ley 16.744 art. 67'],
};

beforeEach(() => {
  textCalls.length = 0;
  saveCalls.length = 0;
  pageCount = 1;
  currentFontSize = 10;
});

describe('generateLegalDocPdf', () => {
  it('returns a jsPDF instance', () => {
    const pdf = generateLegalDocPdf(baseInput);
    expect(pdf).toBeDefined();
    expect(typeof pdf.save).toBe('function');
  });

  it('renders the document title and the user-typed body content', () => {
    generateLegalDocPdf(baseInput);
    const all = textCalls.join(' | ');
    expect(all).toContain('Reglamento Interno de Orden, Higiene y Seguridad');
    expect(all).toContain('Constructora Andes SpA (76.111.222-3)');
    expect(all).toContain('Obra Andina');
    expect(all).toContain('Usar EPP entregado.');
  });

  it('strips markdown bold markers from the rendered text', () => {
    generateLegalDocPdf(baseInput);
    const all = textCalls.join(' | ');
    expect(all).not.toContain('**Empresa**');
    expect(all).toContain('Empresa: Constructora Andes SpA');
  });

  it('embeds the cited legal references in the header band', () => {
    generateLegalDocPdf(baseInput);
    const all = textCalls.join(' | ');
    expect(all).toMatch(/DS 44\/2024/);
    expect(all).toMatch(/Ley 16\.?744/);
  });

  it('paginates a long body across multiple pages', () => {
    const longBody = Array.from({ length: 80 }, (_, i) => `Línea de contenido número ${i + 1}.`).join('\n');
    generateLegalDocPdf({ ...baseInput, markdown: `# Doc largo\n${longBody}` });
    expect(pageCount).toBeGreaterThan(1);
  });

  it('does not crash on empty markdown', () => {
    expect(() => generateLegalDocPdf({ ...baseInput, markdown: '' })).not.toThrow();
  });
});

describe('downloadLegalDocPdf', () => {
  it('saves the PDF with a deterministic filename derived from kind + title + date', () => {
    downloadLegalDocPdf(baseInput, 'RIOHS');
    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]).toMatch(/^RIOHS_Reglamento_Interno.+_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('uses the explicit filename override when provided', () => {
    downloadLegalDocPdf(baseInput, 'RIOHS', 'custom_riohs.pdf');
    expect(saveCalls).toEqual(['custom_riohs.pdf']);
  });
});

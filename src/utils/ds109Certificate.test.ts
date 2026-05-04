// Praeventio Guard — DS 109 PDF generator tests.
//
// Strategy: mock `jsPDF` so we can assert on the SEQUENCE of calls without
// actually rendering. The autotable plugin is also mocked because it
// monkey-patches the prototype at import time and doesn't need to run for
// these unit tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const textCalls: string[] = [];
const saveCalls: string[] = [];
let pageCount = 1;

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
    addPage() { pageCount += 1; return this; }
    setFillColor() { return this; }
    setDrawColor() { return this; }
    setTextColor() { return this; }
    setFontSize() { return this; }
    setFont() { return this; }
    setLineWidth() { return this; }
    rect() { return this; }
    roundedRect() { return this; }
    line() { return this; }
    splitTextToSize(input: string) { return [input]; }
    save(name: string) { saveCalls.push(name); return this; }
  }
  return { jsPDF: FakeJsPDF, default: FakeJsPDF };
});

vi.mock('jspdf-autotable', () => {
  return { default: vi.fn() };
});

// ─── Subject under test (imported AFTER mocks) ──────────────────────────────
import { generateDs109Pdf, downloadDs109Pdf, hashRut, type Ds109Input } from './ds109Certificate';

const baseInput: Ds109Input = {
  workerName: 'Juan Pérez González',
  workerRut: '12.345.678-9',
  workerBirthDate: '1980-05-15',
  workerGender: 'M',
  workerAddress: 'Av. Siempre Viva 123, Santiago',
  employerName: 'Constructora Andes SpA',
  employerRut: '76.543.210-K',
  jobTitle: 'Operador de chancado',
  hireDate: '2018-03-01',
  workplaceAddress: 'Faena Los Bronces, Las Condes',
  occupationalHistory: [
    { yearFrom: 2010, yearTo: 2015, employer: 'Minera Norte SA', jobTitle: 'Operador minero', riskAgents: ['Sílice', 'Ruido'] },
    { yearFrom: 2015, yearTo: 2018, employer: 'Áridos Sur Ltda', jobTitle: 'Carguío', riskAgents: ['Sílice'] },
  ],
  diagnosis: 'Silicosis crónica simple',
  cieCode: 'J62.8',
  symptomsOnsetDate: '2024-09-10',
  clinicalFindings: 'Tos seca persistente, disnea de medianos esfuerzos. Rx tórax con micronódulos en lóbulos superiores. Espirometría con patrón restrictivo leve.',
  origin: 'laboral',
  causalAgent: 'Exposición prolongada a sílice cristalina (cuarzo) en operación de chancado.',
  evidenceBasis: 'Antecedente ocupacional de 14 años con exposición continua a polvo respirable de sílice. Hallazgos radiológicos compatibles con silicosis. Latencia esperada concuerda con literatura.',
  attributablePercent: undefined,
  evaluatorName: 'Dra. María Soto',
  evaluatorRut: '11.222.333-4',
  evaluatorRegistration: 'SS-INS-08412',
  evaluationDate: '2026-05-04',
};

beforeEach(() => {
  textCalls.length = 0;
  saveCalls.length = 0;
  pageCount = 1;
});

describe('generateDs109Pdf', () => {
  it('returns a jsPDF instance', () => {
    const pdf = generateDs109Pdf(baseInput);
    expect(pdf).toBeDefined();
    expect(typeof pdf.save).toBe('function');
  });

  it('creates exactly 5 pages for a typical anamnesis', () => {
    generateDs109Pdf(baseInput);
    // Initial page is implicit (1) + 4 addPage() calls = 5 pages total.
    expect(pageCount).toBe(5);
  });

  it('embeds the Ley 16.744 + DS 109 normative citation by default', () => {
    generateDs109Pdf(baseInput);
    const all = textCalls.join(' | ');
    expect(all).toMatch(/Ley 16\.?744/);
    expect(all).toMatch(/DS 109/);
  });

  it('renders the CIE-10 code when present', () => {
    generateDs109Pdf({ ...baseInput, cieCode: 'J62.8' });
    expect(textCalls.join(' | ')).toContain('J62.8');
  });

  it('omits the CIE-10 label when cieCode is undefined', () => {
    generateDs109Pdf({ ...baseInput, cieCode: undefined });
    expect(textCalls.join(' | ')).not.toContain('CÓDIGO CIE-10');
  });

  it('only renders attributable percent when origin === "mixto"', () => {
    // Case 1: laboral with a percent → must NOT show
    generateDs109Pdf({ ...baseInput, origin: 'laboral', attributablePercent: 70 });
    expect(textCalls.join(' | ')).not.toContain('PORCENTAJE ATRIBUIBLE AL TRABAJO');

    textCalls.length = 0;
    pageCount = 1;

    // Case 2: mixto with a percent → MUST show with the value
    generateDs109Pdf({ ...baseInput, origin: 'mixto', attributablePercent: 65 });
    const joined = textCalls.join(' | ');
    expect(joined).toContain('PORCENTAJE ATRIBUIBLE AL TRABAJO');
    expect(joined).toContain('65%');
  });

  it('renders all four origin labels correctly', () => {
    const origins: Ds109Input['origin'][] = ['laboral', 'comun', 'mixto', 'pendiente'];
    for (const origin of origins) {
      textCalls.length = 0;
      pageCount = 1;
      generateDs109Pdf({ ...baseInput, origin });
      const joined = textCalls.join(' | ');
      const expected = {
        laboral: 'ORIGEN LABORAL',
        comun: 'ORIGEN COMÚN',
        mixto: 'ORIGEN MIXTO',
        pendiente: 'CALIFICACIÓN PENDIENTE',
      }[origin];
      expect(joined).toContain(expected);
    }
  });

  it('handles empty occupational history without crashing', () => {
    expect(() => generateDs109Pdf({ ...baseInput, occupationalHistory: [] })).not.toThrow();
    expect(textCalls.join(' | ')).toContain('Sin antecedentes ocupacionales registrados.');
  });
});

describe('downloadDs109Pdf', () => {
  it('saves the PDF with a deterministic filename when none is provided', () => {
    downloadDs109Pdf(baseInput);
    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]).toMatch(/^DS109_Juan_P.+rez_Gonz.+lez_2026-05-04\.pdf$/);
  });

  it('uses the explicit filename override when provided', () => {
    downloadDs109Pdf(baseInput, 'custom_name.pdf');
    expect(saveCalls).toEqual(['custom_name.pdf']);
  });
});

describe('hashRut', () => {
  it('returns empty string for empty input', async () => {
    const h = await hashRut('');
    expect(h).toBe('');
  });

  it('produces stable hash for the same RUT regardless of formatting', async () => {
    const a = await hashRut('12.345.678-9');
    const b = await hashRut('123456789');
    const c = await hashRut(' 12345678-9 ');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.length).toBeGreaterThan(8);
  });

  it('produces different hashes for different RUTs', async () => {
    const a = await hashRut('12.345.678-9');
    const b = await hashRut('11.222.333-4');
    expect(a).not.toBe(b);
  });
});

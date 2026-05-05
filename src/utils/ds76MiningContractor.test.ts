// Praeventio Guard — DS 76 PDF generator tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const textCalls: string[] = [];
const saveCalls: string[] = [];
let pageCount = 1;

vi.mock('jspdf', () => {
  class FakeJsPDF {
    internal = {
      pageSize: { width: 210, height: 297 },
      getNumberOfPages: () => pageCount,
    };
    lastAutoTable = { finalY: 100 };
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

vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));

import {
  generateDs76Pdf,
  downloadDs76Pdf,
  type Ds76Input,
} from './ds76MiningContractor';

const baseInput: Ds76Input = {
  worksiteName: 'Faena Los Bronces',
  worksiteLocation: 'Comuna Lo Barnechea, Región Metropolitana',
  sernageominCode: 'SGM-RM-1234',
  principalCompanyName: 'Anglo American Sur SA',
  principalCompanyRut: '95.880.000-1',
  contractorCompanyName: 'Servicios Mineros del Sur SpA',
  contractorCompanyRut: '76.987.654-3',
  contractName: 'Mantención flota CAEX 2026 — N° SC-2026-014',
  contractStartDate: '2026-01-01',
  contractEndDate: '2026-12-31',
  workers: [
    { name: 'Pedro Soto', rut: '15.123.456-7', jobTitle: 'Mecánico CAEX' },
    { name: 'Juan Reyes', rut: '14.555.222-9', jobTitle: 'Soldador' },
  ],
  sgsstStandard: 'iso45001',
  sgsstCertificateNumber: 'BV-CL-451234',
  sgsstCertificateExpiry: '2027-08-15',
  criticalProcedures: ['trabajo_altura', 'electrico', 'caliente'],
  trainings: [
    { courseName: 'Reglamento Seguridad Minera (DS 132)', hours: 16, lastDeliveryDate: '2026-02-10' },
    { courseName: 'Trabajo en altura — NCh 1258', hours: 8, lastDeliveryDate: '2026-02-15' },
  ],
  contractorRepresentativeName: 'María Tapia',
  contractorRepresentativeRut: '11.444.555-6',
  mutualAuditorName: 'Felipe Hernández',
  mutualAuditorRut: '12.999.000-2',
  reportDate: '2026-05-04',
};

beforeEach(() => {
  textCalls.length = 0;
  saveCalls.length = 0;
  pageCount = 1;
});

describe('generateDs76Pdf', () => {
  it('returns a jsPDF instance', () => {
    const pdf = generateDs76Pdf(baseInput);
    expect(pdf).toBeDefined();
    expect(typeof pdf.save).toBe('function');
  });

  it('creates exactly 4 pages for a typical contractor record', () => {
    generateDs76Pdf(baseInput);
    expect(pageCount).toBe(4);
  });

  it('embeds the Ley 16.744 art. 66 bis + DS 76 normative citation by default', () => {
    generateDs76Pdf(baseInput);
    const all = textCalls.join(' | ');
    expect(all).toMatch(/Ley 16\.?744/);
    expect(all).toMatch(/DS 76/);
    expect(all).toMatch(/66 bis/);
  });

  it('renders the SGSST standard label (ISO 45001)', () => {
    generateDs76Pdf(baseInput);
    expect(textCalls.join(' | ')).toContain('ISO 45001:2018');
  });

  it('renders the SERNAGEOMIN code', () => {
    generateDs76Pdf(baseInput);
    expect(textCalls.join(' | ')).toContain('SGM-RM-1234');
  });

  it('handles empty workers and trainings without crashing', () => {
    expect(() =>
      generateDs76Pdf({ ...baseInput, workers: [], trainings: [] }),
    ).not.toThrow();
    const all = textCalls.join(' | ');
    expect(all).toContain('Sin nómina cargada.');
    expect(all).toContain('Sin capacitaciones registradas.');
  });
});

describe('downloadDs76Pdf', () => {
  it('saves the PDF with a deterministic filename when none is provided', () => {
    downloadDs76Pdf(baseInput);
    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]).toMatch(/^DS76_Servicios_Mineros_del_Sur_SpA_2026-05-04\.pdf$/);
  });
});

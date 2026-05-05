// Praeventio Guard — DS 67 PDF generator tests.
//
// Mocking strategy mirrors `ds109Certificate.test.ts`: replace `jspdf` and
// `jspdf-autotable` with lightweight fakes that record call sequences so we
// can assert on rendered text + page count + filename without invoking the
// actual rendering pipeline.

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

vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));

// ─── Subject under test (imported AFTER mocks) ──────────────────────────────
import { generateDs67Pdf, downloadDs67Pdf, type Ds67Input } from './ds67Notification';

const baseInput: Ds67Input = {
  workerName: 'Pedro Núñez Castro',
  workerRut: '15.123.456-7',
  workerBirthDate: '1985-01-12',
  workerJobTitle: 'Operador grúa',
  workerSeniorityYears: 7,
  employerName: 'Constructora Andes SpA',
  employerRut: '76.543.210-K',
  employerAddress: 'Av. Apoquindo 4500, Las Condes',
  mutualName: 'ACHS',
  accidentDate: '2026-05-04',
  accidentTime: '10:35',
  accidentLocation: 'Faena Norte — sector chancado, plataforma 3',
  accidentDescription: 'Trabajador resbaló en escalera metálica mojada al subir desde nivel inferior. Caída de 1.8m. Impacto en mano derecha al intentar amortiguar.',
  accidentType: 'Caída a distinto nivel',
  cieCode: 'S52.5',
  bodyPart: 'Mano derecha — dedo índice',
  severity: 'grave',
  estimatedDisabilityDays: 21,
  witnesses: [
    { name: 'Carlos Pérez', rut: '12.345.678-9', contact: '+56 9 8888 1111' },
    { name: 'Juan Silva', rut: '13.222.333-4' },
  ],
  immediateActions: 'Activación inmediata de protocolo BLS. Inmovilización de mano derecha. Llamado a ambulancia. Traslado a HUAP.',
  attendingDoctorName: 'Dr. Roberto Lagos',
  attendingDoctorRut: '11.222.333-4',
  attendingDoctorRegistration: 'SS-INS-04211',
  reportDate: '2026-05-04',
};

beforeEach(() => {
  textCalls.length = 0;
  saveCalls.length = 0;
  pageCount = 1;
});

describe('generateDs67Pdf', () => {
  it('returns a jsPDF instance', () => {
    const pdf = generateDs67Pdf(baseInput);
    expect(pdf).toBeDefined();
    expect(typeof pdf.save).toBe('function');
  });

  it('creates exactly 4 pages for a typical notification', () => {
    generateDs67Pdf(baseInput);
    expect(pageCount).toBe(4);
  });

  it('embeds the Ley 16.744 + DS 67 normative citation by default', () => {
    generateDs67Pdf(baseInput);
    const all = textCalls.join(' | ');
    expect(all).toMatch(/Ley 16\.?744/);
    expect(all).toMatch(/DS 67/);
  });

  it('renders the CIE-10 code when present', () => {
    generateDs67Pdf({ ...baseInput, cieCode: 'S52.5' });
    expect(textCalls.join(' | ')).toContain('S52.5');
  });

  it('omits the CIE-10 label when cieCode is undefined', () => {
    generateDs67Pdf({ ...baseInput, cieCode: undefined });
    expect(textCalls.join(' | ')).not.toContain('CÓDIGO CIE-10');
  });

  it('renders all severity labels correctly', () => {
    const severities: Ds67Input['severity'][] = ['leve', 'grave', 'fatal'];
    for (const severity of severities) {
      textCalls.length = 0;
      pageCount = 1;
      generateDs67Pdf({ ...baseInput, severity });
      const joined = textCalls.join(' | ');
      const expected = {
        leve: 'ACCIDENTE LEVE',
        grave: 'ACCIDENTE GRAVE',
        fatal: 'ACCIDENTE FATAL',
      }[severity];
      expect(joined).toContain(expected);
    }
  });

  it('handles empty witnesses without crashing', () => {
    expect(() => generateDs67Pdf({ ...baseInput, witnesses: [] })).not.toThrow();
    expect(textCalls.join(' | ')).toContain('Sin testigos registrados.');
  });

  it('embeds the 24-hour notification deadline reminder', () => {
    generateDs67Pdf(baseInput);
    const all = textCalls.join(' | ');
    expect(all).toMatch(/24 horas/);
  });
});

describe('downloadDs67Pdf', () => {
  it('saves the PDF with a deterministic filename when none is provided', () => {
    downloadDs67Pdf(baseInput);
    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]).toMatch(/^DS67_Pedro_N.+ez_Castro_2026-05-04\.pdf$/);
  });

  it('uses the explicit filename override when provided', () => {
    downloadDs67Pdf(baseInput, 'custom_ds67.pdf');
    expect(saveCalls).toEqual(['custom_ds67.pdf']);
  });
});

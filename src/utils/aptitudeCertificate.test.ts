// Praeventio Guard — Aptitude Certificate PDF generator tests.
//
// Strategy: mock `jsPDF` so we can assert on the sequence of calls without
// actually rendering. The constructor, text(), and save() captures let us
// verify field assembly, label selection, optional-block rendering, and the
// deterministic filename without a real PDF engine.
//
// ADR 0012: this module is a document generator — it renders data PROVIDED
// by a medical professional and must not infer diagnoses. Tests confirm only
// formatting / field assembly, never medical logic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const textCalls: string[] = [];
const saveCalls: string[] = [];

vi.mock('jspdf', () => {
  class FakeJsPDF {
    text(content: string | string[], ..._rest: unknown[]) {
      const s = Array.isArray(content) ? content.join(' ') : content;
      textCalls.push(s);
      return this;
    }
    setFillColor() { return this; }
    setDrawColor() { return this; }
    setTextColor() { return this; }
    setFontSize() { return this; }
    setFont() { return this; }
    rect() { return this; }
    roundedRect() { return this; }
    line() { return this; }
    splitTextToSize(input: string, _w?: number) { return [input]; }
    save(name: string) { saveCalls.push(name); return this; }
  }
  return { jsPDF: FakeJsPDF, default: FakeJsPDF };
});

// ─── Subject under test (imported AFTER mocks) ──────────────────────────────

import { generateAptitudeCertificate, type AptitudeData } from './aptitudeCertificate';

// ─── Base fixture ────────────────────────────────────────────────────────────

const BASE: AptitudeData = {
  workerName: 'Juan Pérez González',
  workerRut: '12.345.678-9',
  workerAge: 38,
  workerOccupation: 'Operador de maquinaria pesada',
  projectName: 'Constructora Andes SpA',
  examType: 'periodico',
  examDate: '15/04/2026',
  result: 'apto',
  doctorName: 'Dra. María Soto',
  doctorRut: '11.222.333-4',
  doctorRegistry: 'SS-INS-08412',
};

beforeEach(() => {
  textCalls.length = 0;
  saveCalls.length = 0;
});

// ─── Core rendering ──────────────────────────────────────────────────────────

describe('generateAptitudeCertificate — core rendering', () => {
  it('does not throw for a fully-populated fixture', () => {
    expect(() => generateAptitudeCertificate(BASE)).not.toThrow();
  });

  it('calls doc.save() exactly once per invocation', () => {
    generateAptitudeCertificate(BASE);
    expect(saveCalls.length).toBe(1);
  });

  it('embeds the normative citation (Ley 16.744 + DS 109)', () => {
    generateAptitudeCertificate(BASE);
    const joined = textCalls.join(' | ');
    expect(joined).toMatch(/Ley 16\.?744/);
    expect(joined).toMatch(/DS 109/);
  });

  it('embeds the brand name GUARDIAN PRAEVENTIO', () => {
    generateAptitudeCertificate(BASE);
    expect(textCalls.join(' | ')).toContain('GUARDIAN PRAEVENTIO');
  });
});

// ─── Filename assembly ───────────────────────────────────────────────────────

describe('generateAptitudeCertificate — filename', () => {
  it('saves with spaces replaced by underscores', () => {
    generateAptitudeCertificate(BASE);
    expect(saveCalls[0]).toContain('Juan_Pérez_González');
  });

  it('saves with slashes in examDate replaced by dashes', () => {
    generateAptitudeCertificate(BASE);
    expect(saveCalls[0]).toContain('15-04-2026');
  });

  it('filename matches pattern Aptitud_<name>_<date>.pdf', () => {
    generateAptitudeCertificate(BASE);
    expect(saveCalls[0]).toMatch(/^Aptitud_Juan_P.+rez_Gonz.+lez_15-04-2026\.pdf$/);
  });

  it('produces distinct filenames for workers with different names', () => {
    generateAptitudeCertificate(BASE);
    generateAptitudeCertificate({ ...BASE, workerName: 'Pedro Ramírez' });
    expect(saveCalls[0]).not.toBe(saveCalls[1]);
  });
});

// ─── EXAM_LABELS ─────────────────────────────────────────────────────────────

describe('generateAptitudeCertificate — examType labels', () => {
  const cases: Array<[AptitudeData['examType'], string]> = [
    ['pre_empleo',  'PRE-EMPLEO'],
    ['periodico',   'PERIÓDICO'],
    ['reintegro',   'REINTEGRO LABORAL'],
    ['egreso',      'EGRESO'],
    ['otro',        'OTRO'],
  ];

  for (const [examType, label] of cases) {
    it(`renders "${label}" for examType "${examType}"`, () => {
      generateAptitudeCertificate({ ...BASE, examType });
      expect(textCalls.join(' | ')).toContain(label);
    });
  }
});

// ─── RESULT_LABELS ────────────────────────────────────────────────────────────

describe('generateAptitudeCertificate — result labels', () => {
  const cases: Array<[AptitudeData['result'], string]> = [
    ['apto',                   'APTO'],
    ['apto_con_restricciones', 'APTO CON RESTRICCIONES'],
    ['no_apto',                'NO APTO'],
  ];

  for (const [result, label] of cases) {
    it(`renders "${label}" for result "${result}"`, () => {
      generateAptitudeCertificate({ ...BASE, result });
      expect(textCalls.join(' | ')).toContain(label);
    });
  }
});

// ─── Worker fields ───────────────────────────────────────────────────────────

describe('generateAptitudeCertificate — worker fields', () => {
  it('renders workerName in text calls', () => {
    generateAptitudeCertificate(BASE);
    expect(textCalls.join(' | ')).toContain('Juan Pérez González');
  });

  it('renders workerRut in text calls', () => {
    generateAptitudeCertificate(BASE);
    expect(textCalls.join(' | ')).toContain('12.345.678-9');
  });

  it('renders workerOccupation in text calls', () => {
    generateAptitudeCertificate(BASE);
    expect(textCalls.join(' | ')).toContain('Operador de maquinaria pesada');
  });

  it('renders workerAge as "<N> años" when provided', () => {
    generateAptitudeCertificate({ ...BASE, workerAge: 45 });
    expect(textCalls.join(' | ')).toContain('45 años');
  });

  it('renders "—" placeholder when workerAge is omitted', () => {
    const { workerAge: _ignored, ...noAge } = BASE;
    generateAptitudeCertificate(noAge as AptitudeData);
    // labelize() emits '—' for falsy values
    expect(textCalls.join(' | ')).toContain('—');
  });

  it('renders examDate verbatim in text calls', () => {
    generateAptitudeCertificate(BASE);
    expect(textCalls.join(' | ')).toContain('15/04/2026');
  });

  it('renders projectName in text calls', () => {
    generateAptitudeCertificate(BASE);
    expect(textCalls.join(' | ')).toContain('Constructora Andes SpA');
  });
});

// ─── Doctor fields ────────────────────────────────────────────────────────────

describe('generateAptitudeCertificate — doctor fields', () => {
  it('renders doctorName in the signature block', () => {
    generateAptitudeCertificate(BASE);
    expect(textCalls.join(' | ')).toContain('Dra. María Soto');
  });

  it('renders doctorRut prefixed with "RUT:"', () => {
    generateAptitudeCertificate(BASE);
    expect(textCalls.join(' | ')).toContain('RUT: 11.222.333-4');
  });

  it('renders doctorRegistry in text calls', () => {
    generateAptitudeCertificate(BASE);
    expect(textCalls.join(' | ')).toContain('SS-INS-08412');
  });
});

// ─── Optional blocks ─────────────────────────────────────────────────────────

describe('generateAptitudeCertificate — restrictions block', () => {
  it('renders restriction items when restrictions array is non-empty', () => {
    generateAptitudeCertificate({
      ...BASE,
      result: 'apto_con_restricciones',
      restrictions: ['No levantamiento > 15 kg', 'No trabajo en altura'],
    });
    const joined = textCalls.join(' | ');
    expect(joined).toContain('RESTRICCIONES LABORALES');
    expect(joined).toContain('No levantamiento > 15 kg');
    expect(joined).toContain('No trabajo en altura');
  });

  it('does not render restrictions header when array is empty', () => {
    generateAptitudeCertificate({ ...BASE, restrictions: [] });
    expect(textCalls.join(' | ')).not.toContain('RESTRICCIONES LABORALES');
  });

  it('does not render restrictions header when field is omitted', () => {
    const { restrictions: _ignored, ...noRestrictions } = BASE;
    generateAptitudeCertificate(noRestrictions as AptitudeData);
    expect(textCalls.join(' | ')).not.toContain('RESTRICCIONES LABORALES');
  });

  it('renders each restriction prefixed with bullet "•"', () => {
    generateAptitudeCertificate({
      ...BASE,
      restrictions: ['Restricción única'],
    });
    expect(textCalls.join(' | ')).toContain('•  Restricción única');
  });
});

describe('generateAptitudeCertificate — observations block', () => {
  it('renders observations when provided', () => {
    generateAptitudeCertificate({
      ...BASE,
      observations: 'Control médico en 6 meses.',
    });
    const joined = textCalls.join(' | ');
    expect(joined).toContain('OBSERVACIONES');
    expect(joined).toContain('Control médico en 6 meses.');
  });

  it('does not render observations header when field is omitted', () => {
    const { observations: _ignored, ...noObs } = BASE;
    generateAptitudeCertificate(noObs as AptitudeData);
    expect(textCalls.join(' | ')).not.toContain('OBSERVACIONES');
  });
});

describe('generateAptitudeCertificate — validUntil block', () => {
  it('renders validUntil when provided', () => {
    generateAptitudeCertificate({ ...BASE, validUntil: '15/04/2027' });
    const joined = textCalls.join(' | ');
    expect(joined).toContain('Vigencia hasta:');
    expect(joined).toContain('15/04/2027');
  });

  it('does not render vigencia line when validUntil is omitted', () => {
    const { validUntil: _ignored, ...noValidity } = BASE;
    generateAptitudeCertificate(noValidity as AptitudeData);
    expect(textCalls.join(' | ')).not.toContain('Vigencia hasta:');
  });
});

// ─── Combined optional paths ──────────────────────────────────────────────────

describe('generateAptitudeCertificate — all optional fields together', () => {
  it('renders all optional fields simultaneously without throwing', () => {
    expect(() =>
      generateAptitudeCertificate({
        ...BASE,
        workerAge: 52,
        result: 'apto_con_restricciones',
        restrictions: ['No exposición a ruido > 85 dB'],
        observations: 'Derivar a ORL en 3 meses.',
        validUntil: '15/04/2027',
      }),
    ).not.toThrow();
    const joined = textCalls.join(' | ');
    expect(joined).toContain('RESTRICCIONES LABORALES');
    expect(joined).toContain('OBSERVACIONES');
    expect(joined).toContain('Vigencia hasta:');
  });

  it('renders with all optional fields absent without throwing', () => {
    const minimal: AptitudeData = {
      workerName: 'Ana López',
      workerRut: '9.876.543-2',
      workerOccupation: 'Enfermera',
      projectName: 'Hospital Regional',
      examType: 'egreso',
      examDate: '01/05/2026',
      result: 'no_apto',
      doctorName: 'Dr. Carlos Vega',
      doctorRut: '15.432.100-8',
      doctorRegistry: 'SS-INS-00001',
    };
    expect(() => generateAptitudeCertificate(minimal)).not.toThrow();
    expect(saveCalls.length).toBe(1);
  });
});

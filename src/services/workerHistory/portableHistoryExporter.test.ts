import { describe, it, expect } from 'vitest';
import {
  buildPortableHistory,
  redactPII,
  serializeAsJson,
  serializeAsMarkdown,
  type BuildOptions,
  type PortableWorkerHistory,
  type WorkerData,
} from './portableHistoryExporter.js';

function workerFixture(over: Partial<WorkerData> = {}): WorkerData {
  return {
    identity: {
      fullName: 'Juan Pérez Soto',
      rut: '12345678-9',
      birthYear: 1985,
      email: 'juan@example.cl',
    },
    employmentSpans: [
      {
        employerName: 'Minera Andes SA',
        startDate: '2018-03-15',
        endDate: '2022-06-30',
        position: 'Operador de planta',
        industry: 'minería',
      },
      {
        employerName: 'Constructora Sur',
        startDate: '2022-07-15',
        endDate: null,
        position: 'Supervisor SSO',
        industry: 'construcción',
      },
    ],
    completedTrainings: [
      {
        trainingCode: 'altura_R1',
        trainingName: 'Trabajo en altura',
        obtainedAt: '2024-03-10',
        expiresAt: '2026-03-10',
        issuer: 'ACHS',
        hours: 16,
      },
    ],
    certifications: [
      {
        certificationCode: 'COL_RIG_1',
        certificationName: 'Rigger certificado',
        obtainedAt: '2023-11-20',
        expiresAt: '2027-11-20',
        issuer: 'Mutual de Seguridad',
        folio: 'F-2023-9981',
      },
    ],
    eppHistory: [
      {
        eppCategory: 'arnés',
        eppModel: 'Petzl Sequoia',
        deliveredAt: '2024-04-01',
        nextReplacementAt: '2026-04-01',
      },
    ],
    exposureLog: [
      { agent: 'ruido', totalHours: 1850, year: 2024, averageMeasurement: 82, measurementUnit: 'dB(A)' },
      { agent: 'polvo_sílice', totalHours: 420, year: 2024 },
    ],
    medicalContext: [
      {
        category: 'aptitud_ocupacional',
        summary: 'Apto con restricción: revisión audiométrica anual.',
        recordedAt: '2024-12-05',
        source: 'Dr. Ramírez, Mutual',
      },
    ],
    ...over,
  };
}

function optionsFixture(over: Partial<BuildOptions> = {}): BuildOptions {
  return {
    redactionLevel: 'employer',
    includeMedical: false,
    exportedAt: '2026-05-12T10:00:00.000Z',
    requestedBy: { uid: 'w-001', role: 'self' },
    ...over,
  };
}

describe('buildPortableHistory — ADR 0012 enforcement', () => {
  it('default (includeMedical=false) NUNCA exporta medicalContext aunque worker lo tenga', () => {
    const h = buildPortableHistory(workerFixture(), optionsFixture());
    expect(h.medicalContext).toBe('REDACTED');
    expect(h.includesMedical).toBe(false);
  });

  it('includeMedical=true PERO redactionLevel="employer" sigue redactando medicalContext (sólo medical lo permite)', () => {
    const h = buildPortableHistory(
      workerFixture(),
      optionsFixture({ includeMedical: true, redactionLevel: 'employer' }),
    );
    expect(h.medicalContext).toBe('REDACTED');
    expect(h.includesMedical).toBe(false);
  });

  it('includeMedical=true + redactionLevel="medical" → exporta contexto médico completo', () => {
    const h = buildPortableHistory(
      workerFixture(),
      optionsFixture({ includeMedical: true, redactionLevel: 'medical' }),
    );
    expect(Array.isArray(h.medicalContext)).toBe(true);
    expect(h.includesMedical).toBe(true);
    if (Array.isArray(h.medicalContext)) {
      expect(h.medicalContext).toHaveLength(1);
      expect(h.medicalContext[0]?.category).toBe('aptitud_ocupacional');
    }
  });

  it('disclaimer ADR 0012 está siempre presente', () => {
    const h = buildPortableHistory(workerFixture(), optionsFixture());
    expect(h.disclaimer).toMatch(/Praeventio nunca diagnostica/);
    expect(h.disclaimer).toMatch(/Ley 19\.628/);
  });
});

describe('buildPortableHistory — niveles de redacción', () => {
  it('redactionLevel="public": rutHash sí, RUT en claro NO, sin email, sin birthYear', () => {
    const h = buildPortableHistory(workerFixture(), optionsFixture({ redactionLevel: 'public' }));
    expect(h.identity.rutHash).toMatch(/^[a-f0-9]{64}$/);
    expect(h.identity.rut).toBeUndefined();
    expect(h.identity.email).toBeUndefined();
    expect(h.identity.birthYear).toBeUndefined();
  });

  it('redactionLevel="public" redacta fechas exactas a YYYY-MM-XX', () => {
    const h = buildPortableHistory(workerFixture(), optionsFixture({ redactionLevel: 'public' }));
    expect(h.employmentSpans[0]?.startDate).toBe('2018-03-XX');
    expect(h.completedTrainings[0]?.obtainedAt).toBe('2024-03-XX');
    expect(h.eppHistory[0]?.deliveredAt).toBe('2024-04-XX');
  });

  it('redactionLevel="public" remueve folio de certificaciones', () => {
    const h = buildPortableHistory(workerFixture(), optionsFixture({ redactionLevel: 'public' }));
    expect(h.certifications[0]?.folio).toBeUndefined();
  });

  it('redactionLevel="employer" incluye RUT en claro y datos básicos pero NO médico', () => {
    const h = buildPortableHistory(
      workerFixture(),
      optionsFixture({ redactionLevel: 'employer' }),
    );
    expect(h.identity.rut).toBe('12345678-9');
    expect(h.identity.email).toBe('juan@example.cl');
    expect(h.medicalContext).toBe('REDACTED');
  });
});

describe('redactPII', () => {
  it('baja de "medical" → "public" tacha medical y datos sensibles de identidad', () => {
    const full = buildPortableHistory(
      workerFixture(),
      optionsFixture({ includeMedical: true, redactionLevel: 'medical' }),
    );
    const redacted = redactPII(full, 'public');
    expect(redacted.medicalContext).toBe('REDACTED');
    expect(redacted.includesMedical).toBe(false);
    expect(redacted.identity.rut).toBeUndefined();
    expect(redacted.identity.email).toBeUndefined();
    expect(redacted.redactionLevel).toBe('public');
  });

  it('redactPII NO muta el history original', () => {
    const full = buildPortableHistory(
      workerFixture(),
      optionsFixture({ includeMedical: true, redactionLevel: 'medical' }),
    );
    const before = JSON.stringify(full);
    redactPII(full, 'public');
    expect(JSON.stringify(full)).toBe(before);
  });

  it('redactPII a "employer" mantiene RUT en claro pero quita médico', () => {
    const full = buildPortableHistory(
      workerFixture(),
      optionsFixture({ includeMedical: true, redactionLevel: 'medical' }),
    );
    const r = redactPII(full, 'employer');
    expect(r.identity.rut).toBe('12345678-9');
    expect(r.medicalContext).toBe('REDACTED');
  });
});

describe('serializeAsJson — estabilidad y checksum', () => {
  it('mismo input produce mismo checksum (determinístico)', () => {
    const h1 = buildPortableHistory(workerFixture(), optionsFixture());
    const h2 = buildPortableHistory(workerFixture(), optionsFixture());
    const s1 = serializeAsJson(h1);
    const s2 = serializeAsJson(h2);
    expect(s1.body).toBe(s2.body);
    expect(s1.checksum).toBe(s2.checksum);
    expect(s1.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('orden de keys del input NO afecta el checksum (canónico)', () => {
    const h1 = buildPortableHistory(workerFixture(), optionsFixture());
    // Cambiar orden de keys manualmente
    const reshuffled: PortableWorkerHistory = {
      disclaimer: h1.disclaimer,
      medicalContext: h1.medicalContext,
      exposureLog: h1.exposureLog,
      eppHistory: h1.eppHistory,
      certifications: h1.certifications,
      completedTrainings: h1.completedTrainings,
      employmentSpans: h1.employmentSpans,
      identity: h1.identity,
      requestedBy: h1.requestedBy,
      includesMedical: h1.includesMedical,
      redactionLevel: h1.redactionLevel,
      exportedAt: h1.exportedAt,
      schemaVersion: h1.schemaVersion,
    };
    expect(serializeAsJson(reshuffled).checksum).toBe(serializeAsJson(h1).checksum);
  });

  it('checksum cambia si cualquier dato cambia', () => {
    const h1 = buildPortableHistory(workerFixture(), optionsFixture());
    const h2 = buildPortableHistory(
      workerFixture({
        completedTrainings: [
          {
            trainingCode: 'OTRO',
            trainingName: 'Otro curso',
            obtainedAt: '2024-01-01',
            expiresAt: null,
            issuer: 'X',
            hours: 8,
          },
        ],
      }),
      optionsFixture(),
    );
    expect(serializeAsJson(h1).checksum).not.toBe(serializeAsJson(h2).checksum);
  });

  it('body es JSON parseable', () => {
    const h = buildPortableHistory(workerFixture(), optionsFixture());
    const { body } = serializeAsJson(h);
    expect(() => JSON.parse(body)).not.toThrow();
  });
});

describe('serializeAsMarkdown', () => {
  it('contiene todas las secciones esperadas', () => {
    const h = buildPortableHistory(
      workerFixture(),
      optionsFixture({ includeMedical: true, redactionLevel: 'medical' }),
    );
    const { body } = serializeAsMarkdown(h);
    expect(body).toContain('# Historial Profesional Portátil');
    expect(body).toContain('## Identidad');
    expect(body).toContain('## Historial Laboral');
    expect(body).toContain('## Capacitaciones');
    expect(body).toContain('## Certificaciones');
    expect(body).toContain('## EPP');
    expect(body).toContain('## Exposición Agregada');
    expect(body).toContain('## Contexto Médico');
    expect(body).toContain('Praeventio nunca diagnostica');
  });

  it('cuando medicalContext está REDACTED el markdown lo refleja explícitamente', () => {
    const h = buildPortableHistory(workerFixture(), optionsFixture());
    const { body } = serializeAsMarkdown(h);
    expect(body).toMatch(/REDACTED — no autorizado/);
  });

  it('markdown checksum cambia con datos', () => {
    const h1 = buildPortableHistory(workerFixture(), optionsFixture());
    const h2 = buildPortableHistory(
      workerFixture({
        identity: { ...workerFixture().identity, fullName: 'Otro Nombre' },
      }),
      optionsFixture(),
    );
    expect(serializeAsMarkdown(h1).checksum).not.toBe(serializeAsMarkdown(h2).checksum);
  });
});

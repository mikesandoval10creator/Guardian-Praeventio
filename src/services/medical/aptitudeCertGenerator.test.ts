// Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Generator tests.
//
// Praeventio NO push a MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal.
import { describe, it, expect } from 'vitest';
import {
  generateAptitudeCert,
  hashAptitudeCertJson,
  type AptitudeCertInput,
} from './aptitudeCertGenerator.js';

const baseInput: AptitudeCertInput = {
  workerUid: 'uid-worker-1',
  workerRut: '12.345.678-9',
  workerName: 'José Ñuñez Ávila',
  workerOccupation: 'Operario de obra',
  doctorUid: 'uid-doc-1',
  doctorRut: '11.111.111-1',
  doctorName: 'Dra. María Soledad Peña',
  doctorRsm: 'RSM-12345',
  examType: 'pre_empleo',
  examDate: '2026-05-05',
  fitnessVerdict: 'apto',
  restrictions: [],
  validUntil: '2027-05-05',
  employerRut: '76.543.210-K',
  projectId: 'proj-alpha',
};

describe('generateAptitudeCert — shape + PDF', () => {
  it('valid input produces certId, certHash, JSON payload, and a non-empty PDF buffer', async () => {
    const result = await generateAptitudeCert(baseInput, {
      now: () => new Date('2026-05-05T10:00:00Z'),
    });
    expect(result.certId).toMatch(/^APT-2026-/);
    expect(result.certHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.json.worker.rut).toBe(baseInput.workerRut);
    expect(result.json.legal.pushedToMutual).toBe(false);
    expect(Buffer.isBuffer(result.pdf)).toBe(true);
    expect(result.pdf.length).toBeGreaterThan(500);
    // PDF starts with %PDF magic bytes
    expect(result.pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('hash is deterministic for same input + same clock', async () => {
    const a = await generateAptitudeCert(baseInput, {
      now: () => new Date('2026-05-05T10:00:00Z'),
    });
    const b = await generateAptitudeCert(baseInput, {
      now: () => new Date('2026-05-05T10:00:00Z'),
    });
    expect(a.certHash).toBe(b.certHash);
    expect(hashAptitudeCertJson(a.json)).toBe(a.certHash);
  });

  it('handles fitness verdict apto_con_restricciones with bullet list', async () => {
    const result = await generateAptitudeCert(
      {
        ...baseInput,
        fitnessVerdict: 'apto_con_restricciones',
        restrictions: ['No exposición a ruido >85dB', 'Sin trabajo en altura >1.8m'],
      },
      { now: () => new Date('2026-05-05T10:00:00Z') },
    );
    expect(result.json.verdict.fitness).toBe('apto_con_restricciones');
    expect(result.json.verdict.restrictions).toHaveLength(2);
  });

  it('handles fitness verdict no_apto', async () => {
    const result = await generateAptitudeCert(
      { ...baseInput, fitnessVerdict: 'no_apto', restrictions: [] },
      { now: () => new Date('2026-05-05T10:00:00Z') },
    );
    expect(result.json.verdict.fitness).toBe('no_apto');
  });

  it('rejects invalid worker RUT with Zod parse error', async () => {
    await expect(
      generateAptitudeCert({ ...baseInput, workerRut: 'NOT-A-RUT' }),
    ).rejects.toThrow();
  });
});

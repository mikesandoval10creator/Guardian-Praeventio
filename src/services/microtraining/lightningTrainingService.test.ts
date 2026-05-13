import { describe, it, expect } from 'vitest';
import {
  selectMicroModule,
  scoreSession,
  isPassing,
  shouldCertify,
  catalogRiskCoverage,
  PASS_THRESHOLD,
  MICROTRAINING_CATALOG,
  type ContextTrigger,
  type MicroTrainingModule,
  type MicroTrainingSession,
} from './lightningTrainingService.js';

const buildSession = (
  moduleId: string,
  answers: Array<{ blockIndex: number; selectedIndex: number }>,
): MicroTrainingSession => ({
  workerUid: 'w-1',
  moduleId,
  startedAt: 0,
  answers,
});

describe('selectMicroModule', () => {
  it('elige módulo del primer riesgo detectado no certificado', () => {
    const trigger: ContextTrigger = {
      workerUid: 'w-1',
      detectedRisks: ['altura', 'electrico'],
      certifiedModuleIds: [],
    };
    const m = selectMicroModule(trigger);
    expect(m?.riskCategory).toBe('altura');
  });

  it('salta al siguiente riesgo si el módulo ya está certificado', () => {
    const trigger: ContextTrigger = {
      workerUid: 'w-1',
      detectedRisks: ['altura', 'electrico'],
      certifiedModuleIds: ['mt-altura-v1'],
    };
    const m = selectMicroModule(trigger);
    expect(m?.riskCategory).toBe('electrico');
  });

  it('retorna null si todos los riesgos ya están cubiertos', () => {
    const trigger: ContextTrigger = {
      workerUid: 'w-1',
      detectedRisks: ['altura'],
      certifiedModuleIds: ['mt-altura-v1'],
    };
    expect(selectMicroModule(trigger)).toBeNull();
  });

  it('retorna null si no hay riesgos detectados', () => {
    const trigger: ContextTrigger = {
      workerUid: 'w-1',
      detectedRisks: [],
      certifiedModuleIds: [],
    };
    expect(selectMicroModule(trigger)).toBeNull();
  });

  it('acepta catálogo custom', () => {
    const custom: MicroTrainingModule[] = [
      {
        id: 'mt-custom-1',
        title: 'Custom',
        durationMinutes: 3,
        riskCategory: 'ruido',
        certifyOnPass: false,
        content: [],
      },
    ];
    const trigger: ContextTrigger = {
      workerUid: 'w-1',
      detectedRisks: ['ruido'],
      certifiedModuleIds: [],
    };
    expect(selectMicroModule(trigger, custom)?.id).toBe('mt-custom-1');
  });
});

describe('scoreSession', () => {
  const altura = MICROTRAINING_CATALOG.find((m) => m.id === 'mt-altura-v1')!;

  it('100 con todas correctas', () => {
    const session = buildSession('mt-altura-v1', [
      { blockIndex: 1, selectedIndex: 1 },
      { blockIndex: 2, selectedIndex: 1 },
    ]);
    expect(scoreSession(session, altura)).toBe(100);
  });

  it('50 con mitad correctas', () => {
    const session = buildSession('mt-altura-v1', [
      { blockIndex: 1, selectedIndex: 1 },
      { blockIndex: 2, selectedIndex: 0 },
    ]);
    expect(scoreSession(session, altura)).toBe(50);
  });

  it('0 sin respuestas correctas', () => {
    const session = buildSession('mt-altura-v1', [
      { blockIndex: 1, selectedIndex: 0 },
      { blockIndex: 2, selectedIndex: 0 },
    ]);
    expect(scoreSession(session, altura)).toBe(0);
  });

  it('0 sin respuestas', () => {
    const session = buildSession('mt-altura-v1', []);
    expect(scoreSession(session, altura)).toBe(0);
  });

  it('100 si el módulo no tiene quizzes', () => {
    const onlyText: MicroTrainingModule = {
      id: 'mt-x',
      title: 't',
      durationMinutes: 3,
      riskCategory: 'ergo',
      certifyOnPass: false,
      content: [{ kind: 'text', payload: { body: 'x' } }],
    };
    const session = buildSession('mt-x', []);
    expect(scoreSession(session, onlyText)).toBe(100);
  });
});

describe('isPassing', () => {
  it('80 pasa', () => {
    expect(isPassing(PASS_THRESHOLD)).toBe(true);
  });
  it('79 no pasa', () => {
    expect(isPassing(79)).toBe(false);
  });
});

describe('shouldCertify', () => {
  const altura = MICROTRAINING_CATALOG.find((m) => m.id === 'mt-altura-v1')!;
  const ergo = MICROTRAINING_CATALOG.find((m) => m.id === 'mt-ergo-v1')!;

  it('certifica al pasar + certifyOnPass', () => {
    const session = buildSession('mt-altura-v1', [
      { blockIndex: 1, selectedIndex: 1 },
      { blockIndex: 2, selectedIndex: 1 },
    ]);
    session.score = 100;
    expect(shouldCertify(session, altura)).toBe(true);
  });

  it('no certifica si no pasa', () => {
    const session = buildSession('mt-altura-v1', []);
    session.score = 0;
    expect(shouldCertify(session, altura)).toBe(false);
  });

  it('no certifica si certifyOnPass=false aunque pase', () => {
    const session = buildSession('mt-ergo-v1', [
      { blockIndex: 1, selectedIndex: 1 },
    ]);
    session.score = 100;
    expect(shouldCertify(session, ergo)).toBe(false);
  });

  it('usa scoreSession si session.score no está set', () => {
    const session = buildSession('mt-altura-v1', [
      { blockIndex: 1, selectedIndex: 1 },
      { blockIndex: 2, selectedIndex: 1 },
    ]);
    expect(shouldCertify(session, altura)).toBe(true);
  });
});

describe('catálogo canónico', () => {
  it('cubre 5+ riesgos canónicos', () => {
    const coverage = catalogRiskCoverage();
    expect(coverage.length).toBeGreaterThanOrEqual(5);
    expect(coverage).toEqual(
      expect.arrayContaining([
        'altura',
        'electrico',
        'hazmat',
        'ergo',
        'lineas_de_fuego',
      ]),
    );
  });

  it('todos los módulos tienen duración 3-5 min', () => {
    for (const m of MICROTRAINING_CATALOG) {
      expect(m.durationMinutes).toBeGreaterThanOrEqual(3);
      expect(m.durationMinutes).toBeLessThanOrEqual(5);
    }
  });

  it('todo bloque quiz tiene correctIndex válido', () => {
    for (const m of MICROTRAINING_CATALOG) {
      for (const block of m.content) {
        if (block.kind === 'quiz') {
          expect(block.payload.correctIndex).toBeGreaterThanOrEqual(0);
          expect(block.payload.correctIndex).toBeLessThan(
            block.payload.options.length,
          );
        }
      }
    }
  });

  it('todos los módulos tienen id único', () => {
    const ids = MICROTRAINING_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

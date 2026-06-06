// Tests §12.5.1 split step 8 — gemini/emergency.ts.

import { describe, it, expect } from 'vitest';
import {
  generateEmergencyPlan,
  generateEmergencyScenario,
  generateEmergencyPlanJSON,
  baselineEmergencyPlan,
  emergencyPlanFromResponse,
} from './emergency';

describe('emergency — sin API_KEY', () => {
  it('generateEmergencyPlan throws sin key', async () => {
    await expect(
      generateEmergencyPlan('Proyecto X', 'ctx', 'mineria'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });

  it('generateEmergencyScenario throws sin key', async () => {
    await expect(generateEmergencyScenario('ctx')).rejects.toThrow(
      'GEMINI_API_KEY is not configured',
    );
  });

  it('generateEmergencyPlanJSON throws sin key', async () => {
    await expect(
      generateEmergencyPlanJSON('Sismo', 'magnitud 7', 'DS 594'),
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
  });
});

describe('emergency — contract', () => {
  it('3 funciones son async', () => {
    for (const fn of [
      generateEmergencyPlan,
      generateEmergencyScenario,
      generateEmergencyPlanJSON,
    ]) {
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});

describe('baselineEmergencyPlan — fallback de vida', () => {
  const plan = baselineEmergencyPlan('Incendio', 'fuego en bodega de solventes', 'DS 594', 'mineria');

  it('rellena todas las secciones requeridas del plan', () => {
    expect(plan.objetivo.trim().length).toBeGreaterThan(0);
    expect(plan.alcance.trim().length).toBeGreaterThan(0);
    expect(plan.marcoLegal.length).toBeGreaterThan(0);
    expect(plan.evaluacionMatematica.trim().length).toBeGreaterThan(0);
    expect(plan.cadenaMando.length).toBeGreaterThan(0);
    expect(plan.accionesInmediatas.length).toBeGreaterThan(0);
    expect(plan.evacuacion.length).toBeGreaterThan(0);
    expect(plan.equipos.length).toBeGreaterThan(0);
  });

  it('marca generadoSinIA para que la UI sea honesta', () => {
    expect(plan.generadoSinIA).toBe(true);
  });

  it('cita normas chilenas reales (no fabricadas)', () => {
    const marco = plan.marcoLegal.join(' ');
    expect(marco).toContain('16.744');
    expect(marco).toContain('184');
    expect(marco).toContain('594');
    expect(marco).toContain('44/2024');
  });

  it('incluye números de emergencia reales y la fórmula MR=PxC', () => {
    const acciones = plan.accionesInmediatas.join(' ');
    expect(acciones).toContain('131'); // SAMU
    expect(acciones).toContain('132'); // Bomberos
    expect(acciones).toContain('133'); // Carabineros
    expect(plan.evaluacionMatematica).toContain('MR');
    expect(plan.evaluacionMatematica).toContain('\\times');
  });

  it('refleja el escenario y la descripción recibidos', () => {
    expect(plan.objetivo).toContain('Incendio');
    expect(plan.alcance).toContain('fuego en bodega de solventes');
  });
});

describe('emergencyPlanFromResponse — degradación grácil', () => {
  it('usa el plan del modelo cuando es completo', () => {
    const modelPlan = {
      objetivo: 'o',
      alcance: 'a',
      marcoLegal: ['Ley 16.744'],
      evaluacionMatematica: '$MR = P \\times C$',
      cadenaMando: ['jefe'],
      accionesInmediatas: ['alarma'],
      evacuacion: ['salir'],
      equipos: ['extintor'],
    };
    const out = emergencyPlanFromResponse(
      { text: JSON.stringify(modelPlan) },
      'Sismo',
      'magnitud 7',
      'DS 594',
    );
    expect(out.objetivo).toBe('o');
    expect(out.generadoSinIA).toBeUndefined();
  });

  it('cae al baseline cuando el modelo devuelve texto vacío', () => {
    const out = emergencyPlanFromResponse({ text: '' }, 'Sismo', 'magnitud 7', 'DS 594');
    expect(out.generadoSinIA).toBe(true);
    expect(out.objetivo).toContain('Sismo');
  });

  it('cae al baseline cuando el modelo devuelve JSON inválido', () => {
    const out = emergencyPlanFromResponse({ text: '{no es json' }, 'Derrame', 'ácido', 'DS 594');
    expect(out.generadoSinIA).toBe(true);
  });

  it('cae al baseline cuando el JSON es válido pero incompleto', () => {
    const out = emergencyPlanFromResponse(
      { text: JSON.stringify({ objetivo: 'solo esto' }) },
      'Explosión',
      'gas',
      'DS 594',
    );
    expect(out.generadoSinIA).toBe(true);
  });

  it('cae al baseline si un arreglo contiene elementos no-string (evita crash en UI)', () => {
    const badPlan = {
      objetivo: 'o',
      alcance: 'a',
      marcoLegal: [{}], // objeto en vez de string → no renderizable como React child
      evaluacionMatematica: '$MR = P \\times C$',
      cadenaMando: ['jefe'],
      accionesInmediatas: ['alarma'],
      evacuacion: ['salir'],
      equipos: ['extintor'],
    };
    const out = emergencyPlanFromResponse(
      { text: JSON.stringify(badPlan) },
      'Sismo',
      'magnitud 7',
      'DS 594',
    );
    expect(out.generadoSinIA).toBe(true);
  });

  it('cae al baseline si un arreglo contiene null', () => {
    const badPlan = {
      objetivo: 'o',
      alcance: 'a',
      marcoLegal: ['Ley 16.744'],
      evaluacionMatematica: '$MR = P \\times C$',
      cadenaMando: ['jefe'],
      accionesInmediatas: ['alarma'],
      evacuacion: [null],
      equipos: ['extintor'],
    };
    const out = emergencyPlanFromResponse(
      { text: JSON.stringify(badPlan) },
      'Sismo',
      'magnitud 7',
      'DS 594',
    );
    expect(out.generadoSinIA).toBe(true);
  });
});

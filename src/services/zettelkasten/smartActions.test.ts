// Tests §12.1.6 — Smart actions ZK.

import { describe, it, expect } from 'vitest';
import {
  detectWorkersWithoutEpp,
  detectProjectsWithoutNormatives,
  detectProjectsWithoutIndustry,
  detectWorkersWithoutMandatoryTraining,
  detectAllSmartActions,
  type KnowledgeGraphSnapshot,
} from './smartActions';

const NOW = '2026-05-21T04:00:00.000Z';

const emptySnapshot: KnowledgeGraphSnapshot = {
  workers: [],
  projects: [],
  workerEppConnections: new Map(),
  workerTrainingConnections: new Map(),
  projectNormatives: new Map(),
};

describe('detectWorkersWithoutEpp', () => {
  it('worker sin EPP → sugerencia create-worker-epp-connection', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      workers: [{ id: 'w-1', name: 'Juan Pérez', cargo: 'operario_construccion' }],
    };
    const actions = detectWorkersWithoutEpp(snap, NOW);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe('create-worker-epp-connection');
    expect(actions[0]?.priority).toBe('high');
    expect(actions[0]?.rationale).toContain('DS 594');
  });

  it('sugiere EPP típico del cargo', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      workers: [{ id: 'w-1', name: 'Pedro', cargo: 'electricista' }],
    };
    const actions = detectWorkersWithoutEpp(snap, NOW);
    const mutations = actions[0]?.proposedMutations ?? [];
    expect(mutations.some((m) => m.edgeToId === 'helmet_dielectric')).toBe(true);
  });

  it('worker con EPP → 0 sugerencias', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      workers: [{ id: 'w-1', name: 'Ana', cargo: 'soldador' }],
      workerEppConnections: new Map([['w-1', ['helmet_welding']]]),
    };
    expect(detectWorkersWithoutEpp(snap, NOW)).toEqual([]);
  });

  it('confidence menor sin cargo', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      workers: [{ id: 'w-1', name: 'X' }],
    };
    const actions = detectWorkersWithoutEpp(snap, NOW);
    expect(actions[0]?.confidence).toBeLessThan(0.7);
  });
});

describe('detectProjectsWithoutNormatives', () => {
  it('proyecto sin normativa → sugerir base', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      projects: [{ id: 'p-1', name: 'Edificio X' }],
    };
    const actions = detectProjectsWithoutNormatives(snap, NOW);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe('suggest-normatives-for-project');
    expect(actions[0]?.proposedMutations.some((m) => m.edgeToId === 'ley_16744')).toBe(true);
    expect(actions[0]?.proposedMutations.some((m) => m.edgeToId === 'ds_44_2024')).toBe(true);
  });

  it('proyecto con normativa → 0', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      projects: [{ id: 'p-1', name: 'X' }],
      projectNormatives: new Map([['p-1', ['ley_16744']]]),
    };
    expect(detectProjectsWithoutNormatives(snap, NOW)).toEqual([]);
  });
});

describe('detectProjectsWithoutIndustry', () => {
  it('detecta industry desde nombre — construcción', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      projects: [{ id: 'p-1', name: 'Construcción edificio Apoquindo' }],
    };
    const actions = detectProjectsWithoutIndustry(snap, NOW);
    expect(actions[0]?.proposedMutations[0]?.payload?.industry).toBe('GP-CONS-EDI');
  });

  it('detecta minería desde descripción', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      projects: [
        {
          id: 'p-1',
          name: 'Proyecto Norte',
          description: 'Extracción de cobre en mina subterránea',
        },
      ],
    };
    const actions = detectProjectsWithoutIndustry(snap, NOW);
    expect(actions[0]?.proposedMutations[0]?.payload?.industry).toBe('GP-MIN-MET');
  });

  it('sin match → confidence baja, sin mutations', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      projects: [{ id: 'p-1', name: 'X' }],
    };
    const actions = detectProjectsWithoutIndustry(snap, NOW);
    expect(actions[0]?.confidence).toBeLessThan(0.5);
    expect(actions[0]?.proposedMutations).toEqual([]);
  });

  it('proyecto con industry → 0 sugerencias', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      projects: [{ id: 'p-1', name: 'X', industry: 'GP-MIN-MET' }],
    };
    expect(detectProjectsWithoutIndustry(snap, NOW)).toEqual([]);
  });
});

describe('detectWorkersWithoutMandatoryTraining', () => {
  it('worker reciente sin capacitación obligatoria → sugerencia', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      workers: [
        {
          id: 'w-1',
          name: 'Pedro',
          hireDate: '2026-05-15T00:00:00.000Z', // 6 días atrás
        },
      ],
    };
    const actions = detectWorkersWithoutMandatoryTraining(snap, NOW);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.rationale).toContain('DS 54');
    expect(actions[0]?.priority).toBe('high');
  });

  it('worker con todas las capacitaciones → 0', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      workers: [{ id: 'w-1', name: 'P', hireDate: '2026-05-15T00:00:00.000Z' }],
      workerTrainingConnections: new Map([
        [
          'w-1',
          [
            'induccion_general_riesgos',
            'uso_correcto_epp',
            'emergencias_evacuacion',
            'primeros_auxilios_basicos',
          ],
        ],
      ]),
    };
    expect(detectWorkersWithoutMandatoryTraining(snap, NOW)).toEqual([]);
  });

  it('worker antiguo (>30 días) sin capacitación → 0 (asume cubierto por proceso)', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      workers: [{ id: 'w-1', name: 'P', hireDate: '2025-01-01T00:00:00.000Z' }],
    };
    expect(detectWorkersWithoutMandatoryTraining(snap, NOW)).toEqual([]);
  });
});

describe('detectAllSmartActions', () => {
  it('combinado y ordenado por prioridad', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      workers: [{ id: 'w-1', name: 'P', cargo: 'electricista' }],
      projects: [{ id: 'p-1', name: 'Edificio Las Condes' }],
    };
    const actions = detectAllSmartActions(snap, NOW);
    expect(actions.length).toBeGreaterThan(0);
    // High priority debe venir primero
    expect(actions[0]?.priority).toBe('high');
  });

  it('vacío snapshot → 0 acciones', () => {
    expect(detectAllSmartActions(emptySnapshot, NOW)).toEqual([]);
  });
});

describe('determinismo', () => {
  it('mismo snapshot → mismas sugerencias', () => {
    const snap: KnowledgeGraphSnapshot = {
      ...emptySnapshot,
      workers: [{ id: 'w-1', name: 'P', cargo: 'operario_construccion' }],
    };
    const a = detectAllSmartActions(snap, NOW);
    const b = detectAllSmartActions(snap, NOW);
    expect(a).toEqual(b);
  });
});

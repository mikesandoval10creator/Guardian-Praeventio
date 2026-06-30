// Sprint 28 Bucket B1 — Adaptador Chile.
//
// Mapea controles ISO 45001 a regulación chilena. NO sustituye
// `bcnKnowledgeBase.ts` (ese permanece intacto, ADR 0014); esta capa es
// aditiva y será cableada en Sprint 29.

import type { RegulationRef } from '../types.js';

const BCN = 'https://www.bcn.cl';

/**
 * Mapeo controlId → referencias chilenas. Si un control ISO no tiene
 * mapeo aquí, el registry cae al baseline ISO 45001.
 */
export const CL_REFERENCES: Record<string, RegulationRef[]> = {
  WORKER_PARTICIPATION: [
    {
      code: 'DS-44',
      title: 'DS 44/2024 (ex DS 54, derogado 01-02-2025) — Comité Paritario de Higiene y Seguridad',
      jurisdiction: 'CL',
      url: `${BCN}/leychile/navegar?idNorma=1217760`,
      scope: 'CPHS obligatorio en faenas con 25+ trabajadores; participación bipartita',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'Ley-16.744',
      title: 'Ley 16.744 — Seguro contra accidentes y enfermedades profesionales',
      jurisdiction: 'CL',
      url: `${BCN}/leychile/navegar?idNorma=28650`,
      scope: 'Obligación del empleador de prevenir riesgos profesionales',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'DS-594',
      title: 'DS 594 — Reglamento sobre condiciones sanitarias y ambientales en lugares de trabajo',
      jurisdiction: 'CL',
      url: `${BCN}/leychile/navegar?idNorma=167766`,
      scope: 'Límites permisibles, ventilación, iluminación, PPE, ergonomía',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: 'DS-132',
      title: 'DS 132 — Reglamento de seguridad minera (incluye plan emergencia sísmica)',
      jurisdiction: 'CL',
      url: `${BCN}/leychile/navegar?idNorma=232466`,
      scope: 'Plan de emergencia y simulacros (referencia transversal sismo Chile)',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'DS-109',
      title: 'DS 109 — Calificación y evaluación de accidentes y enfermedades profesionales',
      jurisdiction: 'CL',
      url: `${BCN}/leychile/navegar?idNorma=9391`,
      scope: 'Calificación formal de accidente/enfermedad profesional por COMPIN',
    },
  ],
};

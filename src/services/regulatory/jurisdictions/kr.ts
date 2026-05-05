// Sprint 31 Bucket NN — Adaptador Corea del Sur (MOEL).
//
// Occupational Safety and Health Act (산업안전보건법, OSHA-K) reformada
// en 2020 es el statute primario. El Enforcement Decree y el
// Enforcement Regulation desarrollan detalle. KOSHA-MS es el sistema de
// gestión SST de la Korea Occupational Safety and Health Agency. La
// Serious Accidents Punishment Act (중대재해처벌법) entró en vigor en
// enero 2022 y eleva la responsabilidad penal de empleadores y CEOs en
// accidentes graves.

import type { RegulationRef } from '../types.js';

const MOEL = 'https://www.moel.go.kr/english';
const KOSHA = 'https://www.kosha.or.kr/english';

export const KR_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'OSHA-K-2019',
      title: 'Occupational Safety and Health Act (산업안전보건법) art.5 — Employer duty',
      jurisdiction: 'KR',
      url: `${MOEL}`,
      scope: 'Deber general del empleador de garantizar la seguridad y salud de los trabajadores; MOEL como regulator',
    },
    {
      code: 'SAPA-2022',
      title: 'Serious Accidents Punishment Act (중대재해처벌법) — 2022',
      jurisdiction: 'KR',
      url: `${MOEL}`,
      scope: 'Responsabilidad penal de CEO y representantes legales por accidentes graves (≥1 muerte o ≥2 lesionados graves)',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'OSHA-K-art.24',
      title: 'OSHA-K art.24 — Industrial Safety and Health Committee (산업안전보건위원회)',
      jurisdiction: 'KR',
      url: `${MOEL}`,
      scope: 'Comité paritario obligatorio en sitios sobre umbral de tamaño; consulta sobre planes de prevención',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'OSHA-K-art.36',
      title: 'OSHA-K art.36 — Risk Assessment (위험성 평가)',
      jurisdiction: 'KR',
      url: `${MOEL}`,
      scope: 'Identificación de peligros y evaluación de riesgos obligatoria; documentación y revisión periódica',
    },
  ],
  COMPETENCE_TRAINING: [
    {
      code: 'OSHA-K-art.29',
      title: 'OSHA-K art.29 — Safety and Health Education (안전보건교육)',
      jurisdiction: 'KR',
      url: `${MOEL}`,
      scope: 'Educación obligatoria periódica, al ingreso, al cambio de tareas y específica para trabajos peligrosos',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'OSHA-K-Enforcement-Decree',
      title: 'Enforcement Decree of OSH Act (산업안전보건법 시행령)',
      jurisdiction: 'KR',
      url: `${MOEL}`,
      scope: 'Reglas operacionales: PPE, sustancias químicas peligrosas, trabajos en altura, espacios confinados',
    },
    {
      code: 'KOSHA-MS',
      title: 'KOSHA-MS — Korea OSH Management System (KOSHA Management System)',
      jurisdiction: 'KR',
      url: `${KOSHA}`,
      scope: 'Sistema voluntario de gestión SST certificable; alineado con ISO 45001 + requisitos coreanos',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: 'OSHA-K-art.51',
      title: 'OSHA-K art.51 — Work suspension and emergency response',
      jurisdiction: 'KR',
      url: `${MOEL}`,
      scope: 'Procedimientos de respuesta ante peligros inminentes; derecho a interrumpir trabajo en caso de riesgo grave',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'OSHA-K-art.57',
      title: 'OSHA-K art.57 — Industrial accident reporting',
      jurisdiction: 'KR',
      url: `${MOEL}`,
      scope: 'Reporte obligatorio al MOEL de accidentes laborales con muerte o lesión grave; investigación con KOSHA',
    },
  ],
};

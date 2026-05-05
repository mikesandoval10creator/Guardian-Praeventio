// Sprint 28 Bucket B1 — Catálogo baseline ISO 45001:2018.
//
// 10 controles fundamentales del estándar internacional. Cada control
// tiene un ID simbólico estable que los adaptadores por jurisdicción
// reutilizan para mapear a regulación local.
//
// Fuente: ISO 45001:2018 — Occupational health and safety management
// systems — Requirements with guidance for use.

import type { ComplianceControl, RegulationRef } from './types.js';

const ISO_URL = 'https://www.iso.org/standard/63787.html';

function isoRef(clause: string, scope: string): RegulationRef {
  return {
    code: `ISO-45001:${clause}`,
    title: `ISO 45001:2018 §${clause}`,
    jurisdiction: 'ISO-45001',
    url: ISO_URL,
    scope,
  };
}

/**
 * Catálogo inicial. Orden establecido por la cláusula ISO; no usar
 * orden como API.
 */
export const ISO_45001_CONTROLS: ComplianceControl[] = [
  {
    id: 'LEADERSHIP_COMMITMENT',
    title: 'Liderazgo y compromiso de la alta dirección',
    iso45001Clause: '5.1',
    references: [
      isoRef('5.1', 'Liderazgo y compromiso de la alta dirección con el SST'),
    ],
  },
  {
    id: 'WORKER_PARTICIPATION',
    title: 'Consulta y participación de los trabajadores',
    iso45001Clause: '5.4',
    references: [
      isoRef('5.4', 'Consulta y participación de trabajadores y representantes'),
    ],
  },
  {
    id: 'HAZARD_IDENTIFICATION',
    title: 'Identificación de peligros y evaluación de riesgos',
    iso45001Clause: '6.1.2',
    references: [
      isoRef('6.1.2', 'Identificación de peligros y evaluación de riesgos y oportunidades'),
    ],
  },
  {
    id: 'OHS_OBJECTIVES',
    title: 'Objetivos de SST y planificación para alcanzarlos',
    iso45001Clause: '6.2',
    references: [
      isoRef('6.2', 'Objetivos de SST y planificación para alcanzarlos'),
    ],
  },
  {
    id: 'COMPETENCE_TRAINING',
    title: 'Competencia y formación',
    iso45001Clause: '7.2',
    references: [
      isoRef('7.2', 'Determinar competencia necesaria de trabajadores y asegurar formación'),
    ],
  },
  {
    id: 'COMMUNICATION',
    title: 'Comunicación interna y externa',
    iso45001Clause: '7.4',
    references: [
      isoRef('7.4', 'Comunicaciones internas y externas pertinentes al SST'),
    ],
  },
  {
    id: 'OPERATIONAL_CONTROL',
    title: 'Control operacional (incluye PPE y procedimientos)',
    iso45001Clause: '8.1',
    references: [
      isoRef('8.1', 'Planificación y control operacional para eliminar peligros y reducir riesgos'),
    ],
  },
  {
    id: 'EMERGENCY_PREPAREDNESS',
    title: 'Preparación y respuesta ante emergencias',
    iso45001Clause: '8.2',
    references: [
      isoRef('8.2', 'Procesos para prepararse y responder ante situaciones de emergencia'),
    ],
  },
  {
    id: 'PERFORMANCE_MONITORING',
    title: 'Seguimiento, medición, análisis y evaluación del desempeño',
    iso45001Clause: '9.1',
    references: [
      isoRef('9.1', 'Seguimiento, medición, análisis y evaluación del desempeño SST'),
    ],
  },
  {
    id: 'NONCONFORMITY_CORRECTIVE_ACTION',
    title: 'No conformidades y acción correctiva',
    iso45001Clause: '10.2',
    references: [
      isoRef('10.2', 'Tratamiento de incidentes, no conformidades y acción correctiva'),
    ],
  },
];

/** Index por ID para lookup rápido. */
export const ISO_45001_BY_ID: Record<string, ComplianceControl> = Object.freeze(
  Object.fromEntries(ISO_45001_CONTROLS.map((c) => [c.id, c])),
);

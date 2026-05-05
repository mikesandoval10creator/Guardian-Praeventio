// Sprint 31 Bucket SS — Adaptador Rusia (Rostrud, Роструд).
//
// Trudovoy Kodeks (Trabajo Code, Трудовой кодекс РФ) Capítulo 36
// (Глава 36, статьи 209-225) establece el marco SST primario. Federal
// Law No.426-FZ on Special Assessment of Working Conditions (СОУТ —
// Специальная оценка условий труда) regula la evaluación obligatoria
// de condiciones de trabajo. GOST R 12.0.230 es el estándar nacional
// del sistema de gestión SST. Federal Service for Labour and
// Employment (Rostrud, Роструд) es el regulator nacional.

import type { RegulationRef } from '../types.js';

const ROSTRUD = 'https://rostrud.gov.ru';
const MINTRUD = 'https://mintrud.gov.ru';

export const RU_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'TK-RF-art.212',
      title: 'Labor Code of RF (Трудовой кодекс РФ) art.212 — Employer obligations',
      jurisdiction: 'RU',
      url: `${MINTRUD}`,
      scope: 'Obligaciones del empleador en SST: organización, control y financiamiento; Rostrud como regulator',
    },
    {
      code: 'GOST-R-12.0.230',
      title: 'GOST R 12.0.230 — OSH Management Systems (Система управления охраной труда)',
      jurisdiction: 'RU',
      url: `${MINTRUD}`,
      scope: 'Estándar nacional de sistemas de gestión SST alineado con OHSAS 18001 / ISO 45001',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'TK-RF-art.218',
      title: 'Labor Code art.218 — OSH committees (комитеты по охране труда)',
      jurisdiction: 'RU',
      url: `${MINTRUD}`,
      scope: 'Comités SST paritarios obligatorios cuando lo solicita el sindicato o representantes de trabajadores',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'FZ-426',
      title: 'Federal Law No.426-FZ — Special Assessment of Working Conditions (СОУТ)',
      jurisdiction: 'RU',
      url: `${MINTRUD}`,
      scope: 'Evaluación especial obligatoria de condiciones de trabajo cada 5 años; clasifica peligros y determina compensaciones',
    },
  ],
  COMPETENCE_TRAINING: [
    {
      code: 'TK-RF-art.225',
      title: 'Labor Code art.225 — Training and instruction in OSH (обучение и инструктаж по охране труда)',
      jurisdiction: 'RU',
      url: `${MINTRUD}`,
      scope: 'Formación SST obligatoria al ingreso, periódica y al cambio de tareas; instrucción pre-tarea documentada',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'TK-RF-art.221',
      title: 'Labor Code art.221 — PPE issuance (выдача СИЗ)',
      jurisdiction: 'RU',
      url: `${MINTRUD}`,
      scope: 'Provisión gratuita de equipos de protección individual (СИЗ) certificados según normas tipo',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'TK-RF-art.227',
      title: 'Labor Code art.227-231 — Investigation and reporting of occupational accidents',
      jurisdiction: 'RU',
      url: `${ROSTRUD}`,
      scope: 'Investigación obligatoria de accidentes laborales con comisión paritaria; reporte a Rostrud y Fondo de Seguridad Social',
    },
  ],
};

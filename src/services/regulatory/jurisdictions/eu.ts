// Sprint 28 Bucket B1 — Adaptador EU (Directiva 89/391/CEE marco).

import type { RegulationRef } from '../types.js';

const EUR_LEX = 'https://eur-lex.europa.eu';

export const EU_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: '89/391/EEC',
      title: 'Directiva 89/391/CEE — Marco SST (Framework Directive)',
      jurisdiction: 'EU',
      url: `${EUR_LEX}/legal-content/EN/TXT/?uri=CELEX:31989L0391`,
      scope: 'Obligaciones generales del empleador en SST en toda la UE',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: '89/391/EEC-art.11',
      title: 'Directiva 89/391/CEE art. 11 — Consulta y participación',
      jurisdiction: 'EU',
      url: `${EUR_LEX}/legal-content/EN/TXT/?uri=CELEX:31989L0391`,
      scope: 'Consulta y participación equilibrada de trabajadores en SST',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: '89/391/EEC-art.6',
      title: 'Directiva 89/391/CEE art. 6 — Evaluación de riesgos',
      jurisdiction: 'EU',
      url: `${EUR_LEX}/legal-content/EN/TXT/?uri=CELEX:31989L0391`,
      scope: 'Obligación de evaluar riesgos para la seguridad y salud',
    },
    {
      code: 'REACH',
      title: 'Reglamento (CE) 1907/2006 — REACH',
      jurisdiction: 'EU',
      url: `${EUR_LEX}/legal-content/EN/TXT/?uri=CELEX:32006R1907`,
      scope: 'Registro, evaluación y restricción de sustancias químicas',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: '92/57/EEC',
      title: 'Directiva 92/57/CEE — Obras de construcción temporales o móviles',
      jurisdiction: 'EU',
      url: `${EUR_LEX}/legal-content/EN/TXT/?uri=CELEX:31992L0057`,
      scope: 'Disposiciones mínimas SST en obras de construcción',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: '89/391/EEC-art.8',
      title: 'Directiva 89/391/CEE art. 8 — Primeros auxilios y evacuación',
      jurisdiction: 'EU',
      url: `${EUR_LEX}/legal-content/EN/TXT/?uri=CELEX:31989L0391`,
      scope: 'Medidas de primeros auxilios, lucha contra incendios y evacuación',
    },
  ],
};

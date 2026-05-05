// Sprint 31 Bucket SS — Adaptador Taiwán (Ministry of Labor, 勞動部).
//
// Occupational Safety and Health Act (職業安全衛生法), última reforma
// 2019, es el statute primario. Las Enforcement Rules of OSH Act
// (職業安全衛生法施行細則) desarrollan detalle operacional. El Ministry
// of Labor (勞動部) es el regulator nacional a través de la
// Occupational Safety and Health Administration (OSHA, 職業安全衛生署).
//
// IMPORTANTE: Taiwán es jurisdicción y data residency completamente
// separadas de la PRC. El alias `TW` NO mapea a `CN` bajo ninguna
// circunstancia (ver registry.ts).

import type { RegulationRef } from '../types.js';

const MOL = 'https://www.mol.gov.tw/en';
const OSHA_TW = 'https://www.osha.gov.tw/en';

export const TW_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'OSHA-TW-art.5',
      title: 'Occupational Safety and Health Act (職業安全衛生法) art.5 — Employer duty',
      jurisdiction: 'TW',
      url: `${OSHA_TW}`,
      scope: 'Deber del empleador de proporcionar entorno seguro; Ministry of Labor (勞動部) como regulator nacional',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'OSHA-TW-art.23',
      title: 'OSH Act art.23 — Occupational safety and health committee (職業安全衛生委員會)',
      jurisdiction: 'TW',
      url: `${OSHA_TW}`,
      scope: 'Comité de SST obligatorio en empresas sobre umbral de tamaño; participación paritaria de representantes de trabajadores',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'OSHA-TW-Enforcement-Rules-r.12',
      title: 'Enforcement Rules of OSH Act (職業安全衛生法施行細則) — Risk Assessment',
      jurisdiction: 'TW',
      url: `${OSHA_TW}`,
      scope: 'Identificación de peligros y evaluación de riesgos en lugares de trabajo; documentación periódica',
    },
  ],
  COMPETENCE_TRAINING: [
    {
      code: 'OSHA-TW-art.32',
      title: 'OSH Act art.32 — Safety and health education and training (安全衛生教育及訓練)',
      jurisdiction: 'TW',
      url: `${OSHA_TW}`,
      scope: 'Formación obligatoria al ingreso y periódica; certificación específica para trabajos peligrosos (trabajo en altura, espacios confinados)',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'OSHA-TW-Enforcement-Rules',
      title: 'Enforcement Rules of OSH Act (職業安全衛生法施行細則)',
      jurisdiction: 'TW',
      url: `${OSHA_TW}`,
      scope: 'Reglamento operacional bajo OSH Act: PPE, andamios, sustancias químicas peligrosas, agentes físicos y biológicos',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'OSHA-TW-art.37',
      title: 'OSH Act art.37 — Industrial accident reporting',
      jurisdiction: 'TW',
      url: `${MOL}`,
      scope: 'Reporte obligatorio al Ministry of Labor de accidentes graves (muerte, ≥3 hospitalizados) dentro de 8 horas',
    },
  ],
};

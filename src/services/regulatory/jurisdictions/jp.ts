// Sprint 31 Bucket NN — Adaptador Japón (MHLW).
//
// Mapea controles ISO 45001 a regulación japonesa. La Industrial Safety
// and Health Act (労働安全衛生法, Law No.57 of 1972) es el statute
// primario; la Industrial Safety and Health Regulation Ordinance cubre
// detalle operacional. JIS Z 45001 es la transposición japonesa de
// ISO 45001. El Stress Check Program es obligatorio para empresas con
// más de 50 trabajadores.

import type { RegulationRef } from '../types.js';

const MHLW = 'https://www.mhlw.go.jp/english';
const JISC = 'https://www.jisc.go.jp';

export const JP_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'ISHA-1972',
      title: 'Industrial Safety and Health Act (労働安全衛生法) Law No.57 of 1972 art.3',
      jurisdiction: 'JP',
      url: `${MHLW}/policy/employ-labour/labour-standards/dl/Industrial_Safety_and_Health_Act.pdf`,
      scope: 'Deber del empleador de garantizar SST de los trabajadores; MHLW como regulator nacional',
    },
    {
      code: 'JIS-Z-45001',
      title: 'JIS Z 45001:2018 — Occupational Health and Safety Management Systems',
      jurisdiction: 'JP',
      url: `${JISC}`,
      scope: 'Transposición japonesa de ISO 45001:2018 publicada por JISC',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'ISHA-1972-art.17',
      title: 'ISHA art.17–19 — Comité de Seguridad e Higiene (安全衛生委員会)',
      jurisdiction: 'JP',
      url: `${MHLW}/english/policy/employ-labour/labour-standards/`,
      scope: 'Constitución obligatoria de comité de seguridad e higiene en sitios con ≥50 trabajadores; mitad de miembros designados por trabajadores',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'ISHA-1972-art.28-2',
      title: 'ISHA art.28-2 — Risk Assessment (リスクアセスメント)',
      jurisdiction: 'JP',
      url: `${MHLW}/english/policy/employ-labour/labour-standards/`,
      scope: 'Identificación de peligros y evaluación de riesgos en lugares de trabajo; medidas preventivas según jerarquía de controles',
    },
  ],
  COMPETENCE_TRAINING: [
    {
      code: 'ISHA-1972-art.59',
      title: 'ISHA art.59–60 — Safety and Health Education (安全衛生教育)',
      jurisdiction: 'JP',
      url: `${MHLW}/english/policy/employ-labour/labour-standards/`,
      scope: 'Educación obligatoria al ingreso, al cambio de tareas y para supervisores; cursos especiales para trabajos peligrosos',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'ISH-Reg-Ordinance',
      title: 'Industrial Safety and Health Regulation Ordinance (労働安全衛生規則)',
      jurisdiction: 'JP',
      url: `${MHLW}/english/policy/employ-labour/labour-standards/`,
      scope: 'Reglamento operacional bajo ISHA: PPE, andamios, máquinas, sustancias peligrosas, agentes físicos',
    },
  ],
  PERFORMANCE_MONITORING: [
    {
      code: 'ISHA-1972-art.66-10',
      title: 'ISHA art.66-10 — Stress Check Program (ストレスチェック制度)',
      jurisdiction: 'JP',
      url: `${MHLW}/english/policy/employ-labour/labour-standards/`,
      scope: 'Programa de chequeo de estrés psicosocial obligatorio anual para empresas con >50 trabajadores; seguimiento médico para casos de alto riesgo',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'ISHA-1972-art.100',
      title: 'ISHA art.100 — Reporte de accidentes laborales',
      jurisdiction: 'JP',
      url: `${MHLW}/english/policy/employ-labour/labour-standards/`,
      scope: 'Reporte obligatorio al Labour Standards Inspection Office de muertes, accidentes graves y enfermedades laborales',
    },
  ],
};

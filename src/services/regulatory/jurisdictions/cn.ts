// Sprint 31 Bucket SS — Adaptador China (MEM, 应急管理部).
//
// Work Safety Law of the People's Republic of China (《中华人民共和国安全
// 生产法》) revisada en 2021 es el statute primario del marco SST chino.
// La Law on Prevention and Control of Occupational Diseases (《职业病
// 防治法》) cubre enfermedad profesional. GB/T 33000-2016 es el estándar
// nacional para sistemas de gestión SST. La Special Equipment Safety
// Law (《特种设备安全法》) cubre equipos de presión, ascensores,
// vehículos de transporte de pasajeros y similares. El Ministry of
// Emergency Management (MEM, 应急管理部) es el regulator nacional desde
// 2018.

import type { RegulationRef } from '../types.js';

const MEM = 'https://www.mem.gov.cn';
const NHC = 'http://en.nhc.gov.cn';

export const CN_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'WSL-2021-art.4',
      title: 'Work Safety Law of PRC (《中华人民共和国安全生产法》, 2021 rev.) art.4',
      jurisdiction: 'CN',
      url: `${MEM}`,
      scope: 'Deber del empleador (用人单位) de garantizar la seguridad laboral; MEM como regulator nacional',
    },
    {
      code: 'GB/T-33000-2016',
      title: 'GB/T 33000-2016 — Basic Standard for Enterprise Work Safety Standardization',
      jurisdiction: 'CN',
      url: `${MEM}`,
      scope: 'Estándar nacional de gestión SST: liderazgo, planificación, operación, evaluación y mejora continua',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'WSL-2021-art.55',
      title: 'Work Safety Law art.55 — Trade union and worker safety committee (工会)',
      jurisdiction: 'CN',
      url: `${MEM}`,
      scope: 'Participación de sindicato y trabajadores en supervisión SST; derecho a denunciar y rechazar trabajo inseguro',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'WSL-2021-art.41',
      title: 'Work Safety Law art.41 — Hazard identification and dual-prevention mechanism (双重预防机制)',
      jurisdiction: 'CN',
      url: `${MEM}`,
      scope: 'Identificación de peligros, clasificación y control de riesgos; investigación de peligros ocultos (隐患排查)',
    },
  ],
  COMPETENCE_TRAINING: [
    {
      code: 'WSL-2021-art.28',
      title: 'Work Safety Law art.28 — Safety training (安全生产教育和培训)',
      jurisdiction: 'CN',
      url: `${MEM}`,
      scope: 'Formación obligatoria al ingreso, al cambio de puesto y periódica; certificación específica para operaciones especiales',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'SESL-2013',
      title: 'Special Equipment Safety Law (《特种设备安全法》, 2013)',
      jurisdiction: 'CN',
      url: `${MEM}`,
      scope: 'Régimen específico para equipos especiales: calderas, recipientes a presión, ascensores, grúas, vehículos de transporte de pasajeros',
    },
    {
      code: 'OPDL-2018',
      title: 'Law on Prevention and Control of Occupational Diseases (《职业病防治法》, rev. 2018)',
      jurisdiction: 'CN',
      url: `${NHC}`,
      scope: 'Prevención de enfermedades profesionales: agentes químicos, físicos, biológicos; vigilancia médica obligatoria',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: 'WSL-2021-art.78',
      title: 'Work Safety Law art.78 — Emergency response plan (应急预案)',
      jurisdiction: 'CN',
      url: `${MEM}`,
      scope: 'Plan de emergencia obligatorio, ejercicios periódicos y coordinación con autoridades locales',
    },
  ],
  PERFORMANCE_MONITORING: [
    {
      code: 'OPDL-art.27',
      title: 'OPDL art.27 — Occupational health surveillance (职业健康监护)',
      jurisdiction: 'CN',
      url: `${NHC}`,
      scope: 'Vigilancia médica obligatoria: pre-empleo, periódica y post-empleo para trabajadores expuestos a riesgos',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'WSL-2021-art.83',
      title: 'Work Safety Law art.83 — Accident reporting (生产安全事故报告)',
      jurisdiction: 'CN',
      url: `${MEM}`,
      scope: 'Reporte obligatorio al MEM y autoridades locales de accidentes laborales con muerte o lesión grave dentro de 1 hora',
    },
  ],
};

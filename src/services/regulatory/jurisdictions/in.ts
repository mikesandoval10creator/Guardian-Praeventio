// Sprint 31 Bucket NN — Adaptador India (Ministry of Labour & Employment).
//
// Marco regulatorio en transición: el Factories Act 1948 (con
// Amendment 2014) sigue vigente para muchas plantas; la Occupational
// Safety, Health and Working Conditions Code 2020 (OSH Code)
// consolidará 13 leyes laborales pero su rollout estatal continúa. El
// Building and Other Construction Workers Act 1996 cubre construcción.
// El National Safety Council (NSC) opera bajo el Ministry of Labour
// como cuerpo técnico de promoción y formación.

import type { RegulationRef } from '../types.js';

const LABOUR = 'https://labour.gov.in';
const NSC = 'https://nsc.org.in';

export const IN_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'OSH-Code-2020',
      title: 'Occupational Safety, Health and Working Conditions Code 2020 §6',
      jurisdiction: 'IN',
      url: `${LABOUR}/sites/default/files/OSH_Code_Gazette.pdf`,
      scope: 'Deberes del empleador bajo el OSH Code (consolida Factories Act, Mines Act, Dock Workers Act y otras 10 leyes)',
    },
    {
      code: 'Factories-Act-1948',
      title: 'Factories Act 1948 §7A (Amendment 2014) — General duties of occupier',
      jurisdiction: 'IN',
      url: `${LABOUR}`,
      scope: 'Deberes generales del occupier de garantizar SST de trabajadores en factories registradas',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'Factories-Act-s.41G',
      title: 'Factories Act 1948 §41G — Safety Committee',
      jurisdiction: 'IN',
      url: `${LABOUR}`,
      scope: 'Comité de seguridad obligatorio en factories con procesos peligrosos; representación equitativa empleador/trabajadores',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'Factories-Act-s.41B',
      title: 'Factories Act 1948 §41B — Hazardous processes disclosure & risk',
      jurisdiction: 'IN',
      url: `${LABOUR}`,
      scope: 'Deber de informar y evaluar riesgos en procesos peligrosos; on-site emergency plan obligatorio',
    },
    {
      code: 'NSC-Risk-Guidance',
      title: 'NSC India — Risk Assessment & HIRA Guidance',
      jurisdiction: 'IN',
      url: `${NSC}`,
      scope: 'Guías técnicas del National Safety Council para Hazard Identification and Risk Assessment',
    },
  ],
  COMPETENCE_TRAINING: [
    {
      code: 'OSH-Code-2020-s.18',
      title: 'OSH Code 2020 §18 — Training and instructional materials',
      jurisdiction: 'IN',
      url: `${LABOUR}`,
      scope: 'Capacitación obligatoria de trabajadores en peligros y procedimientos seguros, incluyendo NSC training programmes',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'BOCW-Act-1996',
      title: 'Building and Other Construction Workers (RECS) Act 1996',
      jurisdiction: 'IN',
      url: `${LABOUR}`,
      scope: 'Bienestar y SST en obras de construcción ≥10 trabajadores; PPE, andamios, alturas, demolición',
    },
    {
      code: 'Factories-Act-Ch.IV',
      title: 'Factories Act 1948 Chapter IV — Safety provisions',
      jurisdiction: 'IN',
      url: `${LABOUR}`,
      scope: 'Cercado de maquinaria, izaje, presión, equipos eléctricos y PPE en factories',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: 'Factories-Act-s.41H',
      title: 'Factories Act 1948 §41H — Right of workers to warn about imminent danger',
      jurisdiction: 'IN',
      url: `${LABOUR}`,
      scope: 'Procedimientos de emergencia, on-site/off-site emergency plans para hazardous factories',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'OSH-Code-2020-s.10',
      title: 'OSH Code 2020 §10 — Notice of accidents and dangerous occurrences',
      jurisdiction: 'IN',
      url: `${LABOUR}`,
      scope: 'Notificación obligatoria al Inspector-cum-Facilitator de accidentes, enfermedades laborales y dangerous occurrences',
    },
  ],
};

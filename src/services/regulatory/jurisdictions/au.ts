// Sprint 29 Bucket EE — Adaptador Australia (modelo armonizado WHS).
//
// El Model WHS Act 2011 fue adoptado por la mayoría de los estados y
// territorios con variaciones menores; Victoria conserva su propio OHS
// Act 2004. Safe Work Australia publica codes of practice nacionales.

import type { RegulationRef } from '../types.js';

const SWA = 'https://www.safeworkaustralia.gov.au';

export const AU_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'WHS-Act-2011',
      title: 'Work Health and Safety Act 2011 §19 (model law)',
      jurisdiction: 'AU',
      url: `${SWA}/law-and-regulation/model-whs-laws/model-whs-act`,
      scope: 'Primary duty of care de la PCBU (Person Conducting a Business or Undertaking). Ver también Victoria OHS Act 2004 y NSW WHS Act 2011.',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'WHS-Act-2011-Part-5',
      title: 'WHS Act 2011 Part 5 — Consultation, Representation and Participation',
      jurisdiction: 'AU',
      url: `${SWA}/law-and-regulation/model-whs-laws/model-whs-act`,
      scope: 'Consulta con trabajadores, HSR (Health and Safety Representative) y comités',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'WHS-Reg-2011-r.34',
      title: 'WHS Regulations 2011 reg.34 — Duty to identify hazards',
      jurisdiction: 'AU',
      url: `${SWA}/law-and-regulation/model-whs-laws/model-whs-regulations`,
      scope: 'Identificar peligros razonablemente previsibles y aplicar jerarquía de controles',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'COP-Hazardous-Manual-Tasks',
      title: 'Code of Practice — Hazardous Manual Tasks (Safe Work Australia)',
      jurisdiction: 'AU',
      url: `${SWA}/doc/model-code-practice-hazardous-manual-tasks`,
      scope: 'Buenas prácticas para diseño de tareas, manipulación manual y PPE',
    },
    {
      code: 'WHS-Reg-2011-Part-3.2',
      title: 'WHS Regulations 2011 Part 3.2 — General workplace management',
      jurisdiction: 'AU',
      url: `${SWA}/law-and-regulation/model-whs-laws/model-whs-regulations`,
      scope: 'Servicios e instalaciones, PPE, primeros auxilios y procedimientos de emergencia',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: 'WHS-Reg-2011-r.43',
      title: 'WHS Regulations 2011 reg.43 — Emergency plans',
      jurisdiction: 'AU',
      url: `${SWA}/law-and-regulation/model-whs-laws/model-whs-regulations`,
      scope: 'Plan de emergencia documentado, mantenido y comunicado a todos los trabajadores',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'WHS-Act-2011-Part-3',
      title: 'WHS Act 2011 Part 3 — Incident notification (notifiable incidents)',
      jurisdiction: 'AU',
      url: `${SWA}/law-and-regulation/model-whs-laws/model-whs-act`,
      scope: 'Notificación inmediata al regulator (e.g. SafeWork NSW) de muerte, lesión grave o dangerous incident',
    },
  ],
};

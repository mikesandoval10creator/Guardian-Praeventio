// Sprint 28 Bucket B1 — Adaptador US OSHA (29 CFR 1910).

import type { RegulationRef } from '../types.js';

const OSHA = 'https://www.osha.gov';

export const US_OSHA_REFERENCES: Record<string, RegulationRef[]> = {
  WORKER_PARTICIPATION: [
    {
      code: 'OSHA-1903.7',
      title: '29 CFR 1903.7 — Employee representative during inspection',
      jurisdiction: 'US-OSHA',
      url: `${OSHA}/laws-regs/regulations/standardnumber/1903/1903.7`,
      scope: 'Derecho del trabajador a tener representante en inspecciones',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'OSHA-1910.1200',
      title: '29 CFR 1910.1200 — Hazard Communication (HazCom)',
      jurisdiction: 'US-OSHA',
      url: `${OSHA}/laws-regs/regulations/standardnumber/1910/1910.1200`,
      scope: 'Comunicación de peligros químicos, SDS, etiquetado GHS',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'OSHA-1910.132',
      title: '29 CFR 1910.132 — Personal Protective Equipment (general requirements)',
      jurisdiction: 'US-OSHA',
      url: `${OSHA}/laws-regs/regulations/standardnumber/1910/1910.132`,
      scope: 'Requisitos generales de PPE Subpart I',
    },
    {
      code: 'OSHA-1910.95',
      title: '29 CFR 1910.95 — Occupational noise exposure',
      jurisdiction: 'US-OSHA',
      url: `${OSHA}/laws-regs/regulations/standardnumber/1910/1910.95`,
      scope: 'Programa de conservación auditiva, audiometrías, PEL 90 dBA',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: 'OSHA-1910.38',
      title: '29 CFR 1910.38 — Emergency action plans',
      jurisdiction: 'US-OSHA',
      url: `${OSHA}/laws-regs/regulations/standardnumber/1910/1910.38`,
      scope: 'Plan de acción de emergencia, evacuación, simulacros',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'OSHA-1904',
      title: '29 CFR 1904 — Recording and reporting occupational injuries (Form 300)',
      jurisdiction: 'US-OSHA',
      url: `${OSHA}/recordkeeping`,
      scope: 'Registro OSHA 300 logs, reporte de lesiones recordables',
    },
  ],
};

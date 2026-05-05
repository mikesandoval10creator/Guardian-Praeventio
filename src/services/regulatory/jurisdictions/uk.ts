// Sprint 29 Bucket EE — Adaptador UK (Health and Safety Executive).
//
// Mapea controles ISO 45001 a regulación británica. HSWA 1974 actúa
// como statute primario; las regulations específicas (MHSWR, PPE,
// RIDDOR, COSHH, CDM) cubren los controles operacionales.

import type { RegulationRef } from '../types.js';

const HSE = 'https://www.hse.gov.uk';
const LEG = 'https://www.legislation.gov.uk';

export const UK_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'HSWA-1974',
      title: 'Health and Safety at Work etc. Act 1974 §2',
      jurisdiction: 'UK',
      url: `${LEG}/ukpga/1974/37/section/2`,
      scope: 'Deber general del empleador de garantizar SST de los trabajadores (HSE como regulator)',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'SRSCR-1977',
      title: 'Safety Representatives and Safety Committees Regulations 1977',
      jurisdiction: 'UK',
      url: `${LEG}/uksi/1977/500/contents/made`,
      scope: 'Designación de representantes de seguridad por sindicatos reconocidos',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'MHSWR-1999',
      title: 'Management of Health and Safety at Work Regulations 1999 reg.3',
      jurisdiction: 'UK',
      url: `${LEG}/uksi/1999/3242/regulation/3/made`,
      scope: 'Evaluación de riesgos obligatoria para empleadores con ≥5 trabajadores',
    },
    {
      code: 'COSHH-2002',
      title: 'Control of Substances Hazardous to Health Regulations 2002',
      jurisdiction: 'UK',
      url: `${HSE}/coshh/`,
      scope: 'Control de exposición a sustancias químicas, biológicas y polvos peligrosos',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'PPER-2022',
      title: 'Personal Protective Equipment at Work (Amendment) Regulations 2022',
      jurisdiction: 'UK',
      url: `${HSE}/ppe/ppe-regulations-2022.htm`,
      scope: 'Provisión y uso de PPE para workers + limb (b) workers (gig economy)',
    },
    {
      code: 'CDM-2015',
      title: 'Construction (Design and Management) Regulations 2015',
      jurisdiction: 'UK',
      url: `${HSE}/construction/cdm/2015/`,
      scope: 'Gestión SST en obras de construcción (cliente, principal designer, principal contractor)',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: 'MHSWR-1999-reg.8',
      title: 'Management of Health and Safety at Work Regulations 1999 reg.8',
      jurisdiction: 'UK',
      url: `${LEG}/uksi/1999/3242/regulation/8/made`,
      scope: 'Procedimientos para serious and imminent danger; first aid; contacto con servicios externos',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'RIDDOR-2013',
      title: 'Reporting of Injuries, Diseases and Dangerous Occurrences Regulations 2013',
      jurisdiction: 'UK',
      url: `${HSE}/riddor/`,
      scope: 'Reporte obligatorio a HSE de accidentes, enfermedades laborales y near-misses específicos',
    },
  ],
};

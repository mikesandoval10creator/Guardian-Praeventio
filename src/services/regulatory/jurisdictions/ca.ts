// Sprint 29 Bucket EE — Adaptador Canadá (federal + provincial mention).
//
// CCOHS publica guidance pero la regulación primaria es el Canada Labour
// Code Part II + COHSR para empleadores federales; provincias como
// Ontario (OHSA) y Quebec (LSST) regulan el resto. WHMIS 2015 unifica
// hazcom alineado a GHS. CSA Z1000 es el estándar voluntario OH&S MS.

import type { RegulationRef } from '../types.js';

const CCOHS = 'https://www.ccohs.ca';
const LAWS = 'https://laws-lois.justice.gc.ca';

export const CA_REFERENCES: Record<string, RegulationRef[]> = {
  LEADERSHIP_COMMITMENT: [
    {
      code: 'CLC-Part-II',
      title: 'Canada Labour Code Part II §124',
      jurisdiction: 'CA',
      url: `${LAWS}/eng/acts/L-2/`,
      scope: 'Deber general del empleador (federal); CCOHS publica guidance national',
    },
    {
      code: 'CSA-Z1000',
      title: 'CSA Z1000 — Occupational Health and Safety Management',
      jurisdiction: 'CA',
      url: 'https://www.csagroup.org/store/product/CSA%20Z1000-14/',
      scope: 'Estándar voluntario CSA para sistemas de gestión SST (alineado ISO 45001)',
    },
  ],
  WORKER_PARTICIPATION: [
    {
      code: 'COHSR-Part-XX',
      title: 'Canada Occupational Health and Safety Regulations Part XX',
      jurisdiction: 'CA',
      url: `${LAWS}/eng/regulations/sor-86-304/`,
      scope: 'Comités SST y representantes obligatorios en lugares federales (≥20 trabajadores)',
    },
    {
      code: 'ON-OHSA-s.9',
      title: 'Ontario Occupational Health and Safety Act §9 (JHSC)',
      jurisdiction: 'CA',
      url: 'https://www.ontario.ca/laws/statute/90o01',
      scope: 'Joint Health and Safety Committee provincial Ontario (≥20 trabajadores). Ver también Quebec LSST.',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'WHMIS-2015',
      title: 'Workplace Hazardous Materials Information System 2015 (HPR)',
      jurisdiction: 'CA',
      url: `${CCOHS}/oshanswers/chemicals/whmis_ghs/`,
      scope: 'Comunicación de peligros químicos alineada a GHS (SDS, etiquetas, capacitación)',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'COHSR-Part-XII',
      title: 'COHSR Part XII — Safety Materials, Equipment, Devices and Clothing',
      jurisdiction: 'CA',
      url: `${LAWS}/eng/regulations/sor-86-304/`,
      scope: 'Provisión y uso de PPE en empleadores de jurisdicción federal',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: 'COHSR-Part-XVII',
      title: 'COHSR Part XVII — Safe Occupancy of the Work Place',
      jurisdiction: 'CA',
      url: `${LAWS}/eng/regulations/sor-86-304/`,
      scope: 'Planes de emergencia, evacuación y simulacros en lugares de trabajo federales',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'CLC-s.125-c',
      title: 'Canada Labour Code §125(1)(c) — Hazardous occurrence reporting',
      jurisdiction: 'CA',
      url: `${LAWS}/eng/acts/L-2/`,
      scope: 'Investigación, registro y reporte de hazardous occurrences a Labour Program',
    },
  ],
};

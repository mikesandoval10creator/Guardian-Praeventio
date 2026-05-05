// Sprint 28 Bucket B1 — Adaptador México (NOM-STPS).

import type { RegulationRef } from '../types.js';

const STPS = 'https://www.stps.gob.mx';

export const MX_REFERENCES: Record<string, RegulationRef[]> = {
  WORKER_PARTICIPATION: [
    {
      code: 'NOM-019-STPS',
      title: 'NOM-019-STPS-2011 — Comisiones de Seguridad e Higiene',
      jurisdiction: 'MX',
      url: `${STPS}/bp/secciones/dgsst/normatividad/normas/Nom-019.pdf`,
      scope: 'Constitución, integración y funcionamiento de las CSH en centros de trabajo',
    },
  ],
  HAZARD_IDENTIFICATION: [
    {
      code: 'NOM-035-STPS',
      title: 'NOM-035-STPS-2018 — Factores de riesgo psicosocial',
      jurisdiction: 'MX',
      url: `${STPS}`,
      scope: 'Identificación, análisis y prevención de riesgos psicosociales',
    },
  ],
  OPERATIONAL_CONTROL: [
    {
      code: 'NOM-017-STPS',
      title: 'NOM-017-STPS-2008 — Equipo de protección personal (PPE)',
      jurisdiction: 'MX',
      url: `${STPS}`,
      scope: 'Selección, uso y manejo de PPE en los centros de trabajo',
    },
  ],
  EMERGENCY_PREPAREDNESS: [
    {
      code: 'NOM-002-STPS',
      title: 'NOM-002-STPS-2010 — Prevención y protección contra incendios',
      jurisdiction: 'MX',
      url: `${STPS}`,
      scope: 'Condiciones de prevención y protección contra incendios en centros de trabajo',
    },
  ],
  NONCONFORMITY_CORRECTIVE_ACTION: [
    {
      code: 'NOM-021-STPS',
      title: 'NOM-021-STPS-1993 — Informes sobre riesgos de trabajo',
      jurisdiction: 'MX',
      url: `${STPS}`,
      scope: 'Reporte de accidentes y enfermedades de trabajo a la STPS',
    },
  ],
};

/**
 * Perú — paquete normativo de Seguridad y Salud en el Trabajo (SST).
 *
 * Marco legal principal:
 *  - Ley N° 29783 (2011) — Ley de Seguridad y Salud en el Trabajo.
 *  - DS N° 005-2012-TR — Reglamento de la Ley 29783.
 *      Comité de SST obligatorio con ≥ 20 trabajadores; supervisor de SST si < 20.
 *  - Ley N° 30222 (2014) — Modificatoria de la Ley 29783.
 *  - RM N° 050-2013-TR — Formatos referenciales (matriz IPERC, RISST, etc.).
 *  - DS N° 024-2016-EM — Reglamento de SST minera (sector específico).
 *  - RM N° 375-2008-TR — Norma básica de Ergonomía y Procedimientos de Evaluación de Riesgo Disergonómico.
 */
import type { CountryPack } from '../../services/normativa/countryPacks';

export const PE_PACK: CountryPack = {
  code: 'PE',
  name: 'Perú',
  flag: '🇵🇪',
  language: 'es-PE',
  iso45001Compatibility: 'high',
  notes:
    'Marco SST peruano basado en la Ley 29783 y su reglamento DS 005-2012-TR. Compatible con ISO 45001.',
  thresholds: {
    /** VERIFY: DS 005-2012-TR Art. 43 establece Comité con ≥ 20 trabajadores; con < 20 se designa Supervisor de SST. */
    comiteRequiredAtWorkers: 20,
    /**
     * VERIFY: el reglamento no fija un umbral único nacional de "Departamento" de prevención;
     * se exige Servicio de SST en empresas de mayor riesgo y/o > 100 trabajadores
     * (alineado con la práctica de Sunafil para el Servicio de Seguridad y Salud en el Trabajo).
     */
    preventionDeptRequiredAtWorkers: 100,
    monthlyMeetingsRequired: true,
  },
  regulations: [
    {
      id: 'pe-ley-29783',
      title: 'Ley 29783 — Ley de Seguridad y Salud en el Trabajo',
      reference: 'Ley N° 29783 (2011), MTPE',
      scope:
        'Marco general de SST: principios, deberes del empleador, derechos del trabajador, sistema de gestión, responsabilidad penal por incumplimientos.',
      url: 'https://www.gob.pe/institucion/mtpe/normas-legales/385798-29783',
    },
    {
      id: 'pe-ds-005-2012-tr',
      title: 'DS 005-2012-TR — Reglamento de la Ley 29783',
      reference: 'Decreto Supremo N° 005-2012-TR. Art. 43 (Comité), Art. 32 (RISST)',
      scope:
        'Comité de SST obligatorio con ≥ 20 trabajadores; supervisor en empresas con < 20. Reglamento Interno de SST (RISST) obligatorio con ≥ 20 trabajadores.',
      url: 'https://www.gob.pe/institucion/mtpe/normas-legales/394228-005-2012-tr',
    },
    {
      id: 'pe-ley-30222',
      title: 'Ley 30222 — Modifica la Ley 29783',
      reference: 'Ley N° 30222 (2014), MTPE',
      scope:
        'Flexibiliza la responsabilidad penal del empleador y adecua exámenes médicos ocupacionales.',
      url: 'https://www.gob.pe/institucion/mtpe/normas-legales/385799-30222',
    },
    {
      id: 'pe-rm-050-2013-tr',
      title: 'RM 050-2013-TR — Formatos referenciales SST',
      reference: 'Resolución Ministerial N° 050-2013-TR',
      scope:
        'Aprueba formatos referenciales para registros obligatorios del SGSST: matriz IPERC, registro de incidentes, accidentes, EMO, capacitaciones.',
      url: 'https://www.gob.pe/institucion/mtpe/normas-legales/231414-050-2013-tr',
    },
    {
      id: 'pe-rm-375-2008-tr',
      title: 'RM 375-2008-TR — Norma Básica de Ergonomía',
      reference: 'Resolución Ministerial N° 375-2008-TR',
      scope:
        'Procedimientos de evaluación de riesgo disergonómico, manejo manual de cargas y posturas de trabajo.',
      url: 'https://www.gob.pe/institucion/mtpe/normas-legales/231518-375-2008-tr',
    },
    {
      id: 'pe-ds-024-2016-em',
      title: 'DS 024-2016-EM — Reglamento de SST Minera',
      reference: 'Decreto Supremo N° 024-2016-EM (modif. DS 023-2017-EM)',
      scope:
        'Reglamento sectorial de SST en actividad minera: gestión de riesgos críticos, IPERC, ATS, vigilancia médica.',
      url: 'https://www.gob.pe/institucion/minem/normas-legales/295726-024-2016-em',
    },
    {
      id: 'pe-rm-312-2011-minsa',
      title: 'RM 312-2011/MINSA — Protocolos de Exámenes Médico-Ocupacionales',
      reference: 'Resolución Ministerial N° 312-2011/MINSA (modif. RM 571-2014/MINSA)',
      scope:
        'Aprueba el documento técnico "Protocolos de Exámenes Médico-Ocupacionales y Guías de Diagnóstico de los Exámenes Médicos Obligatorios por Actividad".',
      url: 'https://www.gob.pe/institucion/minsa/normas-legales/247548-312-2011-minsa',
    },
  ],
};

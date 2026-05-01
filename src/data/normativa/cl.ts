/**
 * Chile — paquete normativo de Seguridad y Salud en el Trabajo (SST).
 *
 * Fuentes (verificadas contra BCN — Biblioteca del Congreso Nacional):
 *  - Ley 16.744 (1968) — Seguro Social contra Accidentes y Enfermedades Profesionales.
 *  - DS 40 (1969) — Reglamento sobre Prevención de Riesgos Profesionales.
 *      Art. 8: Departamento de Prevención obligatorio si > 100 trabajadores.
 *  - DS 54 (1969) — Reglamento sobre Comités Paritarios de Higiene y Seguridad.
 *      Art. 1: Comité Paritario obligatorio en faenas con > 25 trabajadores.
 *  - DS 594 (1999) — Condiciones Sanitarias y Ambientales Básicas en lugares de trabajo.
 *  - Ley 20.123 (2007) — Subcontratación; SGSST cuando ≥ 50 trabajadores en faena conjunta.
 *  - Ley 20.001 (2005) y DS 63 (2005) — Regulación del peso máximo de carga humana.
 *  - Ley 21.012 (2017) — Garantiza la seguridad de los trabajadores en situaciones de riesgo.
 *  - Ley 21.643 (2024) — "Ley Karin" — acoso laboral y sexual; protocolos obligatorios.
 *  - DS 109 (1968) — Calificación y evaluación de accidentes del trabajo y EP.
 *  - Circular 3.241 SUSESO — Protocolo de Vigilancia de Riesgos Psicosociales (CEAL-SM/SUSESO).
 *
 * Referencias cruzadas en el repo: src/data/bcnKnowledgeBase.ts (resúmenes textuales),
 * src/services/comiteBackend.ts, src/services/susesoBackend.ts.
 */
import type { CountryPack } from '../../services/normativa/countryPacks';

export const CL_PACK: CountryPack = {
  code: 'CL',
  name: 'Chile',
  flag: '🇨🇱',
  language: 'es-CL',
  iso45001Compatibility: 'high',
  notes:
    'Marco SST chileno consolidado: Ley 16.744 + DS 40/54/594. Compatible con ISO 45001 vía SGSST.',
  thresholds: {
    comiteRequiredAtWorkers: 25,
    preventionDeptRequiredAtWorkers: 100,
    monthlyMeetingsRequired: true,
  },
  regulations: [
    {
      id: 'cl-ley-16744',
      title: 'Ley 16.744 — Seguro Social contra Accidentes y Enfermedades Profesionales',
      reference: 'Ley N° 16.744 (1968), Ministerio del Trabajo y Previsión Social',
      scope:
        'Seguro obligatorio; cobertura de accidentes del trabajo, de trayecto y enfermedades profesionales. Obligaciones del empleador en materia de prevención.',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=28650',
    },
    {
      id: 'cl-ds-40',
      title: 'DS 40 — Reglamento sobre Prevención de Riesgos Profesionales',
      reference: 'Decreto Supremo N° 40 (1969), MINTRAB. Art. 8 (Dpto. Prevención)',
      scope:
        'Departamento de Prevención de Riesgos obligatorio en empresas con más de 100 trabajadores. Obligación de informar (ODI) y Reglamento Interno de Higiene y Seguridad.',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=1041130',
    },
    {
      id: 'cl-ds-54',
      title: 'DS 54 — Reglamento de Comités Paritarios de Higiene y Seguridad',
      reference: 'Decreto Supremo N° 54 (1969), MINTRAB. Art. 1',
      scope:
        'Comité Paritario obligatorio en toda empresa, faena, sucursal o agencia con más de 25 trabajadores. 3 representantes del empleador + 3 de los trabajadores; reuniones mensuales.',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=9924',
    },
    {
      id: 'cl-ds-594',
      title: 'DS 594 — Condiciones Sanitarias y Ambientales Básicas',
      reference: 'Decreto Supremo N° 594 (1999), MINSAL',
      scope:
        'Agua potable, servicios higiénicos, ventilación, iluminación, ruido, carga térmica, EPP y límites permisibles ponderados/temporales.',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=167766',
    },
    {
      id: 'cl-ley-20123',
      title: 'Ley 20.123 — Subcontratación y Servicios Transitorios',
      reference: 'Ley N° 20.123 (2007), MINTRAB',
      scope:
        'Responsabilidad solidaria/subsidiaria de la empresa principal. SGSST obligatorio cuando ≥ 50 trabajadores propios y subcontratados en faena conjunta.',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=263954',
    },
    {
      id: 'cl-ley-20001',
      title: 'Ley 20.001 — Manejo Manual de Carga',
      reference: 'Ley N° 20.001 (2005) + DS 63 (2005), MINTRAB',
      scope:
        'Peso máximo de carga humana: 25 kg para hombres, 20 kg para mujeres y menores. Prohibición de operaciones de carga superiores a 50 kg.',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=235279',
    },
    {
      id: 'cl-ley-21643',
      title: 'Ley 21.643 — "Ley Karin" — Prevención del Acoso Laboral y Sexual',
      reference: 'Ley N° 21.643 (2024), MINTRAB',
      scope:
        'Modifica el Código del Trabajo en materia de prevención e investigación del acoso laboral, sexual y violencia en el trabajo. Protocolos obligatorios desde agosto 2024.',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=1199520',
    },
    {
      id: 'cl-ley-21012',
      title: 'Ley 21.012 — Seguridad en Situaciones de Riesgo y Emergencia',
      reference: 'Ley N° 21.012 (2017), MINTRAB',
      scope:
        'Obligación del empleador de informar y suspender labores ante riesgo grave e inminente; derecho a no ser sancionado por interrumpir labores en tales casos.',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=1104210',
    },
    {
      id: 'cl-ds-109',
      title: 'DS 109 — Calificación de Accidentes del Trabajo y EP',
      reference: 'Decreto Supremo N° 109 (1968), MINTRAB',
      scope:
        'Reglamento para la calificación y evaluación de accidentes del trabajo y enfermedades profesionales (uso de mutualidades).',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=8965',
    },
    {
      id: 'cl-suseso-3241',
      title: 'Circular 3.241 SUSESO — Protocolo de Vigilancia de Riesgos Psicosociales',
      reference: 'Circular SUSESO N° 3.241 (2016, actualizada). Instrumento CEAL-SM/SUSESO',
      scope:
        'Aplicación obligatoria del Cuestionario CEAL-SM/SUSESO para vigilancia de factores de riesgo psicosocial laboral. Reemplaza progresivamente al ISTAS-21.',
      url: 'https://www.suseso.cl/606/w3-propertyvalue-136928.html',
    },
    {
      id: 'cl-ds-101',
      title: 'DS 101 — Procedimientos en Caso de Accidentes y EP',
      reference: 'Decreto Supremo N° 101 (1968), MINTRAB',
      scope:
        'Reglamenta los procedimientos administrativos para la denuncia y reconocimiento de accidentes del trabajo y enfermedades profesionales.',
      url: 'https://www.bcn.cl/leychile/navegar?idNorma=9231',
    },
    {
      id: 'cl-protocolo-mineduc',
      title: 'Protocolo PREXOR — Vigilancia de Trabajadores Expuestos a Ruido',
      reference: 'MINSAL, Protocolo PREXOR',
      scope:
        'Vigilancia ambiental y de la salud auditiva en trabajadores con exposición ocupacional a ruido. Audiometrías periódicas obligatorias.',
      url: 'https://diprece.minsal.cl/le-informamos/auge/acceso-guias-clinicas/protocolos/protocolo-prexor/',
    },
  ],
};

/**
 * Colombia — paquete normativo del Sistema de Gestión de Seguridad y Salud en el Trabajo (SG-SST).
 *
 * Marco legal principal:
 *  - Ley 1562 de 2012 — Sistema General de Riesgos Laborales.
 *  - Decreto 1072 de 2015 (DUR Trabajo) — Libro 2, Parte 2, Título 4, Cap. 6: SG-SST.
 *  - Resolución 0312 de 2019 — Estándares mínimos del SG-SST (escalonado por tamaño).
 *  - Resolución 2646 de 2008 — Factores de riesgo psicosocial.
 *  - Resolución 1409 de 2012 — Trabajo seguro en alturas.
 *  - Resolución 0773 de 2021 — Aplicación SGA / etiquetado químicos.
 *  - Decreto 1295 de 1994 — Organización del Sistema General de Riesgos Profesionales.
 */
import type { CountryPack } from '../../services/normativa/countryPacks';

export const CO_PACK: CountryPack = {
  code: 'CO',
  name: 'Colombia',
  flag: '🇨🇴',
  language: 'es-CO',
  iso45001Compatibility: 'high',
  notes:
    'SG-SST colombiano (Decreto 1072/2015 + Resolución 0312/2019). Estándares mínimos escalonados por tamaño de empresa.',
  thresholds: {
    /**
     * Resolución 2013 de 1986 / Decreto 1072 art. 2.2.4.6.10:
     * COPASST con ≥ 10 trabajadores; con < 10 se designa Vigía de SST.
     * Aquí registramos el umbral del comité formal (10).
     */
    comiteRequiredAtWorkers: 10,
    /**
     * VERIFY: la Resolución 0312/2019 escala los estándares: 7 estándares < 10 trab.,
     * 21 estándares 11-50 trab., 60 estándares > 50 trab. No se exige un "departamento"
     * formal por número, pero a partir de 10 trabajadores se requiere responsable de SG-SST
     * con licencia. Usamos 50 como umbral de "estructura SST robusta".
     */
    preventionDeptRequiredAtWorkers: 50,
    monthlyMeetingsRequired: true,
  },
  regulations: [
    {
      id: 'co-decreto-1072',
      title: 'Decreto 1072/2015 — Decreto Único Reglamentario del Sector Trabajo',
      reference: 'Decreto 1072 de 2015, Libro 2 Parte 2 Título 4 Capítulo 6 (SG-SST)',
      scope:
        'Reglamenta el Sistema de Gestión de SST: política, planificación, aplicación, evaluación, auditoría y mejora continua (PHVA).',
      url: 'https://www.mintrabajo.gov.co/normatividad/decreto-unico-reglamentario',
    },
    {
      id: 'co-resolucion-0312-2019',
      title: 'Resolución 0312/2019 — Estándares Mínimos del SG-SST',
      reference: 'Resolución 0312 de 2019, MinTrabajo',
      scope:
        'Define estándares mínimos escalonados por tamaño y nivel de riesgo: 7 estándares (< 10 trab.), 21 (11-50), 60 (> 50).',
      url: 'https://www.mintrabajo.gov.co/documents/20147/59995826/Resolucion+No.+0312-2019-+Estandares+minimos+del+Sistema+de+la+Seguridad+y+Salud.pdf',
    },
    {
      id: 'co-ley-1562-2012',
      title: 'Ley 1562/2012 — Sistema General de Riesgos Laborales',
      reference: 'Ley 1562 de 2012',
      scope:
        'Modifica el Sistema General de Riesgos Profesionales y dicta otras disposiciones en materia de salud ocupacional.',
      url: 'https://www.minsalud.gov.co/Normatividad_Nuevo/Ley%201562%20de%202012.pdf',
    },
    {
      id: 'co-resolucion-2013-1986',
      title: 'Resolución 2013/1986 — COPASST',
      reference: 'Resolución 2013 de 1986, MinTrabajo y MinSalud',
      scope:
        'Reglamenta la organización y funcionamiento del Comité Paritario de SST (COPASST). Composición escalonada según número de trabajadores.',
      url: 'https://www.mintrabajo.gov.co/documents/20147/45107/resolucion_00002013_de_1986.pdf',
    },
    {
      id: 'co-resolucion-2646-2008',
      title: 'Resolución 2646/2008 — Factores de Riesgo Psicosocial',
      reference: 'Resolución 2646 de 2008, MinProtección Social',
      scope:
        'Identificación, evaluación, prevención, intervención y monitoreo permanente de la exposición a factores de riesgo psicosocial.',
      url: 'https://www.mintrabajo.gov.co/documents/20147/36482/resolucion_00002646_de_2008.pdf',
    },
    {
      id: 'co-resolucion-1409-2012',
      title: 'Resolución 1409/2012 — Reglamento de Seguridad para Trabajo en Alturas',
      reference: 'Resolución 1409 de 2012, MinTrabajo',
      scope:
        'Establece el reglamento de seguridad para protección contra caídas en trabajo en alturas (≥ 1.5 m).',
      url: 'https://www.mintrabajo.gov.co/documents/20147/45107/resolucion_1409_de_2012.pdf',
    },
    {
      id: 'co-decreto-1295-1994',
      title: 'Decreto-Ley 1295/1994 — Organización del SGRP',
      reference: 'Decreto 1295 de 1994',
      scope:
        'Organización y administración del Sistema General de Riesgos Profesionales (hoy Riesgos Laborales).',
      url: 'https://www.minsalud.gov.co/Normatividad_Nuevo/DECRETO%201295%20DE%201994.pdf',
    },
  ],
};

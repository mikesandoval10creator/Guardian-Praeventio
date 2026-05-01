/**
 * Argentina — paquete normativo de Higiene y Seguridad en el Trabajo.
 *
 * Marco principal:
 *  - Ley 19.587 (1972) — Higiene y Seguridad en el Trabajo.
 *  - Decreto 351/79 — Reglamentación de la Ley 19.587.
 *  - Ley 24.557 (1995) — Riesgos del Trabajo (LRT) + ART (Aseguradoras).
 *  - Resolución SRT 905/2015 — Servicios de Higiene y Seguridad y de Medicina del Trabajo.
 *  - Resolución SRT 295/2003 — Especificaciones técnicas (carga, ruido, ergonomía).
 *  - Resolución SRT 84/2012 — Programa de Seguridad para obras de construcción.
 *  - Decreto 911/96 — Reglamento de SST en la Industria de la Construcción.
 *
 * Argentina no exige un "Comité Paritario" único nacional como Chile; sí exige
 * Servicios de Higiene y Seguridad y Medicina del Trabajo (Res SRT 905/2015) por horas-empleado.
 */
import type { CountryPack } from '../../services/normativa/countryPacks';

export const AR_PACK: CountryPack = {
  code: 'AR',
  name: 'Argentina',
  flag: '🇦🇷',
  language: 'es-AR',
  iso45001Compatibility: 'high',
  notes:
    'Marco argentino: Ley 19.587 + Dec. 351/79 + Ley 24.557 (LRT). No hay comité paritario federal único; algunos CCT (convenios colectivos) lo establecen.',
  thresholds: {
    /**
     * VERIFY: a nivel nacional Argentina no fija un umbral universal de "Comité Paritario";
     * la Res SRT 905/2015 escala la asignación de horas-profesional al Servicio de Higiene y
     * Seguridad según número de trabajadores y nivel de riesgo. Algunos CCT (ej. construcción)
     * establecen comités. Usamos 50 como referencia indicativa.
     */
    comiteRequiredAtWorkers: 50,
    /**
     * Res SRT 905/2015: Servicio interno de Higiene y Seguridad obligatorio escalonado;
     * tiempo mínimo (horas-mes) según trabajadores. Punto de inflexión típico: > 150 trabajadores
     * exige profesional de planta. Verificar tabla anexo I.
     */
    preventionDeptRequiredAtWorkers: 150,
    monthlyMeetingsRequired: false,
  },
  regulations: [
    {
      id: 'ar-ley-19587',
      title: 'Ley 19.587 — Higiene y Seguridad en el Trabajo',
      reference: 'Ley N° 19.587 (1972)',
      scope:
        'Marco general de higiene y seguridad: protege la vida, integridad psicofísica y dignidad del trabajador. Obligaciones del empleador.',
      url: 'http://servicios.infoleg.gob.ar/infolegInternet/anexos/15000-19999/17612/norma.htm',
    },
    {
      id: 'ar-decreto-351-79',
      title: 'Decreto 351/79 — Reglamentación de la Ley 19.587',
      reference: 'Decreto 351/1979 (con modificatorias)',
      scope:
        'Reglamenta condiciones de trabajo, riesgos físicos, químicos, biológicos, ergonomía, EPP, capacitación.',
      url: 'http://servicios.infoleg.gob.ar/infolegInternet/anexos/30000-34999/32030/texact.htm',
    },
    {
      id: 'ar-ley-24557',
      title: 'Ley 24.557 — Ley de Riesgos del Trabajo (LRT)',
      reference: 'Ley N° 24.557 (1995)',
      scope:
        'Sistema de prevención y reparación de accidentes y enfermedades profesionales mediante Aseguradoras de Riesgos del Trabajo (ART).',
      url: 'http://servicios.infoleg.gob.ar/infolegInternet/anexos/25000-29999/27971/texact.htm',
    },
    {
      id: 'ar-srt-905-2015',
      title: 'Resolución SRT 905/2015 — Servicios de HyS y de Medicina del Trabajo',
      reference: 'Res. SRT 905/2015',
      scope:
        'Establece composición, funciones, asignación de horas-profesional y obligaciones de los Servicios de Higiene y Seguridad y de Medicina del Trabajo.',
      url: 'http://servicios.infoleg.gob.ar/infolegInternet/anexos/245000-249999/246716/norma.htm',
    },
    {
      id: 'ar-srt-295-2003',
      title: 'Resolución SRT 295/2003 — Especificaciones Técnicas',
      reference: 'Res. SRT 295/2003',
      scope:
        'Especificaciones técnicas sobre ergonomía y levantamiento manual de cargas, radiaciones, estrés térmico, ruido, agentes químicos.',
      url: 'http://servicios.infoleg.gob.ar/infolegInternet/anexos/90000-94999/90396/norma.htm',
    },
    {
      id: 'ar-decreto-911-96',
      title: 'Decreto 911/96 — Reglamento SST Industria de la Construcción',
      reference: 'Decreto 911/1996',
      scope:
        'Reglamento específico de Higiene y Seguridad para obras de construcción. Programa de Seguridad obligatorio.',
      url: 'http://servicios.infoleg.gob.ar/infolegInternet/anexos/35000-39999/38568/norma.htm',
    },
    {
      id: 'ar-srt-84-2012',
      title: 'Resolución SRT 84/2012 — Riesgo Eléctrico',
      reference: 'Res. SRT 84/2012',
      scope:
        'Reglamento sobre protección de los trabajadores frente al riesgo eléctrico. Procedimientos de trabajo seguro y bloqueo.',
      url: 'http://servicios.infoleg.gob.ar/infolegInternet/anexos/195000-199999/195486/norma.htm',
    },
  ],
};

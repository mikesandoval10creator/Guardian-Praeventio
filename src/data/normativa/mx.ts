/**
 * México — paquete normativo de SST.
 *
 * Marco principal: Ley Federal del Trabajo (LFT) Título IX (arts. 473-515) + Reglamento Federal de
 * Seguridad y Salud en el Trabajo (RFSST, 2014) + Normas Oficiales Mexicanas (NOM) emitidas por la
 * STPS (Secretaría del Trabajo y Previsión Social).
 *
 *  - NOM-019-STPS-2011 — Constitución, integración, organización y funcionamiento de las
 *    Comisiones de Seguridad e Higiene (Comisión Mixta).
 *  - NOM-030-STPS-2009 — Servicios preventivos de SST (responsable, diagnóstico, programa).
 *  - NOM-035-STPS-2018 — Factores de riesgo psicosocial.
 *  - NOM-017-STPS-2008 — EPP, selección, uso y manejo.
 *  - NOM-002-STPS-2010 — Prevención y protección contra incendios.
 *  - NOM-009-STPS-2011 — Trabajos en alturas.
 */
import type { CountryPack } from '../../services/normativa/countryPacks';

export const MX_PACK: CountryPack = {
  code: 'MX',
  name: 'México',
  flag: '🇲🇽',
  language: 'es-MX',
  iso45001Compatibility: 'high',
  notes:
    'Marco mexicano combinado: LFT + RFSST 2014 + NOM-STPS. NOM-019 exige Comisión Mixta de SST en TODO centro de trabajo.',
  thresholds: {
    /**
     * VERIFY: NOM-019-STPS-2011 obliga a constituir Comisión Mixta de SST en TODO centro de trabajo,
     * sin importar el número de trabajadores (la composición sí escala: 1+1 si ≤ 15, mayor si > 15).
     * Registramos 1 para reflejar la obligación universal; el panel UI debe explicar que el tamaño
     * mínimo es independiente del umbral.
     */
    comiteRequiredAtWorkers: 1,
    /**
     * VERIFY: NOM-030-STPS-2009 exige "servicios preventivos" en todo centro de trabajo;
     * el responsable debe ser interno cuando hay > 100 trabajadores (práctica STPS), externo permitido en empresas menores.
     */
    preventionDeptRequiredAtWorkers: 100,
    monthlyMeetingsRequired: true,
  },
  regulations: [
    {
      id: 'mx-lft-titulo-ix',
      title: 'Ley Federal del Trabajo — Título IX (Riesgos de Trabajo)',
      reference: 'LFT, Arts. 473-515',
      scope:
        'Define accidente y enfermedad de trabajo, indemnizaciones, obligaciones del patrón en materia de seguridad e higiene.',
      url: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf',
    },
    {
      id: 'mx-rfsst-2014',
      title: 'Reglamento Federal de Seguridad y Salud en el Trabajo (2014)',
      reference: 'DOF 13/11/2014, STPS',
      scope:
        'Reglamenta el Título IX de la LFT: obligaciones del patrón y trabajadores, diagnóstico y programa de SST, vigilancia.',
      url: 'https://www.gob.mx/cms/uploads/attachment/file/116182/Reglamento_Federal_de_Seguridad_y_Salud_en_el_Trabajo.pdf',
    },
    {
      id: 'mx-nom-019-stps',
      title: 'NOM-019-STPS-2011 — Comisiones de Seguridad e Higiene',
      reference: 'NOM-019-STPS-2011 (DOF 13/04/2011)',
      scope:
        'Constitución, integración, organización y funcionamiento de las Comisiones Mixtas de SST en todo centro de trabajo.',
      url: 'https://www.dof.gob.mx/normasOficiales/4308/stps/stps.htm',
    },
    {
      id: 'mx-nom-030-stps',
      title: 'NOM-030-STPS-2009 — Servicios Preventivos de SST',
      reference: 'NOM-030-STPS-2009',
      scope:
        'Funciones y actividades del responsable de SST: diagnóstico, programa, capacitación, supervisión.',
      url: 'https://www.dof.gob.mx/normasOficiales/3923/stps/stps.htm',
    },
    {
      id: 'mx-nom-035-stps',
      title: 'NOM-035-STPS-2018 — Factores de Riesgo Psicosocial',
      reference: 'NOM-035-STPS-2018 (DOF 23/10/2018)',
      scope:
        'Identificación, análisis y prevención de factores de riesgo psicosocial. Política de prevención y atención al estrés.',
      url: 'https://www.dof.gob.mx/nota_detalle.php?codigo=5541828',
    },
    {
      id: 'mx-nom-017-stps',
      title: 'NOM-017-STPS-2008 — Equipo de Protección Personal',
      reference: 'NOM-017-STPS-2008',
      scope:
        'Selección, uso y manejo de EPP en los centros de trabajo. Análisis de riesgo por puesto.',
      url: 'https://www.dof.gob.mx/normasOficiales/3581/stps/stps.htm',
    },
    {
      id: 'mx-nom-002-stps',
      title: 'NOM-002-STPS-2010 — Prevención y Protección contra Incendios',
      reference: 'NOM-002-STPS-2010',
      scope:
        'Brigadas, simulacros, equipo contra incendio, rutas y señalización de evacuación.',
      url: 'https://www.dof.gob.mx/normasOficiales/4221/stps/stps.htm',
    },
    {
      id: 'mx-nom-009-stps',
      title: 'NOM-009-STPS-2011 — Trabajos en Alturas',
      reference: 'NOM-009-STPS-2011',
      scope:
        'Condiciones de seguridad para realizar trabajos en altura: sistemas personales para trabajos en altura, andamios, escaleras.',
      url: 'https://www.dof.gob.mx/normasOficiales/4304/stps/stps.htm',
    },
  ],
};

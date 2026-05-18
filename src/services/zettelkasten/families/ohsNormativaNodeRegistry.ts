// SPDX-License-Identifier: MIT
// Static catalog for the OHS & NORMATIVA family (80 nodes).
// 26 cuerpos legales troncales + 54 articulos especificos = 80.

import type { FamilyNodeSpec } from './climateNodeRegistry';

interface NormaTrunk {
  readonly id: string;
  readonly title: string;
  readonly source: string;
}

const TRUNKS: ReadonlyArray<NormaTrunk> = [
  { id: 'norma-DS-54', title: 'DS 54 — Comites paritarios de higiene y seguridad.', source: 'DS-54' },
  { id: 'norma-DS-40', title: 'DS 44/2024 — Reglamento sobre prevencion de riesgos.', source: 'DS-40' },
  { id: 'norma-DS-76', title: 'DS 76 — Subcontratacion y obligaciones del mandante.', source: 'DS-76' },
  { id: 'norma-DS-132', title: 'DS 132 — Reglamento de seguridad minera.', source: 'DS-132' },
  { id: 'norma-DS-594', title: 'DS 594 — Condiciones sanitarias y ambientales basicas en lugares de trabajo.', source: 'DS-594' },
  { id: 'norma-DS-66', title: 'DS 66 — Reglamento de instalaciones interiores y medidores de gas.', source: 'DS-66' },
  { id: 'norma-DS-43', title: 'DS 43 — Reglamento de almacenamiento de sustancias peligrosas.', source: 'DS-43' },
  { id: 'norma-DS-248', title: 'DS 248 — Reglamento de tranques de relave.', source: 'DS-248' },
  { id: 'norma-DS-144', title: 'DS 144 — Emisiones a la atmosfera de fuentes fijas.', source: 'DS-144' },
  { id: 'norma-DS-28', title: 'DS 28 — Trabajo en altura geografica extrema.', source: 'DS-28' },
  { id: 'norma-Ley-16744', title: 'Ley 16.744 — Seguro social contra accidentes y enfermedades profesionales.', source: 'Ley-16744' },
  { id: 'norma-ISO-45001', title: 'ISO 45001 — Sistema de gestion de SST.', source: 'ISO-45001' },
  { id: 'norma-OHSAS-18001', title: 'OHSAS 18001 — Sistema de gestion SST (legacy).', source: 'OHSAS-18001' },
  { id: 'norma-NCh-432', title: 'NCh 432 — Diseno estructural: cargas de viento.', source: 'NCh-432' },
  { id: 'norma-NCh-1646', title: 'NCh 1646 — Hidrantes para servicio contra incendio.', source: 'NCh-1646' },
  { id: 'norma-NCh-Elec-4', title: 'NCh Elec 4 — Instalaciones electricas en baja tension.', source: 'NCh-Elec-4' },
  { id: 'norma-NIOSH-42-CFR-84', title: 'NIOSH 42 CFR 84 — Aprobacion de respiradores.', source: 'NIOSH-42-CFR-84' },
  { id: 'norma-NFPA-14', title: 'NFPA 14 — Sistemas de tuberias verticales y mangueras.', source: 'NFPA-14' },
  { id: 'norma-NFPA-30', title: 'NFPA 30 — Codigo de liquidos inflamables y combustibles.', source: 'NFPA-30' },
  { id: 'norma-OSHA-1926-451', title: 'OSHA 1926.451 — Andamios en construccion.', source: 'OSHA-1926-451' },
  { id: 'norma-OSHA-1910-146', title: 'OSHA 1910.146 — Espacios confinados que requieren permiso.', source: 'OSHA-1910-146' },
  { id: 'norma-IEC-61400-2', title: 'IEC 61400-2 — Pequenas turbinas eolicas.', source: 'IEC-61400-2' },
  { id: 'norma-Eurocodigo-7', title: 'Eurocodigo 7 — Diseno geotecnico.', source: 'Eurocodigo-7' },
  { id: 'norma-Pasquill-Gifford', title: 'Pasquill-Gifford — Estabilidad atmosferica para dispersion.', source: 'Pasquill-Gifford' },
  { id: 'norma-art', title: 'Articulo generico de norma (referencia variable).', source: 'internal' },
  { id: 'norma-resolucion-1500-SERNAGEOMIN', title: 'Resolucion 1500 SERNAGEOMIN — Depositos de relave.', source: 'SERNAGEOMIN' },
];

interface ArticleSpec {
  readonly id: string;
  readonly title: string;
  readonly source: string;
}

// 54 articulos especificos. IDs siguen el patron norma-<cuerpo>-Art-<n>.
const ARTICLES: ReadonlyArray<ArticleSpec> = [
  { id: 'norma-DS-594-Art-3', title: 'DS 594 Art. 3 — Obligacion del empleador en condiciones sanitarias.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-9', title: 'DS 594 Art. 9 — Servicios higienicos.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-21', title: 'DS 594 Art. 21 — Iluminacion en lugares de trabajo.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-23', title: 'DS 594 Art. 23 — Riesgo electrico.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-32', title: 'DS 594 Art. 32 — Ventilacion en espacios cerrados.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-33', title: 'DS 594 Art. 33 — Renovacion de aire en interiores.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-35', title: 'DS 594 Art. 35 — Extraccion localizada de contaminantes.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-41', title: 'DS 594 Art. 41 — Proteccion contra incendios y agua.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-49', title: 'DS 594 Art. 49 — Trabajo en altura geografica.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-53', title: 'DS 594 Art. 53 — Equipos de proteccion respiratoria.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-57', title: 'DS 594 Art. 57 — Proteccion auditiva.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-61', title: 'DS 594 Art. 61 — Espacios confinados.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-65', title: 'DS 594 Art. 65 — Limites permisibles de silice.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-72', title: 'DS 594 Art. 72 — Calor y exposicion termica.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-78', title: 'DS 594 Art. 78 — Trabajo en alturas y andamios.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-103', title: 'DS 594 Art. 103 — Limite ruido continuo.', source: 'DS-594' },
  { id: 'norma-DS-594-Art-110', title: 'DS 594 Art. 110 — Vibraciones mano-brazo.', source: 'DS-594' },
  { id: 'norma-DS-132-Art-32', title: 'DS 132 Art. 32 — Estabilidad de taludes mineros.', source: 'DS-132' },
  { id: 'norma-DS-132-Art-74', title: 'DS 132 Art. 74 — Ventilacion en mineria subterranea.', source: 'DS-132' },
  { id: 'norma-DS-132-Art-75', title: 'DS 132 Art. 75 — Caudal minimo de aire por trabajador en mina.', source: 'DS-132' },
  { id: 'norma-DS-132-Art-201', title: 'DS 132 Art. 201 — Voladuras controladas.', source: 'DS-132' },
  { id: 'norma-DS-132-Art-220', title: 'DS 132 Art. 220 — Manejo de explosivos.', source: 'DS-132' },
  { id: 'norma-DS-40-Art-14', title: 'DS 44/2024 Art. 14 — Departamento de prevencion de riesgos.', source: 'DS-40' },
  { id: 'norma-DS-40-Art-21', title: 'DS 44/2024 Art. 21 — Obligacion de informar (ODI/Derecho a saber).', source: 'DS-40' },
  { id: 'norma-DS-54-Art-1', title: 'DS 54 Art. 1 — Constitucion de comite paritario.', source: 'DS-54' },
  { id: 'norma-DS-54-Art-24', title: 'DS 54 Art. 24 — Funciones del comite paritario.', source: 'DS-54' },
  { id: 'norma-DS-76-Art-3', title: 'DS 76 Art. 3 — Reglamento especial de subcontratistas.', source: 'DS-76' },
  { id: 'norma-DS-76-Art-7', title: 'DS 76 Art. 7 — Sistema de gestion en regimen de subcontratacion.', source: 'DS-76' },
  { id: 'norma-DS-43-Art-22', title: 'DS 43 Art. 22 — Almacenamiento de inflamables.', source: 'DS-43' },
  { id: 'norma-DS-43-Art-46', title: 'DS 43 Art. 46 — Distancias de seguridad y compatibilidad.', source: 'DS-43' },
  { id: 'norma-DS-66-Art-43', title: 'DS 66 Art. 43 — Pruebas de hermeticidad de gas.', source: 'DS-66' },
  { id: 'norma-DS-248-Art-12', title: 'DS 248 Art. 12 — Diseno y construccion de tranques.', source: 'DS-248' },
  { id: 'norma-DS-248-Art-31', title: 'DS 248 Art. 31 — Monitoreo geotecnico de relaves.', source: 'DS-248' },
  { id: 'norma-DS-28-Art-4', title: 'DS 28 Art. 4 — Examen pre-ocupacional de altura.', source: 'DS-28' },
  { id: 'norma-Ley-16744-Art-66', title: 'Ley 16.744 Art. 66 — Comite paritario y reglamento interno.', source: 'Ley-16744' },
  { id: 'norma-Ley-16744-Art-68', title: 'Ley 16.744 Art. 68 — Obligaciones de la empresa.', source: 'Ley-16744' },
  { id: 'norma-ISO-45001-Cap-6', title: 'ISO 45001 Cap. 6 — Planificacion y evaluacion de riesgos.', source: 'ISO-45001' },
  { id: 'norma-ISO-45001-Cap-8', title: 'ISO 45001 Cap. 8 — Operacion y control operacional.', source: 'ISO-45001' },
  { id: 'norma-ISO-45001-Cap-10', title: 'ISO 45001 Cap. 10 — Mejora y accion correctiva.', source: 'ISO-45001' },
  { id: 'norma-NCh-432-Cap-5', title: 'NCh 432 Cap. 5 — Coeficientes de presion en estructuras.', source: 'NCh-432' },
  { id: 'norma-NCh-1646-Cap-3', title: 'NCh 1646 Cap. 3 — Capacidad y caudal de hidrantes.', source: 'NCh-1646' },
  { id: 'norma-NCh-Elec-4-Sec-9', title: 'NCh Elec 4 Sec. 9 — Tableros y proteccion diferencial.', source: 'NCh-Elec-4' },
  { id: 'norma-NCh-Elec-4-Sec-13', title: 'NCh Elec 4 Sec. 13 — Faenas temporales y obras.', source: 'NCh-Elec-4' },
  { id: 'norma-NFPA-14-Cap-7', title: 'NFPA 14 Cap. 7 — Diseno hidraulico de redes humedas.', source: 'NFPA-14' },
  { id: 'norma-NFPA-30-Cap-9', title: 'NFPA 30 Cap. 9 — Tanques de almacenamiento aereo.', source: 'NFPA-30' },
  { id: 'norma-OSHA-1926-451-b', title: 'OSHA 1926.451(b) — Plataformas y barandas en andamios.', source: 'OSHA-1926-451' },
  { id: 'norma-OSHA-1910-146-c', title: 'OSHA 1910.146(c) — Programa escrito de espacios confinados.', source: 'OSHA-1910-146' },
  { id: 'norma-NIOSH-42-CFR-84-N95', title: 'NIOSH 42 CFR 84 — Filtros N95 y P100.', source: 'NIOSH-42-CFR-84' },
  { id: 'norma-Eurocodigo-7-Sec-2', title: 'Eurocodigo 7 Sec. 2 — Diseno geotecnico de estabilidad.', source: 'Eurocodigo-7' },
  { id: 'norma-IEC-61400-2-Cap-7', title: 'IEC 61400-2 Cap. 7 — Cargas de diseno en micro-eolica.', source: 'IEC-61400-2' },
  { id: 'norma-resolucion-1500-Art-5', title: 'Resolucion 1500 Art. 5 — Plan de cierre de relaves.', source: 'SERNAGEOMIN' },
  { id: 'norma-SUSESO-Circular-3241', title: 'SUSESO Circular 3241 — Protocolo PREXOR (ruido).', source: 'SUSESO' },
  { id: 'norma-SUSESO-Circular-3596', title: 'SUSESO Circular 3596 — Protocolo TMERT-EESS.', source: 'SUSESO' },
  { id: 'norma-SUSESO-Protocolo-PLANESI', title: 'SUSESO Protocolo PLANESI — Vigilancia silice.', source: 'SUSESO' },
];

export const OHS_NORMATIVA_NODES: ReadonlyArray<FamilyNodeSpec> = [
  ...TRUNKS.map<FamilyNodeSpec>((t) => ({
    id: t.id,
    description: t.title,
    producerHint: 'src/services/zettelkasten/normaRegistry.ts',
    consumerHints: ['src/pages/RiskNetwork.tsx', 'src/services/orchestratorService.ts'],
    source: t.source,
  })),
  ...ARTICLES.map<FamilyNodeSpec>((a) => ({
    id: a.id,
    description: a.title,
    producerHint: 'src/services/zettelkasten/normaRegistry.ts',
    consumerHints: ['src/pages/RiskNetwork.tsx', 'src/pages/Audits.tsx'],
    source: a.source,
  })),
];

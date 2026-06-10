/**
 * SII economic-activity codes (Chile) — curated subset for the product's
 * target rubros, mapped to the GP-* industry taxonomy in `src/constants.ts`.
 *
 * DATA PROVENANCE (hard rule: never fabricate legal data)
 * -------------------------------------------------------
 * Classifier: CIIU4.CL 2012 (Chilean adaptation of ISIC Rev.4), as published
 * by the Servicio de Impuestos Internos (SII). Every code and description in
 * this file was verified on 2026-06-10 against TWO official SII sources:
 *   1. "Códigos de actividad económica" —
 *      https://www.sii.cl/ayudas/ayudas_por_servicios/1956-codigos-1959.html
 *   2. "Homologación completa de actividades económicas con el CIIU4.CL 2012" —
 *      https://www.sii.cl/catastro/homologacion_codigos_actividad.pdf
 * Descriptions are transcribed verbatim (uppercase, as published in source 1;
 * where source 1 rendering truncated a line, the full text from source 2 was
 * used). Codes that could not be verified against an official source were NOT
 * included.
 *
 * `codigo` is the SII 6-digit code stored as a number; codes for sections
 * A–B (agro, mining) carry an implied leading zero (e.g. 40000 ≡ "040000").
 * Use `formatCodigoSii()` from `src/services/sii/rubroSearch.ts` to render
 * the canonical zero-padded form.
 *
 * `sectorId` is the GP-* subsector id (the part before ':' in
 * `INDUSTRY_SECTORS` subsector labels). The GP taxonomy follows CIIU sections,
 * so most mappings are direct; where a CIIU4 division has no exact GP
 * subsector (e.g. division 25, fabricated metal products), the closest GP
 * subsector is used and noted inline.
 */

export interface SiiActividadEconomica {
  /** SII 6-digit economic-activity code (CIIU4.CL), leading zero implied. */
  codigo: number;
  /** Official SII description, transcribed verbatim. */
  descripcion: string;
  /** GP-* subsector id from INDUSTRY_SECTORS (src/constants.ts). */
  sectorId: string;
}

export const SII_ACTIVIDADES_ECONOMICAS: readonly SiiActividadEconomica[] = [
  // ── A. AGRICULTURA, GANADERÍA, SILVICULTURA Y PESCA ────────────────────────
  { codigo: 11101, descripcion: 'CULTIVO DE TRIGO', sectorId: 'GP-AGR-CULT' },
  { codigo: 11306, descripcion: 'CULTIVO DE HORTALIZAS Y MELONES', sectorId: 'GP-AGR-CULT' },
  { codigo: 12112, descripcion: 'CULTIVO DE UVA DESTINADA A LA PRODUCCIÓN DE VINO', sectorId: 'GP-AGR-CULT' },
  { codigo: 12120, descripcion: 'CULTIVO DE UVA PARA MESA', sectorId: 'GP-AGR-CULT' },
  { codigo: 12200, descripcion: 'CULTIVO DE FRUTAS TROPICALES Y SUBTROPICALES (INCLUYE EL CULTIVO DE PALTAS)', sectorId: 'GP-AGR-CULT' },
  { codigo: 13000, descripcion: 'CULTIVO DE PLANTAS VIVAS INCLUIDA LA PRODUCCIÓN EN VIVEROS (EXCEPTO VIVEROS FORESTALES)', sectorId: 'GP-AGR-CULT' },
  { codigo: 16100, descripcion: 'ACTIVIDADES DE APOYO A LA AGRICULTURA', sectorId: 'GP-AGR-CULT' },
  { codigo: 14101, descripcion: 'CRÍA DE GANADO BOVINO PARA LA PRODUCCIÓN LECHERA', sectorId: 'GP-AGR-GAN' },
  { codigo: 14102, descripcion: 'CRÍA DE GANADO BOVINO PARA LA PRODUCCIÓN DE CARNE O COMO GANADO REPRODUCTOR', sectorId: 'GP-AGR-GAN' },
  { codigo: 14410, descripcion: 'CRÍA DE OVEJAS (OVINOS)', sectorId: 'GP-AGR-GAN' },
  { codigo: 14500, descripcion: 'CRÍA DE CERDOS', sectorId: 'GP-AGR-GAN' },
  { codigo: 14601, descripcion: 'CRÍA DE AVES DE CORRAL PARA LA PRODUCCIÓN DE CARNE', sectorId: 'GP-AGR-GAN' },
  { codigo: 16200, descripcion: 'ACTIVIDADES DE APOYO A LA GANADERÍA', sectorId: 'GP-AGR-GAN' },
  { codigo: 21002, descripcion: 'SILVICULTURA Y OTRAS ACTIVIDADES FORESTALES (EXCEPTO EXPLOTACIÓN DE VIVEROS FORESTALES)', sectorId: 'GP-AGR-SIL' },
  { codigo: 22000, descripcion: 'EXTRACCIÓN DE MADERA', sectorId: 'GP-AGR-SIL' },
  { codigo: 24001, descripcion: 'SERVICIOS DE FORESTACIÓN A CAMBIO DE UNA RETRIBUCIÓN O POR CONTRATA', sectorId: 'GP-AGR-SIL' },
  { codigo: 24002, descripcion: 'SERVICIOS DE CORTA DE MADERA A CAMBIO DE UNA RETRIBUCIÓN O POR CONTRATA', sectorId: 'GP-AGR-SIL' },
  { codigo: 24003, descripcion: 'SERVICIOS DE EXTINCIÓN Y PREVENCIÓN DE INCENDIOS FORESTALES', sectorId: 'GP-AGR-SIL' },
  { codigo: 31110, descripcion: 'PESCA MARÍTIMA INDUSTRIAL, EXCEPTO DE BARCOS FACTORÍA', sectorId: 'GP-AGR-PES' },
  { codigo: 31120, descripcion: 'PESCA MARÍTIMA ARTESANAL', sectorId: 'GP-AGR-PES' },
  { codigo: 31200, descripcion: 'PESCA DE AGUA DULCE', sectorId: 'GP-AGR-PES' },
  { codigo: 32110, descripcion: 'CULTIVO Y CRIANZA DE PECES MARINOS', sectorId: 'GP-AGR-PES' },
  { codigo: 32120, descripcion: 'CULTIVO, REPRODUCCIÓN Y MANEJO DE ALGAS MARINAS', sectorId: 'GP-AGR-PES' },
  { codigo: 32200, descripcion: 'ACUICULTURA DE AGUA DULCE', sectorId: 'GP-AGR-PES' },

  // ── B. EXPLOTACIÓN DE MINAS Y CANTERAS ─────────────────────────────────────
  { codigo: 40000, descripcion: 'EXTRACCIÓN Y PROCESAMIENTO DE COBRE', sectorId: 'GP-MIN-MET' },
  { codigo: 51000, descripcion: 'EXTRACCIÓN DE CARBÓN DE PIEDRA', sectorId: 'GP-MIN-CAR' },
  { codigo: 61000, descripcion: 'EXTRACCIÓN DE PETRÓLEO CRUDO', sectorId: 'GP-MIN-PET' },
  { codigo: 62000, descripcion: 'EXTRACCIÓN DE GAS NATURAL', sectorId: 'GP-MIN-PET' },
  { codigo: 71000, descripcion: 'EXTRACCIÓN DE MINERALES DE HIERRO', sectorId: 'GP-MIN-MET' },
  { codigo: 72910, descripcion: 'EXTRACCIÓN DE ORO Y PLATA', sectorId: 'GP-MIN-MET' },
  { codigo: 72991, descripcion: 'EXTRACCIÓN DE ZINC Y PLOMO', sectorId: 'GP-MIN-MET' },
  { codigo: 81000, descripcion: 'EXTRACCIÓN DE PIEDRA, ARENA Y ARCILLA', sectorId: 'GP-MIN-NOMET' },
  { codigo: 89110, descripcion: 'EXTRACCIÓN Y PROCESAMIENTO DE LITIO', sectorId: 'GP-MIN-NOMET' },
  { codigo: 89300, descripcion: 'EXTRACCIÓN DE SAL', sectorId: 'GP-MIN-NOMET' },
  { codigo: 89900, descripcion: 'EXPLOTACIÓN DE OTRAS MINAS Y CANTERAS N.C.P.', sectorId: 'GP-MIN-NOMET' },
  { codigo: 91001, descripcion: 'ACTIVIDADES DE APOYO PARA LA EXTRACCIÓN DE PETRÓLEO Y GAS NATURAL PRESTADOS POR EMPRESAS', sectorId: 'GP-MIN-SERV' },
  { codigo: 99001, descripcion: 'ACTIVIDADES DE APOYO PARA LA EXPLOTACIÓN DE OTRAS MINAS Y CANTERAS PRESTADOS POR EMPRESAS', sectorId: 'GP-MIN-SERV' },

  // ── C. INDUSTRIA MANUFACTURERA ─────────────────────────────────────────────
  { codigo: 101011, descripcion: 'EXPLOTACIÓN DE MATADEROS DE BOVINOS, OVINOS, EQUINOS, CAPRINOS, PORCINOS Y CAMÉLIDOS', sectorId: 'GP-MANU-ALI' },
  { codigo: 101020, descripcion: 'ELABORACIÓN Y CONSERVACIÓN DE CARNE Y PRODUCTOS CÁRNICOS', sectorId: 'GP-MANU-ALI' },
  { codigo: 102010, descripcion: 'PRODUCCIÓN DE HARINA DE PESCADO', sectorId: 'GP-MANU-ALI' },
  { codigo: 102020, descripcion: 'ELABORACIÓN Y CONSERVACIÓN DE SALMÓNIDOS', sectorId: 'GP-MANU-ALI' },
  { codigo: 107100, descripcion: 'ELABORACIÓN DE PRODUCTOS DE PANADERÍA Y PASTELERÍA', sectorId: 'GP-MANU-ALI' },
  { codigo: 110200, descripcion: 'ELABORACIÓN DE VINOS', sectorId: 'GP-MANU-BEB' },
  { codigo: 161000, descripcion: 'ASERRADO Y ACEPILLADURA DE MADERA', sectorId: 'GP-MANU-MAD' },
  { codigo: 162100, descripcion: 'FABRICACIÓN DE HOJAS DE MADERA PARA ENCHAPADO Y TABLEROS A BASE DE MADERA', sectorId: 'GP-MANU-MAD' },
  { codigo: 170110, descripcion: 'FABRICACIÓN DE CELULOSA Y OTRAS PASTAS DE MADERA', sectorId: 'GP-MANU-PAP' },
  { codigo: 170200, descripcion: 'FABRICACIÓN DE PAPEL Y CARTÓN ONDULADO Y DE ENVASES DE PAPEL Y CARTÓN', sectorId: 'GP-MANU-PAP' },
  { codigo: 192000, descripcion: 'FABRICACIÓN DE PRODUCTOS DE LA REFINACIÓN DEL PETRÓLEO', sectorId: 'GP-MANU-COQ' },
  { codigo: 201200, descripcion: 'FABRICACIÓN DE ABONOS Y COMPUESTOS DE NITRÓGENO', sectorId: 'GP-MANU-QUIM' },
  { codigo: 202100, descripcion: 'FABRICACIÓN DE PLAGUICIDAS Y OTROS PRODUCTOS QUÍMICOS DE USO AGROPECUARIO', sectorId: 'GP-MANU-QUIM' },
  { codigo: 202901, descripcion: 'FABRICACIÓN DE EXPLOSIVOS Y PRODUCTOS PIROTÉCNICOS', sectorId: 'GP-MANU-QUIM' },
  { codigo: 241000, descripcion: 'INDUSTRIAS BÁSICAS DE HIERRO Y ACERO', sectorId: 'GP-MANU-MET' },
  { codigo: 242001, descripcion: 'FABRICACIÓN DE PRODUCTOS PRIMARIOS DE COBRE', sectorId: 'GP-MANU-MET' },
  { codigo: 243100, descripcion: 'FUNDICIÓN DE HIERRO Y ACERO', sectorId: 'GP-MANU-MET' },
  // CIIU4 division 25 (fabricated metal products) has no dedicated GP
  // subsector; mapped to the closest one (metales comunes).
  { codigo: 251100, descripcion: 'FABRICACIÓN DE PRODUCTOS METÁLICOS PARA USO ESTRUCTURAL', sectorId: 'GP-MANU-MET' },

  // ── D. SUMINISTRO DE ELECTRICIDAD, GAS, VAPOR Y AIRE ACONDICIONADO ────────
  { codigo: 351011, descripcion: 'GENERACIÓN DE ENERGÍA ELÉCTRICA EN CENTRALES HIDROELÉCTRICAS', sectorId: 'GP-ELEC-GEN' },
  { codigo: 351012, descripcion: 'GENERACIÓN DE ENERGÍA ELÉCTRICA EN CENTRALES TERMOELÉCTRICAS', sectorId: 'GP-ELEC-GEN' },
  { codigo: 351020, descripcion: 'TRANSMISIÓN DE ENERGÍA ELÉCTRICA', sectorId: 'GP-ELEC-GEN' },
  { codigo: 351030, descripcion: 'DISTRIBUCIÓN DE ENERGÍA ELÉCTRICA', sectorId: 'GP-ELEC-GEN' },
  { codigo: 352020, descripcion: 'FABRICACIÓN DE GAS; DISTRIBUCIÓN DE COMBUSTIBLES GASEOSOS POR TUBERÍA, EXCEPTO REGASIFICACIÓN DE GNL', sectorId: 'GP-ELEC-GAS' },

  // ── E. SUMINISTRO DE AGUA; GESTIÓN DE DESECHOS Y DESCONTAMINACIÓN ─────────
  { codigo: 360000, descripcion: 'CAPTACIÓN, TRATAMIENTO Y DISTRIBUCIÓN DE AGUA', sectorId: 'GP-ENERG-AGUA' },
  { codigo: 370000, descripcion: 'EVACUACIÓN Y TRATAMIENTO DE AGUAS SERVIDAS', sectorId: 'GP-ENERG-ALC' },
  { codigo: 381100, descripcion: 'RECOGIDA DE DESECHOS NO PELIGROSOS', sectorId: 'GP-ENERG-RES' },
  { codigo: 381200, descripcion: 'RECOGIDA DE DESECHOS PELIGROSOS', sectorId: 'GP-ENERG-RES' },
  { codigo: 382200, descripcion: 'TRATAMIENTO Y ELIMINACIÓN DE DESECHOS PELIGROSOS', sectorId: 'GP-ENERG-RES' },
  { codigo: 383001, descripcion: 'RECUPERACIÓN Y RECICLAMIENTO DE DESPERDICIOS Y DESECHOS METÁLICOS', sectorId: 'GP-ENERG-SAN' },
  { codigo: 390000, descripcion: 'ACTIVIDADES DE DESCONTAMINACIÓN Y OTROS SERVICIOS DE GESTIÓN DE DESECHOS', sectorId: 'GP-ENERG-SAN' },

  // ── F. CONSTRUCCIÓN ────────────────────────────────────────────────────────
  { codigo: 410010, descripcion: 'CONSTRUCCIÓN DE EDIFICIOS PARA USO RESIDENCIAL', sectorId: 'GP-CONS-RES' },
  { codigo: 410020, descripcion: 'CONSTRUCCIÓN DE EDIFICIOS PARA USO NO RESIDENCIAL', sectorId: 'GP-CONS-NRES' },
  { codigo: 421000, descripcion: 'CONSTRUCCIÓN DE CARRETERAS Y LÍNEAS DE FERROCARRIL', sectorId: 'GP-CONS-VIA' },
  { codigo: 422000, descripcion: 'CONSTRUCCIÓN DE PROYECTOS DE SERVICIO PÚBLICO', sectorId: 'GP-CONS-SERV' },
  { codigo: 429000, descripcion: 'CONSTRUCCIÓN DE OTRAS OBRAS DE INGENIERÍA CIVIL', sectorId: 'GP-CONS-ESP' },
  { codigo: 431100, descripcion: 'DEMOLICIÓN', sectorId: 'GP-CONS-DEM' },
  { codigo: 431200, descripcion: 'PREPARACIÓN DEL TERRENO', sectorId: 'GP-CONS-DEM' },
  { codigo: 432100, descripcion: 'INSTALACIONES ELÉCTRICAS', sectorId: 'GP-CONS-INST' },
  { codigo: 432200, descripcion: 'INSTALACIONES DE GASFITERÍA, CALEFACCIÓN Y AIRE ACONDICIONADO', sectorId: 'GP-CONS-INST' },
  { codigo: 432900, descripcion: 'OTRAS INSTALACIONES PARA OBRAS DE CONSTRUCCIÓN', sectorId: 'GP-CONS-INST' },
  { codigo: 433000, descripcion: 'TERMINACIÓN Y ACABADO DE EDIFICIOS', sectorId: 'GP-CONS-TERM' },
  { codigo: 439000, descripcion: 'OTRAS ACTIVIDADES ESPECIALIZADAS DE CONSTRUCCIÓN', sectorId: 'GP-CONS-ESP' },

  // ── G. COMERCIO AL POR MAYOR Y AL POR MENOR ────────────────────────────────
  { codigo: 451001, descripcion: 'VENTA AL POR MAYOR DE VEHÍCULOS AUTOMOTORES', sectorId: 'GP-COM-VEH' },
  { codigo: 451002, descripcion: 'VENTA AL POR MENOR DE VEHÍCULOS AUTOMOTORES NUEVOS O USADOS (INCLUYE COMPRAVENTA)', sectorId: 'GP-COM-VEH' },
  { codigo: 452002, descripcion: 'MANTENIMIENTO Y REPARACIÓN DE VEHÍCULOS AUTOMOTORES', sectorId: 'GP-COM-VEH' },
  { codigo: 466100, descripcion: 'VENTA AL POR MAYOR DE COMBUSTIBLES SÓLIDOS, LÍQUIDOS Y GASEOSOS Y PRODUCTOS CONEXOS', sectorId: 'GP-COM-MAY' },
  { codigo: 466302, descripcion: 'VENTA AL POR MAYOR DE MATERIALES DE CONSTRUCCIÓN, ARTÍCULOS DE FERRETERÍA, GASFITERÍA Y CALEFACCIÓN', sectorId: 'GP-COM-MAY' },
  { codigo: 466901, descripcion: 'VENTA AL POR MAYOR DE PRODUCTOS QUÍMICOS', sectorId: 'GP-COM-MAY' },
  { codigo: 471100, descripcion: 'VENTA AL POR MENOR EN COMERCIOS DE ALIMENTOS, BEBIDAS O TABACO (SUPERMERCADOS E HIPERMERCADOS)', sectorId: 'GP-COM-MEN' },
  { codigo: 472101, descripcion: 'VENTA AL POR MENOR DE ALIMENTOS EN COMERCIOS ESPECIALIZADOS (ALMACENES PEQUEÑOS Y MINIMARKET)', sectorId: 'GP-COM-MEN' },
  { codigo: 473000, descripcion: 'VENTA AL POR MENOR DE COMBUSTIBLES PARA VEHÍCULOS AUTOMOTORES EN COMERCIOS ESPECIALIZADOS', sectorId: 'GP-COM-MEN' },

  // ── H. TRANSPORTE Y ALMACENAMIENTO ─────────────────────────────────────────
  { codigo: 491200, descripcion: 'TRANSPORTE DE CARGA POR FERROCARRIL', sectorId: 'GP-TRANS-FER' },
  { codigo: 492120, descripcion: 'TRANSPORTE URBANO Y SUBURBANO DE PASAJEROS VÍA LOCOMOCIÓN COLECTIVA', sectorId: 'GP-TRANS-TER' },
  { codigo: 492220, descripcion: 'SERVICIOS DE TRANSPORTE DE TRABAJADORES', sectorId: 'GP-TRANS-TER' },
  { codigo: 492250, descripcion: 'TRANSPORTE DE PASAJEROS EN BUSES INTERURBANOS', sectorId: 'GP-TRANS-TER' },
  { codigo: 492300, descripcion: 'TRANSPORTE DE CARGA POR CARRETERA', sectorId: 'GP-TRANS-TER' },
  { codigo: 501200, descripcion: 'TRANSPORTE DE CARGA MARÍTIMO Y DE CABOTAJE', sectorId: 'GP-TRANS-MAR' },
  { codigo: 511000, descripcion: 'TRANSPORTE DE PASAJEROS POR VÍA AÉREA', sectorId: 'GP-TRANS-AER' },
  { codigo: 512000, descripcion: 'TRANSPORTE DE CARGA POR VÍA AÉREA', sectorId: 'GP-TRANS-AER' },
  { codigo: 521001, descripcion: 'EXPLOTACIÓN DE FRIGORÍFICOS PARA ALMACENAMIENTO Y DEPÓSITO', sectorId: 'GP-TRANS-ALM' },
  { codigo: 522400, descripcion: 'MANIPULACIÓN DE LA CARGA', sectorId: 'GP-TRANS-ALM' },
  { codigo: 522990, descripcion: 'OTRAS ACTIVIDADES DE APOYO AL TRANSPORTE N.C.P.', sectorId: 'GP-TRANS-ALM' },
  { codigo: 532000, descripcion: 'ACTIVIDADES DE MENSAJERÍA', sectorId: 'GP-TRANS-POST' },

  // ── I. ALOJAMIENTO Y SERVICIOS DE COMIDA ───────────────────────────────────
  { codigo: 551001, descripcion: 'ACTIVIDADES DE HOTELES', sectorId: 'GP-ALOJA-HOT' },
  { codigo: 561000, descripcion: 'ACTIVIDADES DE RESTAURANTES Y DE SERVICIO MÓVIL DE COMIDAS', sectorId: 'GP-ALOJA-COM' },
  { codigo: 562900, descripcion: 'SUMINISTRO INDUSTRIAL DE COMIDAS POR ENCARGO; CONCESIÓN DE SERVICIOS DE ALIMENTACIÓN', sectorId: 'GP-ALOJA-COM' },

  // ── N. SERVICIOS ADMINISTRATIVOS Y DE APOYO ────────────────────────────────
  { codigo: 781000, descripcion: 'ACTIVIDADES DE AGENCIAS DE EMPLEO', sectorId: 'GP-ADM-RRHH' },
  { codigo: 782000, descripcion: 'ACTIVIDADES DE AGENCIAS DE EMPLEO TEMPORAL (INCLUYE EMPRESAS DE SERVICIOS TRANSITORIOS)', sectorId: 'GP-ADM-RRHH' },
  { codigo: 801001, descripcion: 'SERVICIOS DE SEGURIDAD PRIVADA PRESTADOS POR EMPRESAS', sectorId: 'GP-ADM-SEG' },
  { codigo: 802000, descripcion: 'ACTIVIDADES DE SERVICIOS DE SISTEMAS DE SEGURIDAD (INCLUYE SERVICIOS DE CERRAJERÍA)', sectorId: 'GP-ADM-SEG' },
  { codigo: 812100, descripcion: 'LIMPIEZA GENERAL DE EDIFICIOS', sectorId: 'GP-ADM-LIMP' },
  { codigo: 812901, descripcion: 'DESRATIZACIÓN, DESINFECCIÓN Y EXTERMINIO DE PLAGAS NO AGRÍCOLAS', sectorId: 'GP-ADM-LIMP' },
  { codigo: 813000, descripcion: 'ACTIVIDADES DE PAISAJISMO, SERVICIOS DE JARDINERÍA Y SERVICIOS CONEXOS', sectorId: 'GP-ADM-LIMP' },
];

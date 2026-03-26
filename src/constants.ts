export const INDUSTRY_SECTORS = [
  {
    sector: 'GP-AGR - AGRICULTURA, GANADERÍA, SILVICULTURA Y PESCA',
    subsectors: [
      'GP-AGR-CULT: Cultivos anuales y permanentes',
      'GP-AGR-GAN: Ganadería',
      'GP-AGR-SIL: Silvicultura y extracción de madera',
      'GP-AGR-PES: Pesca y acuicultura'
    ]
  },
  {
    sector: 'GP-MIN - EXPLOTACIÓN DE MINAS Y CANTERAS',
    subsectors: [
      'GP-MIN-CAR: Extracción de carbón',
      'GP-MIN-PET: Extracción de petróleo y gas',
      'GP-MIN-MET: Extracción de minerales metalíferos',
      'GP-MIN-NOMET: Otras minas y canteras',
      'GP-MIN-SERV: Servicios de apoyo minero'
    ]
  },
  {
    sector: 'GP-MANU - INDUSTRIAS MANUFACTURERAS',
    subsectors: [
      'GP-MANU-ALI: Productos alimenticios',
      'GP-MANU-BEB: Elaboración de bebidas',
      'GP-MANU-TEX: Fabricación de productos textiles',
      'GP-MANU-MAD: Producción de madera y corcho',
      'GP-MANU-PAP: Fabricación de papel y productos de papel',
      'GP-MANU-QUI: Fabricación de sustancias y productos químicos',
      'GP-MANU-MET: Fabricación de metales comunes',
      'GP-MANU-MAQ: Fabricación de maquinaria y equipo'
    ]
  },
  {
    sector: 'GP-ELEC - SUMINISTRO DE ELECTRICIDAD, GAS, VAPOR Y AIRE ACONDICIONADO',
    subsectors: [
      'GP-ELEC-GEN: Generación, transmisión y distribución de energía eléctrica',
      'GP-ELEC-GAS: Fabricación de gas; distribución de combustibles gaseosos'
    ]
  },
  {
    sector: 'GP-CONS - CONSTRUCCIÓN',
    subsectors: [
      'GP-CONS-EDI: Construcción de edificios',
      'GP-CONS-CIV: Obras de ingeniería civil',
      'GP-CONS-ESP: Actividades especializadas de construcción'
    ]
  },
  {
    sector: 'GP-COM - COMERCIO AL POR MAYOR Y AL POR MENOR',
    subsectors: [
      'GP-COM-VEH: Venta y reparación de vehículos automotores',
      'GP-COM-MAY: Comercio al por mayor',
      'GP-COM-MEN: Comercio al por menor'
    ]
  },
  {
    sector: 'GP-TRANS - TRANSPORTE Y ALMACENAMIENTO',
    subsectors: [
      'GP-TRANS-TER: Transporte por vía terrestre y por tuberías',
      'GP-TRANS-ACU: Transporte por vía acuática',
      'GP-TRANS-AER: Transporte por vía aérea',
      'GP-TRANS-ALM: Almacenamiento y actividades de apoyo al transporte'
    ]
  }
];

// Flattened list for backwards compatibility or simple dropdowns
export const INDUSTRIES = INDUSTRY_SECTORS.flatMap(sector => sector.subsectors);

export const RISK_LEVELS = ['Bajo', 'Medio', 'Alto', 'Crítico'] as const;


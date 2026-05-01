import React, { createContext, useContext, ReactNode } from 'react';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface Normative {
  id: string;
  code: string;
  title: string;
  category: 'fundacional' | 'higiene' | 'riesgos' | 'sectorial' | 'minsal';
  sector?: string;
  summary: string;
  keyArticles: string[];
  searchTerms: string[];
}

export interface Protocol {
  id: string;
  code: string;
  title: string;
  type: 'surveillance' | 'investigation' | 'emergency';
  applicableTo: string[];
  steps: string[];
  legalBasis: string;
}

export interface NormativeContextType {
  normatives: Normative[];
  protocols: Protocol[];
  searchNormatives(query: string): Normative[];
  searchProtocols(query: string): Protocol[];
  getNormativeByCode(code: string): Normative | undefined;
  getNormativesByCategory(cat: string): Normative[];
  getNormativesBySector(sector: string): Normative[];
  getRelatedNormatives(id: string): Normative[];
  getComprehensiveNormativeContext(): string;
  loading: boolean;
}

// ─── Static Data — Normatives ─────────────────────────────────────────────

const NORMATIVES: Normative[] = [
  {
    id: 'ley-16744',
    code: 'LEY_16744',
    title: 'Ley 16.744 (1968) — Accidentes del Trabajo y Enfermedades Profesionales',
    category: 'fundacional',
    summary:
      'Ley marco que establece el seguro social obligatorio contra riesgos de accidentes del trabajo y enfermedades profesionales. Define obligaciones del empleador, derechos del trabajador, prestaciones médicas, indemnizaciones, sanciones y el sistema de mutualidades (ACHS, IST, Mutual de Seguridad).',
    keyArticles: [
      'Art. 3: Definición de accidente del trabajo y trayecto.',
      'Art. 7: Definición de enfermedad profesional.',
      'Art. 16: Obligación de cotización adicional diferenciada por riesgo.',
      'Art. 65: Obligación de confeccionar reglamento interno de higiene y seguridad.',
      'Art. 66: Comités Paritarios de Higiene y Seguridad obligatorios en empresas con ≥25 trabajadores.',
      'Art. 67: Departamentos de Prevención de Riesgos en empresas con ≥100 trabajadores.',
      'Art. 68: Obligación del empleador de adoptar medidas de higiene y seguridad.',
      'Art. 69: Responsabilidad civil y penal del empleador por accidentes por negligencia.',
      'Art. 71: Derecho del trabajador a negarse a trabajar en condiciones inseguras.',
      'Art. 76: Obligación de denunciar accidentes del trabajo al organismo administrador (DIAT).',
    ],
    searchTerms: [
      'accidente trabajo', 'enfermedad profesional', 'seguro laboral', 'mutualidad',
      'ACHS', 'IST', 'Mutual de Seguridad', 'comité paritario', 'CPHS',
      'prevención riesgos', 'cotización diferenciada', 'SUSESO',
    ],
  },
  {
    id: 'ds-101-1968',
    code: 'DS_101',
    title: 'DS 101/1968 — Reglamento para la aplicación de la Ley 16.744',
    category: 'fundacional',
    summary:
      'Reglamento que regula en detalle las prestaciones médicas, subsidios, indemnizaciones y pensiones derivadas de accidentes del trabajo y enfermedades profesionales. Establece plazos, procedimientos de denuncia (DIAT/DIEP) y responsabilidades del empleador y los organismos administradores.',
    keyArticles: [
      'Art. 71: Obligación del empleador de presentar la DIAT dentro de 24 horas del accidente.',
      'Art. 72: Contenido mínimo de la Declaración Individual de Accidente del Trabajo.',
      'Art. 73: Procedimiento de calificación del accidente como laboral o común.',
      'Art. 76: Reintegro de gastos médicos al trabajador en caso de urgencia.',
    ],
    searchTerms: [
      'DIAT', 'DIEP', 'declaración accidente', 'denuncia accidente', 'prestación médica',
      'subsidio', 'pensión invalidez', 'organismo administrador', 'reglamento 16744',
    ],
  },
  {
    id: 'ds-109-1968',
    code: 'DS_109',
    title: 'DS 109/1968 — Reglamento para la calificación y evaluación de enfermedades profesionales',
    category: 'fundacional',
    summary:
      'Establece el listado oficial de enfermedades profesionales en Chile y los criterios para su calificación y evaluación. Define los agentes causantes reconocidos (químicos, físicos, biológicos, ergonómicos y psicosociales) y los procedimientos de diagnóstico y calificación.',
    keyArticles: [
      'Art. 1: Lista de enfermedades profesionales reconocidas por la Ley 16.744.',
      'Art. 5: Procedimiento de calificación de enfermedad profesional por la COMPIN.',
      'Art. 7: Criterios de nexo causal entre trabajo y enfermedad.',
      'Art. 19: Revisión de la nómina de enfermedades profesionales cada 3 años.',
    ],
    searchTerms: [
      'enfermedad profesional', 'calificación', 'COMPIN', 'agente químico', 'agente físico',
      'silicosis', 'hipoacusia', 'neumoconiosis', 'dermatitis ocupacional', 'listado enfermedades',
    ],
  },
  {
    id: 'ds-44-2021',
    code: 'DS_44_2021',
    title: 'DS 44/2021 — Reglamento para la investigación de accidentes del trabajo',
    category: 'fundacional',
    summary:
      'Establece el procedimiento obligatorio de investigación de accidentes del trabajo y enfermedades profesionales. Define plazos, responsables, metodologías de investigación (árbol de causas) y la obligación de elaborar planes de acción correctiva.',
    keyArticles: [
      'Art. 3: Toda empresa debe investigar accidentes con incapacidad temporal, permanente o muerte.',
      'Art. 5: Plazo máximo de 24 horas para iniciar la investigación desde el accidente.',
      'Art. 8: El informe de investigación debe identificar causas básicas e inmediatas.',
      'Art. 11: El Comité Paritario debe revisar y aprobar el plan de acción correctiva.',
      'Art. 15: Envío de informe al organismo administrador dentro de los 5 días hábiles.',
    ],
    searchTerms: [
      'investigación accidente', 'árbol de causas', 'causa básica', 'causa inmediata',
      'plan correctivo', 'informe investigación', 'accidente fatal', 'accidente grave',
    ],
  },
  {
    id: 'ds-594-1999',
    code: 'DS_594',
    title: 'DS 594/1999 — Condiciones Sanitarias y Ambientales Básicas en los Lugares de Trabajo',
    category: 'higiene',
    summary:
      'Reglamento principal de higiene industrial en Chile. Regula las condiciones mínimas de higiene, seguridad, habitabilidad y salubridad en los lugares de trabajo, incluyendo límites permisibles de exposición a agentes químicos (LPP-TWA, LPP-TECHOS), físicos (ruido, calor, radiaciones) y biológicos.',
    keyArticles: [
      'Art. 19: Concentraciones máximas permisibles de contaminantes químicos (LPP-TWA y LPP-TECHOS).',
      'Art. 28: Límite de exposición a ruido: 85 dB(A) para jornada de 8 horas (criterio dosis).',
      'Art. 56: Temperatura en ambientes de trabajo: 10 °C mínimo, 30 °C máximo.',
      'Art. 66: Exposición a sílice libre cristalizada: obliga a programa de vigilancia PLANESI.',
      'Art. 70: Exposición a ruido sobre 85 dB(A): obliga a programa de vigilancia PREXOR.',
      'Art. 82: Iluminación mínima según tipo de tarea (100–1 000 lux).',
      'Art. 110bis: Evaluación ergonómica de tareas con movimientos repetitivos (TMERT-EESS).',
    ],
    searchTerms: [
      'higiene industrial', 'condiciones sanitarias', 'LPP', 'límite permisible', 'ruido laboral',
      'sílice', 'temperatura trabajo', 'iluminación', 'ergonomía', 'agente químico',
      'contaminante ambiental', 'polvo', 'fibras', 'vapores', 'material particulado',
    ],
  },
  {
    id: 'ds-298-1994',
    code: 'DS_298',
    title: 'DS 298/1994 — Reglamento de Prevención de Riesgos en Obras de Construcción',
    category: 'riesgos',
    summary:
      'Establece las condiciones mínimas de seguridad para obras de construcción, incluyendo andamios, excavaciones, demoliciones, trabajo en altura, uso de maquinaria pesada y gestión de residuos. Complementa la Ley 16.744 para el sector construcción.',
    keyArticles: [
      'Art. 4: Toda obra de construcción debe contar con un Prevencionista de Riesgos.',
      'Art. 14: Requisitos mínimos para andamios: resistencia, barandas y rodapiés.',
      'Art. 22: Protecciones para trabajo en altura mayor a 1,8 metros.',
      'Art. 44: Señalización de zonas de peligro y acceso restringido.',
      'Art. 55: Uso obligatorio de casco, guantes y zapatos de seguridad en toda la obra.',
    ],
    searchTerms: [
      'construcción', 'andamio', 'trabajo en altura', 'excavación', 'demolición',
      'maquinaria pesada', 'prevencionista', 'EPP construcción', 'obra',
    ],
  },
  {
    id: 'ds-132-2004',
    code: 'DS_132',
    title: 'DS 132/2004 — Reglamento de Seguridad Minera (SERNAGEOMIN)',
    category: 'sectorial',
    sector: 'mineria',
    summary:
      'Reglamento sectorial que establece las condiciones mínimas de seguridad para faenas mineras subterráneas y a cielo abierto. Regula ventilación, explosivos, equipos de protección personal específicos, planes de emergencia y evacuación, monitoreo de gases y polvo, y la fiscalización por parte de SERNAGEOMIN.',
    keyArticles: [
      'Art. 22: Plan de emergencia y evacuación obligatorio en toda faena minera.',
      'Art. 45: Ventilación mínima en labores subterráneas: 0,3 m³/s por trabajador.',
      'Art. 66: Monitoreo continuo de gases tóxicos (CO, SO₂, NO₂) en minería subterránea.',
      'Art. 89: Uso obligatorio de autocrescatadores en minería subterránea.',
      'Art. 103: Almacenamiento y uso de explosivos solo por personal autorizado.',
      'Art. 142: SERNAGEOMIN tiene potestad de paralizar faenas inseguras de forma inmediata.',
    ],
    searchTerms: [
      'minería', 'SERNAGEOMIN', 'faena minera', 'minería subterránea', 'cielo abierto',
      'explosivos', 'ventilación minas', 'gases mina', 'autocrescatador', 'silicosis mina',
    ],
  },
  {
    id: 'ds-977',
    code: 'DS_977',
    title: 'DS 977 — Reglamento Sanitario de los Alimentos (gastronomía/alimentación colectiva)',
    category: 'sectorial',
    sector: 'gastronomia',
    summary:
      'Regula las condiciones higiénico-sanitarias de establecimientos que producen, elaboran, envasan, almacenan, distribuyen y expenden alimentos. Aplica especialmente a empresas de alimentación colectiva (casinos, comedores industriales). Protege tanto a trabajadores del rubro como a los comensales.',
    keyArticles: [
      'Art. 9: Prohibición de trabajar con enfermedades transmisibles por alimentos.',
      'Art. 14: Uso obligatorio de uniforme limpio, cofia y guantes en manipulación.',
      'Art. 52: Temperaturas mínimas de cocción según tipo de alimento.',
      'Art. 69: Almacenamiento refrigerado de alimentos perecibles a ≤5 °C.',
      'Art. 107: Controles de calidad y registros de temperatura obligatorios.',
    ],
    searchTerms: [
      'gastronomía', 'manipulación alimentos', 'casino', 'comedor industrial', 'cocina',
      'inocuidad alimentaria', 'temperatura alimentos', 'manipulador alimentos', 'SEREMI salud',
    ],
  },
  {
    id: 'ley-21342',
    code: 'LEY_21342',
    title: 'Ley 21.342 — Protocolo de Seguridad Sanitaria Laboral COVID-19',
    category: 'higiene',
    summary:
      'Establece el protocolo de seguridad sanitaria laboral para el retorno gradual y seguro al trabajo durante la pandemia COVID-19. Obliga a empleadores a implementar medidas de distanciamiento físico, uso de mascarillas, ventilación, higiene de manos y sistemas de rastreo de contagios en el lugar de trabajo.',
    keyArticles: [
      'Art. 1: Obligatoriedad del Protocolo COVID para toda empresa en funcionamiento.',
      'Art. 3: Uso obligatorio de mascarilla en espacios cerrados de trabajo.',
      'Art. 5: Distanciamiento físico mínimo de 1 metro entre trabajadores.',
      'Art. 7: Ventilación adecuada de espacios interiores como medida preventiva.',
      'Art. 9: Trabajadores en grupos de riesgo tienen derecho a teletrabajo prioritario.',
    ],
    searchTerms: [
      'COVID', 'COVID-19', 'pandemia', 'mascarilla', 'distanciamiento', 'teletrabajo',
      'retorno trabajo', 'protocolo sanitario', 'contagio laboral', 'higiene manos',
    ],
  },
  {
    id: 'ley-21643',
    code: 'LEY_21643',
    title: 'Ley 21.643 (2024) — Ley Karin: Acoso Laboral y Sexual',
    category: 'riesgos',
    summary:
      'Conocida como Ley Karin, modifica el Código del Trabajo para reforzar la protección contra el acoso laboral (bullying), el acoso sexual y la violencia en el trabajo. Establece la obligación de los empleadores de implementar un protocolo de prevención, un canal de denuncia formal y procedimientos de investigación con perspectiva de género.',
    keyArticles: [
      'Art. 1: Definición ampliada de acoso laboral, acoso sexual y violencia en el trabajo.',
      'Art. 3: Obligación de incluir protocolo de acoso en el Reglamento Interno.',
      'Art. 4: Canal de denuncia confidencial obligatorio en toda empresa.',
      'Art. 5: Plazo máximo de 30 días hábiles para investigar denuncias de acoso.',
      'Art. 7: Perspectiva de género obligatoria en los procedimientos de investigación.',
      'Art. 9: Medidas de protección para la persona denunciante durante la investigación.',
    ],
    searchTerms: [
      'acoso laboral', 'acoso sexual', 'Ley Karin', 'violencia trabajo', 'bullying laboral',
      'protocolo acoso', 'denuncia acoso', 'perspectiva género', 'hostigamiento',
    ],
  },
  {
    id: 'circular-3767-suseso',
    code: 'CIRCULAR_3767',
    title: 'Circular 3767 SUSESO — Manual del Método ISTAS-21 (CoPsoQ)',
    category: 'minsal',
    summary:
      'Circular de SUSESO que establece el uso obligatorio del cuestionario ISTAS-21 (versión chilena del CoPsoQ) como instrumento estandarizado para la identificación y evaluación de riesgos psicosociales en el trabajo. Aplica a empresas con ≥25 trabajadores. Evalúa dimensiones como demandas cognitivas, control sobre el trabajo, apoyo social, doble presencia y estima.',
    keyArticles: [
      'Sección 2: Empresas con ≥25 trabajadores deben aplicar ISTAS-21 versión completa.',
      'Sección 3: Empresas con <25 trabajadores pueden usar la versión corta ISTAS-21.',
      'Sección 5: Participación mínima del 60% de los trabajadores para validez estadística.',
      'Sección 7: Resultados deben informarse al Comité Paritario y a los trabajadores.',
      'Sección 9: Plan de acción preventivo obligatorio si dimensiones en rango desfavorable.',
    ],
    searchTerms: [
      'ISTAS-21', 'CoPsoQ', 'riesgo psicosocial', 'estrés laboral', 'salud mental trabajo',
      'carga mental', 'control trabajo', 'apoyo social laboral', 'doble presencia',
      'cuestionario psicosocial', 'SUSESO psicosocial',
    ],
  },
  {
    id: 'prexor-2013',
    code: 'PREXOR',
    title: 'PREXOR 2013 — Protocolo de Exposición Ocupacional a Ruido',
    category: 'minsal',
    summary:
      'Protocolo del Ministerio de Salud (MINSAL) que establece la vigilancia ambiental y médica de trabajadores expuestos a ruido sobre 82 dB(A). Define los criterios para medición de ruido (dosimetría y sonometría), la periodicidad de audiometrías, los umbrales de acción y los límites de exposición, así como las medidas de control de acuerdo a la jerarquía de controles.',
    keyArticles: [
      'Sección 3: Nivel de acción: 82 dB(A) — inicio de programa de vigilancia.',
      'Sección 3: Límite de exposición ocupacional: 85 dB(A) en jornada de 8 horas.',
      'Sección 4: Audiometría de ingreso obligatoria para trabajadores expuestos.',
      'Sección 4: Audiometría anual para expuestos entre 82 y 85 dB(A).',
      'Sección 4: Audiometría semestral para expuestos sobre 85 dB(A).',
      'Sección 6: Medidas de control en orden de jerarquía: eliminación, sustitución, ingeniería, administrativos, EPP.',
    ],
    searchTerms: [
      'ruido', 'hipoacusia', 'audiometría', 'dosimetría', 'sonometría', 'dB', 'decibel',
      'pérdida auditiva', 'protector auditivo', 'tapón auditivo', 'PREXOR',
    ],
  },
  {
    id: 'planesi-2015',
    code: 'PLANESI',
    title: 'PLANESI 2015 — Plan Nacional de Erradicación de la Silicosis',
    category: 'minsal',
    summary:
      'Plan Nacional del Ministerio de Salud para eliminar la silicosis como enfermedad profesional en Chile para el año 2030. Establece la vigilancia epidemiológica de trabajadores expuestos a sílice libre cristalizada, con programas de radiografía de tórax, espirometría y medición ambiental de polvo con sílice. Sectores priorizados: minería, construcción, cerámica, vidrio y fundiciones.',
    keyArticles: [
      'Objetivo 1: Reducir la incidencia de silicosis en un 50% para 2020 (meta parcial).',
      'Componente 2: Vigilancia de trabajadores expuestos a sílice — radiografía de tórax cada 2 años.',
      'Componente 2: Espirometría obligatoria para trabajadores con ≥5 años de exposición.',
      'Componente 3: Medición ambiental de polvo respirable con sílice según DS 594 Art.66.',
      'Componente 4: Capacitación obligatoria a trabajadores y empleadores de sectores de riesgo.',
    ],
    searchTerms: [
      'silicosis', 'sílice', 'polvo sílice', 'radiografía tórax', 'espirometría',
      'minería silicosis', 'construcción silicosis', 'cerámica', 'neumoconiosis',
      'PLANESI', 'erradicación silicosis',
    ],
  },
  {
    id: 'tmert-eess-2012',
    code: 'TMERT_EESS',
    title: 'TMERT-EESS 2012 — Trastornos Musculoesqueléticos de Extremidades Superiores',
    category: 'minsal',
    summary:
      'Protocolo del Ministerio de Salud para la vigilancia de la salud de trabajadores expuestos a factores de riesgo de trastornos musculoesqueléticos en extremidades superiores (TMERT-EESS). Establece listas de chequeo ergonómico, criterios de evaluación de ciclos repetitivos, posturas forzadas, uso de fuerza y la periodicidad del examen físico.',
    keyArticles: [
      'Sección 2: Identificación de puestos de riesgo mediante lista de chequeo nivel básico.',
      'Sección 3: Evaluación detallada con método OCRA o similar para puestos con riesgo.',
      'Sección 4: Examen físico de extremidades superiores al ingreso y cada 2 años.',
      'Sección 5: Medidas de control: rediseño de puesto, rotación de tareas, pausas activas.',
      'Sección 6: Base legal: DS 594 Art. 110bis y Ley 16.744.',
    ],
    searchTerms: [
      'TMERT', 'musculoesquelético', 'extremidades superiores', 'ergonomía', 'movimiento repetitivo',
      'postura forzada', 'tendinitis', 'túnel carpiano', 'síndrome hombro', 'OCRA', 'carga física',
    ],
  },
];

// ─── Static Data — Protocols ──────────────────────────────────────────────

const PROTOCOLS: Protocol[] = [
  {
    id: 'proto-prexor',
    code: 'PREXOR',
    title: 'Vigilancia Audiométrica — Exposición Ocupacional a Ruido',
    type: 'surveillance',
    applicableTo: ['mineria', 'construccion', 'manufactura', 'gastronomia', 'transporte'],
    steps: [
      '1. Identificar puestos de trabajo con exposición potencial a ruido mediante encuesta inicial.',
      '2. Realizar medición ambiental de ruido (dosimetría o sonometría) en los puestos identificados.',
      '3. Si dosis de ruido ≥ 82 dB(A)-8h: incorporar al trabajador al programa de vigilancia PREXOR.',
      '4. Practicar audiometría tonal de ingreso (línea base) antes de iniciar exposición.',
      '5. Audiometría de control: anual (82–85 dB) o semestral (>85 dB).',
      '6. Evaluar resultados: cambio de umbral auditivo significativo (≥10 dB en alguna frecuencia).',
      '7. En caso de deterioro auditivo: reubicar al trabajador y notificar al organismo administrador.',
      '8. Implementar controles en jerarquía: ingeniería (aislamiento, sustitución) → administrativos (rotación) → EPP (protectores auditivos con atenuación verificada).',
      '9. Registrar todas las mediciones y audiometrías en la carpeta de salud ocupacional del trabajador.',
    ],
    legalBasis: 'DS 594/1999 Art. 70; PREXOR 2013 MINSAL; Ley 16.744 Art. 68',
  },
  {
    id: 'proto-planesi',
    code: 'PLANESI',
    title: 'Vigilancia Radiográfica y Espirométrica — Exposición a Polvo de Sílice',
    type: 'surveillance',
    applicableTo: ['mineria', 'construccion', 'ceramica', 'vidrio', 'fundicion'],
    steps: [
      '1. Identificar tareas con generación de polvo de sílice libre cristalizada (perforación, chancado, demolición, arenado).',
      '2. Medir concentración ambiental de polvo respirable con sílice según DS 594 Art. 66.',
      '3. Si concentración > 0,1 mg/m³ de sílice libre cristalizada: activar programa PLANESI.',
      '4. Realizar radiografía de tórax (OIT 2011) y espirometría de ingreso.',
      '5. Control radiológico cada 2 años para todos los expuestos.',
      '6. Espirometría cada 2 años; anual si ≥5 años de exposición.',
      '7. Notificar caso sospechoso de silicosis a SEREMI de Salud y al organismo administrador.',
      '8. Medidas de control prioritarias: sustitución de sílice, humectación de polvos, ventilación local exhaustora, cabinas cerradas con filtro HEPA.',
      '9. Proporcionar respirador con filtro P100 solo como último recurso; garantizar test de ajuste (fit test) anual.',
    ],
    legalBasis: 'DS 594/1999 Art. 66; PLANESI 2015 MINSAL; DS 109/1968; Ley 16.744',
  },
  {
    id: 'proto-tmert',
    code: 'TMERT_EESS',
    title: 'Evaluación Ergonómica — Trastornos Musculoesqueléticos de Extremidades Superiores',
    type: 'surveillance',
    applicableTo: ['manufactura', 'comercio', 'gastronomia', 'agricultura', 'salud', 'transporte'],
    steps: [
      '1. Aplicar lista de chequeo de nivel básico TMERT-EESS a todos los puestos con trabajo repetitivo.',
      '2. Puestos con riesgo identificado: realizar evaluación detallada con método OCRA o RULA/REBA.',
      '3. Determinar nivel de riesgo: aceptable, incierto, no tolerable.',
      '4. Practicar examen físico de extremidades superiores a trabajadores en riesgo al ingreso.',
      '5. Control médico anual o bienal según nivel de riesgo.',
      '6. Implementar medidas de control: rediseño de puesto (herramientas, altura de trabajo), rotación de tareas, micropaUsas y pausas activas.',
      '7. Capacitar a supervisores y trabajadores en técnicas de trabajo seguro y ejercicios preventivos.',
      '8. Registrar evaluaciones y controles médicos en la carpeta de salud ocupacional.',
    ],
    legalBasis: 'DS 594/1999 Art. 110bis; TMERT-EESS 2012 MINSAL; Ley 16.744 Art. 68',
  },
  {
    id: 'proto-evast',
    code: 'EVAST',
    title: 'Evaluación de Riesgos Psicosociales — Método ISTAS-21 (CoPsoQ)',
    type: 'surveillance',
    applicableTo: ['todas las empresas con ≥25 trabajadores'],
    steps: [
      '1. Constituir un Comité de Aplicación ISTAS-21 con representación paritaria (empleador y trabajadores).',
      '2. Adaptar el cuestionario ISTAS-21 a la realidad de la empresa (versión completa ≥25 trabajadores).',
      '3. Garantizar confidencialidad y anonimato absoluto en la aplicación del cuestionario.',
      '4. Aplicar el cuestionario a todos los trabajadores; meta: participación ≥60% para validez.',
      '5. Procesar resultados con el software oficial ISTAS-21 y calcular prevalencias por unidad.',
      '6. Presentar resultados al Comité Paritario y a los trabajadores en reunión informativa.',
      '7. Identificar dimensiones en rango desfavorable (rojo) o intermedio (amarillo) como prioridad.',
      '8. Elaborar plan de acción preventivo para dimensiones desfavorables con responsables y plazos.',
      '9. Reevaluar con ISTAS-21 cada 2 años o tras cambios organizacionales significativos.',
    ],
    legalBasis: 'Circular 3767 SUSESO; Ley 16.744 Art. 68; Ley 21.643 (Ley Karin)',
  },
  {
    id: 'proto-diat',
    code: 'DIAT',
    title: 'Investigación y Declaración de Accidente del Trabajo (DIAT) para SUSESO',
    type: 'investigation',
    applicableTo: ['todas las empresas'],
    steps: [
      '1. Brindar primeros auxilios al trabajador accidentado y trasladarlo al organismo administrador (ACHS/IST/Mutual/INP) más cercano.',
      '2. Asegurar y preservar la escena del accidente para la investigación; no alterar evidencias.',
      '3. Notificar al empleador, supervisor directo y Comité Paritario dentro de las primeras 2 horas.',
      '4. Completar la Declaración Individual de Accidente del Trabajo (DIAT) dentro de las 24 horas.',
      '5. Presentar la DIAT al organismo administrador correspondiente (ACHS, IST, Mutual o INP).',
      '6. Iniciar la investigación del accidente dentro de las 24 horas siguientes al evento.',
      '7. Aplicar metodología de análisis de causas (árbol de causas, 5 porqués o similar).',
      '8. Identificar causas básicas (factores humanos y de trabajo) y causas inmediatas (actos y condiciones inseguras).',
      '9. Elaborar informe de investigación con plan de acción correctiva (responsables, plazos, recursos).',
      '10. Remitir informe al organismo administrador dentro de 5 días hábiles del accidente.',
      '11. Implementar y verificar el cumplimiento de las medidas correctivas.',
      '12. Presentar resultados en reunión mensual del Comité Paritario.',
    ],
    legalBasis: 'DS 101/1968 Art. 71-73; DS 44/2021; Ley 16.744 Art. 76; Circular 2345 SUSESO',
  },
];

// ─── Context ──────────────────────────────────────────────────────────────

const NormativeCtx = createContext<NormativeContextType | null>(null);

// ─── Helper functions (pure, outside provider) ────────────────────────────

function searchNormativesImpl(query: string, normatives: Normative[]): Normative[] {
  if (!query.trim()) return normatives;
  const q = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return normatives.filter((n) => {
    const haystack = [
      n.title,
      n.summary,
      n.code,
      ...(n.searchTerms ?? []),
    ]
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return haystack.includes(q);
  });
}

function searchProtocolsImpl(query: string, protocols: Protocol[]): Protocol[] {
  if (!query.trim()) return protocols;
  const q = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return protocols.filter((p) => {
    const haystack = [
      p.title,
      p.code,
      p.legalBasis,
      ...p.applicableTo,
      ...p.steps,
    ]
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return haystack.includes(q);
  });
}

function getComprehensiveNormativeContextImpl(): string {
  const fundacionales = NORMATIVES.filter((n) => n.category === 'fundacional');
  const higiene = NORMATIVES.filter((n) => n.category === 'higiene');
  const riesgos = NORMATIVES.filter((n) => n.category === 'riesgos');
  const sectorial = NORMATIVES.filter((n) => n.category === 'sectorial');
  const minsal = NORMATIVES.filter((n) => n.category === 'minsal');

  const formatNormative = (n: Normative): string => {
    const arts =
      n.keyArticles.length > 0
        ? ` | Arts. clave: ${n.keyArticles.join(' · ')}`
        : '';
    return `- ${n.code} — ${n.title}: ${n.summary}${arts}`;
  };

  const formatProtocol = (p: Protocol): string => {
    const resumen = p.steps[0] ?? '';
    return `- ${p.code}: ${p.title} | Pasos clave: ${resumen} (…${p.steps.length} pasos) | Base: ${p.legalBasis}`;
  };

  const sections: string[] = [
    '## MARCO LEGAL CHILENO — SEGURIDAD Y SALUD OCUPACIONAL',
    '',
    '### Legislación Fundacional',
    ...fundacionales.map(formatNormative),
    '',
    '### Higiene Industrial',
    ...higiene.map(formatNormative),
    '',
    '### Prevención de Riesgos Laborales',
    ...riesgos.map(formatNormative),
    '',
    '### Normativa Sectorial',
    ...sectorial.map(formatNormative),
    '',
    '### Protocolos MINSAL Activos',
    ...minsal.map(formatNormative),
    '',
    '### Protocolos Técnicos de Vigilancia e Investigación',
    ...PROTOCOLS.map(formatProtocol),
    '',
    '---',
    'Contexto normativo generado automáticamente desde la base de conocimiento de Guardian-Praeventio.',
    'Siempre verificar vigencia de la normativa con la versión oficial publicada en el Diario Oficial de Chile.',
  ];

  return sections.join('\n');
}

// ─── Provider ─────────────────────────────────────────────────────────────

export function NormativeProvider({ children }: { children: ReactNode }) {
  const searchNormatives = (query: string) =>
    searchNormativesImpl(query, NORMATIVES);

  const searchProtocols = (query: string) =>
    searchProtocolsImpl(query, PROTOCOLS);

  const getNormativeByCode = (code: string) =>
    NORMATIVES.find((n) => n.code === code);

  const getNormativesByCategory = (cat: string) =>
    NORMATIVES.filter((n) => n.category === cat);

  const getNormativesBySector = (sector: string) =>
    NORMATIVES.filter((n) => n.sector === sector);

  const getRelatedNormatives = (id: string): Normative[] => {
    const target = NORMATIVES.find((n) => n.id === id);
    if (!target) return [];
    // Related = same category or same sector (excluding itself)
    return NORMATIVES.filter(
      (n) =>
        n.id !== id &&
        (n.category === target.category ||
          (target.sector !== undefined && n.sector === target.sector)),
    );
  };

  const value: NormativeContextType = {
    normatives: NORMATIVES,
    protocols: PROTOCOLS,
    searchNormatives,
    searchProtocols,
    getNormativeByCode,
    getNormativesByCategory,
    getNormativesBySector,
    getRelatedNormatives,
    getComprehensiveNormativeContext: getComprehensiveNormativeContextImpl,
    loading: false,
  };

  return <NormativeCtx.Provider value={value}>{children}</NormativeCtx.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useNormative(): NormativeContextType {
  const ctx = useContext(NormativeCtx);
  if (!ctx) throw new Error('useNormative must be used inside <NormativeProvider>');
  return ctx;
}

// ─── Legacy exports (backward-compat with existing code that imports these) ─

/** @deprecated Use `Normative` interface instead. */
export type NormativeEntry = Normative;

/** @deprecated Use `useNormative().normatives` instead. */
export const NORMATIVE_DB: Normative[] = NORMATIVES;

/** @deprecated Use `useNormative().getComprehensiveNormativeContext()` instead. */
export const getComprehensiveNormativeContext = getComprehensiveNormativeContextImpl;

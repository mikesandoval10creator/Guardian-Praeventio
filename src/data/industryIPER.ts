
export interface IPERBaseNode {
  title: string;
  actividad: string;
  description: string; // This will be the "Peligro"
  riesgo: string;
  consecuencia: string;
  probabilidad: number;
  severidad: number;
  controles: string;
  tags: string[];
}

export const INDUSTRY_IPER_BASE: Record<string, IPERBaseNode[]> = {
  'GP-CONS-EDI: Construcción de edificios': [
    {
      title: "Trabajo en Altura (>1.8m)",
      actividad: "Instalación de estructuras en niveles superiores",
      description: "Trabajo en bordes de losa o andamios sin protección",
      riesgo: "Caída a distinto nivel",
      consecuencia: "Fracturas, traumatismos craneales, muerte",
      probabilidad: 3,
      severidad: 5,
      controles: "Arnés de seguridad de 3 puntas, línea de vida certificada, capacitación en altura física, instalación de barandas perimetrales.",
      tags: ["construccion", "altura", "iper"]
    },
    {
      title: "Excavaciones y Zanjas",
      actividad: "Preparación de fundaciones y trazado de servicios",
      description: "Paredes de excavación inestables o sin soporte",
      riesgo: "Derrumbe / Atrapamiento",
      consecuencia: "Asfixia, aplastamiento, muerte",
      probabilidad: 2,
      severidad: 5,
      controles: "Entibación según norma, delimitación de área con mallas, inspección diaria de taludes por supervisor.",
      tags: ["construccion", "excavacion", "iper"]
    },
    {
      title: "Manejo de Cargas Suspendidas",
      actividad: "Izaje de materiales con grúa torre",
      description: "Falla en elementos de sujeción o mala estiba",
      riesgo: "Caída de objetos / Golpeado por",
      consecuencia: "Contusiones graves, muerte, daños materiales",
      probabilidad: 2,
      severidad: 5,
      controles: "Certificación de elementos de izaje, rigger calificado, radio de giro despejado y señalizado.",
      tags: ["construccion", "izaje", "iper"]
    }
  ],
  'GP-MIN-MET: Extracción de minerales metalíferos': [
    {
      title: "Operación de Maquinaria Pesada",
      actividad: "Transporte de mineral en rajo abierto",
      description: "Puntos ciegos en camiones de alto tonelaje",
      riesgo: "Atropello / Colisión",
      consecuencia: "Muerte, destrucción de equipo",
      probabilidad: 2,
      severidad: 5,
      controles: "Sistemas de proximidad (CAS), cámaras 360°, segregación estricta de rutas, check-list de fatiga.",
      tags: ["mineria", "maquinaria", "iper"]
    },
    {
      title: "Exposición a Polvo de Sílice",
      actividad: "Procesamiento de mineral en chancado",
      description: "Generación de material particulado fino",
      riesgo: "Inhalación de sílice libre cristalina",
      consecuencia: "Silicosis, enfermedades respiratorias crónicas",
      probabilidad: 4,
      severidad: 4,
      controles: "Sistemas de supresión de polvo (neblina), cabinas presurizadas, protección respiratoria P100 con prueba de ajuste.",
      tags: ["mineria", "silice", "iper"]
    },
    {
      title: "Desprendimiento de Rocas (Planchoneo)",
      actividad: "Avance en galerías subterráneas",
      description: "Inestabilidad del macizo rocoso",
      riesgo: "Caída de rocas",
      consecuencia: "Aplastamiento, atrapamiento, muerte",
      probabilidad: 3,
      severidad: 5,
      controles: "Acuñadura manual/mecanizada, fortificación (pernos/malla/shotcrete), monitoreo geotécnico en tiempo real.",
      tags: ["mineria", "geotecnia", "iper"]
    }
  ],
  'GP-TRANS-TER: Transporte por vía terrestre y por tuberías': [
    {
      title: "Fatiga y Somnolencia",
      actividad: "Conducción de larga distancia",
      description: "Exceso de horas de conducción sin descanso",
      riesgo: "Accidente de tránsito / Volcamiento",
      consecuencia: "Muerte, lesiones graves, pérdida de carga",
      probabilidad: 4,
      severidad: 5,
      controles: "Control de jornada (pausas obligatorias), sensores de fatiga, monitoreo GPS con alertas de velocidad.",
      tags: ["transporte", "fatiga", "iper"]
    },
    {
      title: "Carga y Descarga de Mercancías",
      actividad: "Manipulación de bultos en bodega",
      description: "Posturas forzadas y pesos excesivos",
      riesgo: "Sobreesfuerzo / Caída de objetos",
      consecuencia: "Lumbago, hernias, contusiones",
      probabilidad: 4,
      severidad: 3,
      controles: "Uso de transpaletas/grúas horquilla, capacitación en manejo manual de cargas (Ley 20.001), uso de faja lumbar (opcional).",
      tags: ["transporte", "logistica", "iper"]
    }
  ],
  'GP-AGR-CULT: Cultivos anuales y permanentes': [
    {
      title: "Exposición a Plaguicidas",
      actividad: "Aplicación de fitosanitarios",
      description: "Contacto directo o inhalación de químicos",
      riesgo: "Intoxicación aguda / crónica",
      consecuencia: "Daño orgánico, dermatitis, muerte",
      probabilidad: 3,
      severidad: 4,
      controles: "Traje Tyvek, máscara con filtros químicos, tiempos de reentrada señalizados, capacitación REAS.",
      tags: ["agricultura", "quimico", "iper"]
    },
    {
      title: "Radiación UV de Origen Solar",
      actividad: "Cosecha y labores de campo",
      description: "Exposición prolongada a rayos UV",
      riesgo: "Insolación / Cáncer de piel",
      consecuencia: "Quemaduras solares, daño ocular, cáncer",
      probabilidad: 5,
      severidad: 3,
      controles: "Uso de bloqueador solar FPS 50+, ropa de manga larga, legionario, hidratación constante cada 20 min.",
      tags: ["agricultura", "uv", "iper"]
    }
  ],
  'GP-MANU-ALI: Productos alimenticios': [
    {
      title: "Exposición a Bajas Temperaturas",
      actividad: "Almacenamiento en cámaras frías",
      description: "Permanencia en ambientes bajo 0°C",
      riesgo: "Hipotermia / Congelamiento",
      consecuencia: "Lesiones en extremidades, shock térmico",
      probabilidad: 3,
      severidad: 4,
      controles: "Ropa térmica certificada, tiempos de permanencia limitados, sistema de apertura interior de seguridad.",
      tags: ["manufactura", "alimentos", "frio"]
    },
    {
      title: "Atrapamiento en Maquinaria",
      actividad: "Operación de líneas de envasado",
      description: "Partes móviles sin resguardos",
      riesgo: "Atrapamiento / Amputación",
      consecuencia: "Pérdida de miembros, muerte",
      probabilidad: 2,
      severidad: 5,
      controles: "Protecciones fijas, paradas de emergencia accesibles, procedimiento LOTO (Bloqueo/Etiquetado).",
      tags: ["manufactura", "alimentos", "maquinaria"]
    }
  ],
  'GP-COM-MEN: Comercio al por menor': [
    {
      title: "Asaltos y Violencia de Terceros",
      actividad: "Atención de público y manejo de caja",
      description: "Exposición a actos delictivos",
      riesgo: "Agresión física / Trauma psicológico",
      consecuencia: "Lesiones, estrés post-traumático",
      probabilidad: 3,
      severidad: 4,
      controles: "Cámaras de vigilancia, botón de pánico, capacitación en manejo de conflictos y protocolo de asalto.",
      tags: ["comercio", "seguridad", "iper"]
    },
    {
      title: "Caídas al mismo nivel",
      actividad: "Reposición de productos en sala",
      description: "Pisos resbaladizos o con obstáculos",
      riesgo: "Resbalón / Tropezón",
      consecuencia: "Esguinces, contusiones",
      probabilidad: 4,
      severidad: 2,
      controles: "Señalética de piso húmedo, calzado antideslizante, limpieza inmediata de derrames, pasillos despejados.",
      tags: ["comercio", "caidas", "iper"]
    }
  ],
  'General': [
    {
      title: "Desarrollo y Gestión (Oficina)",
      actividad: "Trabajo administrativo frente a PC",
      description: "Postura sedentaria prolongada",
      riesgo: "Trastornos Musculoesqueléticos",
      consecuencia: "Tendinitis, dolor lumbar, fatiga visual",
      probabilidad: 3,
      severidad: 3,
      controles: "Silla ergonómica certificada, Pausas Activas cada 2 horas, ajuste de altura de monitor.",
      tags: ["iper", "ergonomia", "oficina"]
    },
    {
      title: "Visitas Técnicas a Faena",
      actividad: "Supervisión de terreno",
      description: "Superficies irregulares / Obstáculos",
      riesgo: "Caída al mismo nivel",
      consecuencia: "Esguinces, fracturas leves",
      probabilidad: 4,
      severidad: 3,
      controles: "Uso obligatorio de zapato de seguridad, inducción de área, tránsito por sendas peatonales habilitadas.",
      tags: ["iper", "terreno", "caidas"]
    }
  ],

  // ──────────────────────────────────────────────────────────────────────
  // Bloque 8.5 (D-IND) 2026-05-20 — expansión catálogo industrias SII.
  // Agregadas 10 industrias críticas chilenas para reducir gap del audit
  // §32 (real: 6 industrias vs promesa 500+). Estas 10 cubren ~40% del
  // PIB chileno por presencia de trabajadores formales. Fuentes IPER:
  // NIOSH/OSHA + ACHS + Mutual de Seguridad referenciales.
  // ──────────────────────────────────────────────────────────────────────

  'GP-PESCA-EXT: Pesca extractiva y acuicultura': [
    {
      title: "Trabajo en cubierta húmeda",
      actividad: "Faenas de pesca en alta mar / centros de cultivo",
      description: "Superficies resbalosas + maquinaria en movimiento",
      riesgo: "Caída al mar / golpe contra estructura",
      consecuencia: "Ahogamiento, traumatismos, hipotermia",
      probabilidad: 3,
      severidad: 5,
      controles: "Chaleco salvavidas SOLAS, calzado antideslizante, harness con punto de anclaje, capacitación rescate náutico, simulacros mensuales.",
      tags: ["pesca", "acuicultura", "agua", "iper"]
    },
    {
      title: "Manipulación de redes y artes de pesca",
      actividad: "Calado y virado de redes de cerco o arrastre",
      description: "Cabos tensionados / poleas + winches operativos",
      riesgo: "Atrapamiento / latigazo de cabo",
      consecuencia: "Amputación, contusiones graves",
      probabilidad: 2,
      severidad: 5,
      controles: "Procedimiento de calado paso a paso, distancia mínima a cabos en tensión, paro de winch antes de manipulación manual, EPP guantes anti-corte.",
      tags: ["pesca", "atrapamiento", "iper"]
    },
    {
      title: "Exposición a frío extremo (procesamiento)",
      actividad: "Salas de proceso y túneles de congelado -25°C",
      description: "Permanencia prolongada en cámaras frigoríficas",
      riesgo: "Hipotermia / congelación periférica",
      consecuencia: "Lesiones por frío, trastornos cardiovasculares",
      probabilidad: 3,
      severidad: 3,
      controles: "Rotación de personal cada 25 minutos, EPP térmico certificado, pausas activas en sala temperada, exámenes pre-ocupacionales (DS 594 art. 96).",
      tags: ["pesca", "frio", "termico", "iper"]
    }
  ],

  'GP-FOR-SILV: Silvicultura y extracción forestal': [
    {
      title: "Operación de motosierra",
      actividad: "Volteo y desramado de árboles",
      description: "Cadena en rotación + caída del fuste",
      riesgo: "Corte profundo / aplastamiento por caída de árbol",
      consecuencia: "Amputación, traumatismos múltiples, muerte",
      probabilidad: 3,
      severidad: 5,
      controles: "Capacitación certificada motosierrista, EPP pantalón anti-corte clase 1+, casco con visor + protector auditivo, distancia mínima 1.5× altura árbol entre operarios.",
      tags: ["forestal", "motosierra", "iper"]
    },
    {
      title: "Caída de árboles en zona de corta",
      actividad: "Volteo dirigido en pendiente",
      description: "Ramas muertas que se desprenden / dirección de caída errónea",
      riesgo: "Golpe por caída de objetos",
      consecuencia: "Traumatismo craneoencefálico, muerte",
      probabilidad: 2,
      severidad: 5,
      controles: "Plan de tala diaria, despejado de zona en 360°, comunicación VHF, supervisor en cada cuadrilla.",
      tags: ["forestal", "caida-objetos", "iper"]
    },
    {
      title: "Incendio forestal por chispa",
      actividad: "Operación de equipos en bosque seco verano",
      description: "Fricción metal-piedra / fuga de combustible",
      riesgo: "Incendio rápido propagación",
      consecuencia: "Quemaduras graves, asfixia, muerte",
      probabilidad: 2,
      severidad: 5,
      controles: "Prohibición de fuego, equipos con matachispas, brigada incendios in situ, plan emergencia incendio forestal (CONAF), no operar T>28°C+viento>30 km/h.",
      tags: ["forestal", "incendio", "iper"]
    }
  ],

  'GP-PORT-SERV: Servicios portuarios y estiba': [
    {
      title: "Estiba con grúa pórtico",
      actividad: "Carga/descarga de contenedores",
      description: "Spreader sobre contenedor + spreader-twist-locks",
      riesgo: "Caída de contenedor / aplastamiento",
      consecuencia: "Muerte, daño material catastrófico",
      probabilidad: 2,
      severidad: 5,
      controles: "Operador certificado grúa pórtico, doble verificación twist-locks por señalero, zona de exclusión radio 1.5× altura, comunicación VHF canal dedicado.",
      tags: ["portuario", "izaje", "iper"]
    },
    {
      title: "Atropello por equipo móvil terminal",
      actividad: "Operación de straddle-carriers / reach stackers",
      description: "Equipo ciego de alta tonelaje en patio",
      riesgo: "Atropellamiento / aplastamiento",
      consecuencia: "Muerte instantánea",
      probabilidad: 2,
      severidad: 5,
      controles: "Vías peatonales señalizadas y semaforizadas, chalecos alta visibilidad reflectante Clase 3, sistema anti-colisión LIDAR/RFID, velocidad ≤15 km/h.",
      tags: ["portuario", "atropello", "iper"]
    },
    {
      title: "Exposición a químicos en derrame de carga",
      actividad: "Estiba de contenedores con sustancias peligrosas",
      description: "Fuga durante manipulación / rotura de IBC",
      riesgo: "Intoxicación química",
      consecuencia: "Quemaduras químicas, intoxicación aguda",
      probabilidad: 1,
      severidad: 5,
      controles: "Plan IMDG vigente, brigada Hazmat 24/7, ducha de emergencia ≤15s recorrido, FDS accesibles cada celda, simulacros derrame trimestrales.",
      tags: ["portuario", "hazmat", "iper"]
    }
  ],

  'GP-ELEC-DIST: Generación y distribución eléctrica': [
    {
      title: "Trabajo en líneas energizadas (MT/AT)",
      actividad: "Mantenimiento de redes de distribución",
      description: "Líneas 13.2 kV / 23 kV en operación",
      riesgo: "Contacto eléctrico directo",
      consecuencia: "Electrocución, quemaduras grado 4, muerte",
      probabilidad: 2,
      severidad: 5,
      controles: "Procedimiento LOTO certificado, EPP dieléctrico clase 2 (testeado anualmente), 5 reglas de oro SEC, autorización supervisor T+1, comprobación ausencia tensión.",
      tags: ["electrico", "loto", "alta-tension", "iper"]
    },
    {
      title: "Caída desde poste o estructura",
      actividad: "Trabajo en altura sobre postes de concreto/madera",
      description: "Subida con trepadores / canasta hidráulica",
      riesgo: "Caída a distinto nivel",
      consecuencia: "Politraumatismo, fracturas, muerte",
      probabilidad: 2,
      severidad: 5,
      controles: "Arnés cuerpo entero + doble línea de vida, inspección poste pre-ascenso, canasta certificada con anclaje, capacitación altura física + curso poste.",
      tags: ["electrico", "altura", "iper"]
    },
    {
      title: "Arco eléctrico (flash)",
      actividad: "Apertura de seccionadores en subestación",
      description: "Falla de aislación / cortocircuito instantáneo",
      riesgo: "Quemadura por arco eléctrico",
      consecuencia: "Quemaduras térmicas, daño retiniano, muerte",
      probabilidad: 1,
      severidad: 5,
      controles: "Análisis de incidente energía arco (IEEE 1584), EPP categoría adecuada según estudio (FR rating), distancia segura, operación remota cuando aplique.",
      tags: ["electrico", "arco", "iper"]
    }
  ],

  'GP-QUIM-IND: Industria química y petroquímica': [
    {
      title: "Manipulación de sustancias corrosivas",
      actividad: "Trasvasije ácidos / bases concentradas",
      description: "Salpicaduras durante apertura/conexión líneas",
      riesgo: "Quemadura química / inhalación vapores",
      consecuencia: "Quemaduras grado 3, daño respiratorio, ceguera",
      probabilidad: 3,
      severidad: 5,
      controles: "Sistema cerrado de trasvasije, EPP químico clase B (traje + careta + guantes), ducha lavaojos ≤15s, FDS cada contenedor, ventilación forzada local.",
      tags: ["quimico", "corrosivo", "iper"]
    },
    {
      title: "Reacciones químicas descontroladas",
      actividad: "Operación de reactores / mezcladores",
      description: "Pérdida de control térmico / agitación / presión",
      riesgo: "Explosión / liberación masiva tóxica",
      consecuencia: "Multifatalidad, contaminación ambiental",
      probabilidad: 1,
      severidad: 5,
      controles: "Estudio HAZOP actualizado, SIL 2+ instrumentación crítica, válvulas alivio dimensionadas, plan emergencia comunidad informada, simulacros trimestrales.",
      tags: ["quimico", "proceso", "iper"]
    },
    {
      title: "Atmósferas inflamables / explosivas",
      actividad: "Almacenamiento y trasvasije de solventes",
      description: "Vapores inflamables + fuentes de ignición",
      riesgo: "Incendio / explosión BLEVE",
      consecuencia: "Quemaduras, muerte, daño catastrófico",
      probabilidad: 1,
      severidad: 5,
      controles: "Clasificación ATEX zonas, equipamiento Ex aplicable, puesta a tierra, control electrostático, prohibición chispas, detección gases LEL%, sistema espuma.",
      tags: ["quimico", "atex", "iper"]
    }
  ],

  'GP-PAPEL-CEL: Papel y celulosa': [
    {
      title: "Atrapamiento en rodillos de máquina papelera",
      actividad: "Operación y limpieza de máquina formadora",
      description: "Rodillos en rotación + papel en banda",
      riesgo: "Atrapamiento / amputación",
      consecuencia: "Amputación de extremidad, muerte",
      probabilidad: 2,
      severidad: 5,
      controles: "Resguardos fijos + foto-celdas paro emergencia, LOTO completo antes de mantención, capacitación operario máquina, EPP sin elementos sueltos.",
      tags: ["celulosa", "atrapamiento", "iper"]
    },
    {
      title: "Exposición a químicos del proceso Kraft",
      actividad: "Manipulación de licor blanco/negro/verde",
      description: "Vapores sulfurados (TRS), soda cáustica caliente",
      riesgo: "Intoxicación H2S / quemadura cáustica",
      consecuencia: "Daño respiratorio crónico, quemaduras",
      probabilidad: 2,
      severidad: 5,
      controles: "Detector portátil H2S calibrado, rescate confinado entrenado, ducha lavaojos en cada turno, ventilación local máxima, EPP químico + respiradores.",
      tags: ["celulosa", "kraft", "iper"]
    },
    {
      title: "Caída en piscinas de proceso",
      actividad: "Inspección de digestores / clarificadores",
      description: "Pasarelas resbaladizas + falta de barandas",
      riesgo: "Caída a líquido caliente / ahogamiento",
      consecuencia: "Quemaduras + asfixia, muerte",
      probabilidad: 1,
      severidad: 5,
      controles: "Barandas cumplir DS 594, pasarelas antideslizantes, arnés con línea horizontal en bordes, prohibición de circular solo, sistema rescate vertical.",
      tags: ["celulosa", "caida", "iper"]
    }
  ],

  'GP-SALUD-HOSP: Salud (hospitales y clínicas)': [
    {
      title: "Exposición a agentes biológicos",
      actividad: "Atención clínica + manejo de fluidos corporales",
      description: "Punciones con jeringas / aerosoles infecciosos",
      riesgo: "Infección por VIH / VHB / VHC / TB / SARS-CoV-2",
      consecuencia: "Enfermedad infecciosa, riesgo vital",
      probabilidad: 3,
      severidad: 5,
      controles: "Precauciones estándar OMS, EPP categoría según riesgo, contenedores corto-punzantes certificados, vacunación VHB anual, protocolo post-exposición ≤2h.",
      tags: ["salud", "biologico", "iper"]
    },
    {
      title: "Sobrecarga musculoesquelética (movilización pacientes)",
      actividad: "Traslados de pacientes camilla-cama-baño",
      description: "Pacientes >80 kg + esfuerzo postural",
      riesgo: "Lumbalgia / hernias discales",
      consecuencia: "Incapacidad laboral, dolor crónico",
      probabilidad: 4,
      severidad: 3,
      controles: "Grúas mecánicas / discos deslizantes, técnica de transferencia certificada, dotación 2+ personas pacientes dependientes, evaluación ergonómica (DS 594 art. 110 Bis).",
      tags: ["salud", "ergonomia", "iper"]
    },
    {
      title: "Violencia ocupacional (pacientes/familiares)",
      actividad: "Urgencias / psiquiatría / consulta primer contacto",
      description: "Pacientes alterados / familiares agresivos",
      riesgo: "Agresión física o verbal",
      consecuencia: "Lesiones físicas + trauma psicológico",
      probabilidad: 4,
      severidad: 3,
      controles: "Protocolo de des-escalada, botón pánico vinculado a seguridad, sala con cámara y vidrio templado, capacitación violencia laboral, MINSAL Norma General Técnica 195.",
      tags: ["salud", "violencia", "iper"]
    }
  ],

  'GP-LOG-BOD: Logística y bodegaje': [
    {
      title: "Atropello por equipo móvil bodega",
      actividad: "Operación de grúas horquilla / orderpickers",
      description: "Trabajadores peatones en pasillos compartidos",
      riesgo: "Atropello / aplastamiento",
      consecuencia: "Muerte instantánea",
      probabilidad: 3,
      severidad: 5,
      controles: "Pasillos peatonales segregados, velocidad ≤8 km/h, alarma de retroceso + luz azul/roja proyectada, capacitación operador (Ley 18.290), chalecos alta visibilidad.",
      tags: ["logistica", "atropello", "iper"]
    },
    {
      title: "Caída de carga desde rack altura",
      actividad: "Almacenamiento en estanterías selectivas >4m",
      description: "Carga mal estibada / impacto de grúa contra rack",
      riesgo: "Caída de objetos sobre trabajador",
      consecuencia: "Traumatismo, muerte",
      probabilidad: 2,
      severidad: 5,
      controles: "Inspección racks trimestral (UNE-EN 15635), redes anticaída, columna protectora base estantería, capacitación estiba, plan re-evaluación post-impacto.",
      tags: ["logistica", "caida-objetos", "iper"]
    },
    {
      title: "Trastornos musculoesqueléticos por levantamiento manual",
      actividad: "Picking de unidades sueltas / pallet completo",
      description: "Cargas >25 kg + frecuencia alta",
      riesgo: "Lumbalgia / hernia inguinal",
      consecuencia: "Enfermedad profesional",
      probabilidad: 4,
      severidad: 3,
      controles: "Aplicación DS 63 (Ley 20.001), ayudas mecánicas, rotación tareas, capacitación técnica levantamiento, evaluación MAC/REBA semestral.",
      tags: ["logistica", "ergonomia", "iper"]
    }
  ],

  'GP-HOSP-TUR: Hostelería y turismo': [
    {
      title: "Quemaduras en cocina industrial",
      actividad: "Manipulación de freidoras / planchas / hornos",
      description: "Aceite caliente >180°C / superficies expuestas",
      riesgo: "Quemadura térmica",
      consecuencia: "Quemaduras grado 2-3, incapacidad temporal",
      probabilidad: 3,
      severidad: 3,
      controles: "EPP delantal anti-salpicaduras, guantes térmicos, capacitación uso freidora, prohibición agua cerca aceite, extintor clase K accesible.",
      tags: ["hosteleria", "termico", "iper"]
    },
    {
      title: "Cortes con cuchillería profesional",
      actividad: "Corte de proteínas y vegetales",
      description: "Cuchillos afilados + ritmo alto producción",
      riesgo: "Corte profundo en manos",
      consecuencia: "Heridas con compromiso tendinoso",
      probabilidad: 4,
      severidad: 3,
      controles: "Guante anti-corte malla acero, tabla con tope anti-deslizante, capacitación técnica cortes, primera auxilios accesible, afilado regular (cuchillo desafilado = más accidentes).",
      tags: ["hosteleria", "cortes", "iper"]
    },
    {
      title: "Resbalones en superficies húmedas",
      actividad: "Cocina + bar + áreas de servicio post-limpieza",
      description: "Pisos mojados + grasa + alta circulación",
      riesgo: "Caída mismo nivel",
      consecuencia: "Esguinces, fracturas leves, lesiones cervicales",
      probabilidad: 4,
      severidad: 2,
      controles: "Calzado antideslizante SRC, señalización inmediata piso mojado, pavimento R10+ en cocinas, secado en tiempo real, capacitación postura/marcha.",
      tags: ["hosteleria", "caidas", "iper"]
    }
  ],

  'GP-EDU-EST: Educación (establecimientos)': [
    {
      title: "Estrés psicosocial por carga laboral docente",
      actividad: "Planificación + clase + evaluación + atención apoderados",
      description: "Jornada extendida + sobrecarga emocional + ratio alumnos:docente alto",
      riesgo: "Síndrome burnout / depresión",
      consecuencia: "Enfermedad profesional Ley 16.744",
      probabilidad: 4,
      severidad: 3,
      controles: "Protocolo CEAL-SM SUSESO obligatorio, pausas activas, intervenciones colectivas, programa Apoyo Psicológico, máximo 35 hrs lectivas/semana (Estatuto Docente).",
      tags: ["educacion", "psicosocial", "iper"]
    },
    {
      title: "Voz profesional (disfonía)",
      actividad: "Docencia frontal en sala de clases",
      description: "Uso prolongado de voz alta + acústica deficiente",
      riesgo: "Disfonía / nódulos cuerdas vocales",
      consecuencia: "Enfermedad profesional Ley 16.744",
      probabilidad: 4,
      severidad: 3,
      controles: "Capacitación higiene vocal, amplificación portátil cuando aula >25 alumnos, hidratación constante, ENT semestral, salas <60 dB ruido fondo.",
      tags: ["educacion", "voz", "iper"]
    },
    {
      title: "Violencia ocupacional (estudiantes/apoderados)",
      actividad: "Mediación de conflictos / disciplina escolar",
      description: "Agresión física o verbal a docente",
      riesgo: "Lesiones físicas + estrés post-traumático",
      consecuencia: "Trauma psicológico, incapacidad laboral",
      probabilidad: 3,
      severidad: 3,
      controles: "Protocolo de actuación violencia escolar (Ley Aula Segura), botón pánico in situ, sala separación con visibilidad, contención emocional post-incidente, denuncia formal MINEDUC.",
      tags: ["educacion", "violencia", "iper"]
    }
  ]
};

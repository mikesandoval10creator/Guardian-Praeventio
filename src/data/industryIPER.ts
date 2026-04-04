
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
  ]
};

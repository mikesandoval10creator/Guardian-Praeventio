import React, { createContext, useContext, ReactNode } from 'react';

// Chilean OHS normative knowledge base for AI prompt injection
export interface NormativeEntry {
  code: string;
  title: string;
  summary: string;
  keyArticles?: string[];
}

export const NORMATIVE_DB: NormativeEntry[] = [
  {
    code: 'LEY_16744',
    title: 'Ley 16.744 — Accidentes del Trabajo y Enfermedades Profesionales',
    summary: 'Establece el seguro social obligatorio contra riesgos de accidentes del trabajo y enfermedades profesionales. Define obligaciones del empleador, derechos del trabajador, prestaciones médicas, indemnizaciones y sanciones.',
    keyArticles: [
      'Art. 67: Comités Paritarios de Higiene y Seguridad obligatorios en empresas con ≥25 trabajadores.',
      'Art. 68: Obligación de adoptar medidas de higiene y seguridad en el trabajo.',
      'Art. 69: Responsabilidad del empleador en accidentes por negligencia.',
      'Art. 71: Derecho del trabajador a negarse a trabajar en condiciones peligrosas.',
    ],
  },
  {
    code: 'DS_594',
    title: 'DS 594/1999 — Condiciones Sanitarias y Ambientales Básicas en los Lugares de Trabajo',
    summary: 'Regula las condiciones mínimas de higiene, seguridad, habitabilidad y salubridad en los lugares de trabajo. Incluye límites permisibles de exposición a agentes químicos, físicos y biológicos.',
    keyArticles: [
      'Art. 19: Concentraciones máximas permisibles de contaminantes químicos (LPP).',
      'Art. 28: Exposición a ruido: límite de 85 dB(A) en jornada de 8 horas.',
      'Art. 56: Temperatura en ambientes de trabajo: 10°C mínimo y 30°C máximo.',
      'Art. 82: Iluminación mínima según tipo de tarea (100–1000 lux).',
    ],
  },
  {
    code: 'DS_101',
    title: 'DS 101/1968 — Reglamento para la aplicación de la Ley 16.744',
    summary: 'Reglamento que regula las prestaciones médicas, subsidios, indemnizaciones y pensiones derivadas de accidentes del trabajo y enfermedades profesionales.',
  },
  {
    code: 'DS_44_2021',
    title: 'DS 44/2021 — Reglamento de los Comités Paritarios de Higiene y Seguridad',
    summary: 'Define la composición, atribuciones y funcionamiento de los Comités Paritarios. Exige reunión mensual, acta de cada reunión y seguimiento de acuerdos.',
    keyArticles: [
      'Art. 3: Empresas con 25 a 49 trabajadores: 1 representante por parte.',
      'Art. 4: Empresas con 50 o más trabajadores: 3 representantes por parte.',
      'Art. 24: El Comité debe investigar todo accidente que cause incapacidad o muerte.',
    ],
  },
  {
    code: 'DS_298',
    title: 'DS 298/1994 — Reglamento de Transporte de Carga',
    summary: 'Regula condiciones de seguridad para conductores y vehículos de transporte de carga en faenas.',
    keyArticles: [
      'Art. 22: Prohibición de conducir con fatiga o somnolencia.',
      'Art. 44: Revisión técnica y permiso de circulación al día.',
    ],
  },
  {
    code: 'DS_132_2004',
    title: 'DS 132/2004 — Reglamento de Seguridad Minera',
    summary: 'Establece condiciones mínimas de seguridad en faenas mineras subterráneas y a cielo abierto. Incluye uso de EPP específico, gestión de explosivos, ventilación y evacuación.',
  },
  {
    code: 'DS_977',
    title: 'DS 977 — Reglamento Sanitario de los Alimentos (gastronomía)',
    summary: 'Aplica a empresas de alimentación colectiva. Regula manipulación, almacenamiento y preparación de alimentos para protección de trabajadores y comensales.',
  },
  {
    code: 'NCH_436',
    title: 'NCh 436 — Prevención de Riesgos Eléctricos',
    summary: 'Norma chilena que establece los requisitos de seguridad para instalaciones eléctricas industriales y domiciliarias. Obligatoria en obras de construcción y mantención eléctrica.',
  },
  {
    code: 'PREXOR',
    title: 'Protocolo PREXOR — Exposición Ocupacional a Ruido',
    summary: 'Protocolo MINSAL que establece la vigilancia médica y ambiental de trabajadores expuestos a ruido sobre 82 dB(A). Exige dosimetría, audiometría periódica y medidas de control.',
  },
  {
    code: 'TMERT',
    title: 'Protocolo TMERT-EESS — Trastornos Musculoesqueléticos de Extremidades Superiores',
    summary: 'Protocolo MINSAL para evaluar y controlar riesgos de trastornos musculoesqueléticos en trabajos con movimientos repetitivos, posturas forzadas o uso de fuerza excesiva.',
  },
  {
    code: 'ISTAS21',
    title: 'ISTAS21 (CoPsoQ) — Evaluación de Riesgos Psicosociales',
    summary: 'Cuestionario estandarizado para identificar factores de riesgo psicosocial: demandas cognitivas, control, apoyo social, doble presencia. Obligatorio en empresas con ≥25 trabajadores según resolución MINSAL.',
  },
  {
    code: 'LEY_21015',
    title: 'Ley 21.015 — Inclusión Laboral de Personas con Discapacidad',
    summary: 'Empresas con 100 o más trabajadores deben contratar al menos el 1% de personas con discapacidad o asignatarias de pensión de invalidez.',
  },
  {
    code: 'LEY_21156',
    title: 'Ley 21.156 — Uso de Desfibriladores Externos Automáticos (DEA)',
    summary: 'Establece la obligación de instalar DEA en lugares de acceso público con flujo ≥500 personas/día. El personal debe ser capacitado en su uso.',
  },
  {
    code: 'SUSESO_DIAT',
    title: 'DIAT — Declaración Individual de Accidente del Trabajo',
    summary: 'Formulario SUSESO que el empleador debe completar ante todo accidente del trabajo con incapacidad. Plazo máximo de 24 horas desde ocurrido el accidente para presentación ante el organismo administrador.',
  },
];

export function getComprehensiveNormativeContext(): string {
  const sections = [
    '=== BASE NORMATIVA CHILENA DE SEGURIDAD Y SALUD OCUPACIONAL ===',
    '',
    NORMATIVE_DB.map((entry) => {
      const lines = [`[${entry.code}] ${entry.title}`, entry.summary];
      if (entry.keyArticles?.length) {
        lines.push('Artículos clave:');
        entry.keyArticles.forEach((a) => lines.push(`  - ${a}`));
      }
      return lines.join('\n');
    }).join('\n\n'),
    '',
    '=== FIN CONTEXTO NORMATIVO ===',
  ];
  return sections.join('\n');
}

interface NormativeContextValue {
  normativeDB: NormativeEntry[];
  getComprehensiveNormativeContext: () => string;
  getNormativeByCode: (code: string) => NormativeEntry | undefined;
}

const NormativeCtx = createContext<NormativeContextValue | null>(null);

export function NormativeProvider({ children }: { children: ReactNode }) {
  const getNormativeByCode = (code: string) =>
    NORMATIVE_DB.find((e) => e.code === code);

  return (
    <NormativeCtx.Provider
      value={{ normativeDB: NORMATIVE_DB, getComprehensiveNormativeContext, getNormativeByCode }}
    >
      {children}
    </NormativeCtx.Provider>
  );
}

export function useNormative(): NormativeContextValue {
  const ctx = useContext(NormativeCtx);
  if (!ctx) throw new Error('useNormative must be used inside NormativeProvider');
  return ctx;
}

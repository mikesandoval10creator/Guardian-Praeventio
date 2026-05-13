// Praeventio Guard — Sprint 41 F.22: Modo Capacitación Relámpago.
//
// Micro-capacitaciones 3-5 min activadas por contexto (riesgo detectado en
// la tarea/cuadrilla del trabajador). Determinístico, sin LLM, sin I/O.
//
// Filosofía: "Detección Predictiva" (Fase 1 del Flow Infinito) → cuando el
// sistema detecta que un trabajador será expuesto a un riesgo X y no
// tiene training Y vigente, se dispara un micro-módulo certificable.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type RiskCategory =
  | 'altura'
  | 'electrico'
  | 'hazmat'
  | 'ergo'
  | 'lineas_de_fuego'
  | 'espacio_confinado'
  | 'ruido';

export type ContentBlock =
  | { kind: 'text'; payload: { body: string } }
  | { kind: 'image'; payload: { src: string; alt: string } }
  | {
      kind: 'quiz';
      payload: {
        question: string;
        options: string[];
        correctIndex: number;
      };
    };

export interface MicroTrainingModule {
  id: string;
  title: string;
  durationMinutes: number; // 3-5
  riskCategory: RiskCategory;
  content: ContentBlock[];
  certifyOnPass: boolean;
}

export interface MicroTrainingAnswer {
  blockIndex: number;
  selectedIndex: number;
}

export interface MicroTrainingSession {
  workerUid: string;
  moduleId: string;
  startedAt: number;
  completedAt?: number;
  score?: number; // 0-100
  answers: MicroTrainingAnswer[];
}

export interface ContextTrigger {
  workerUid: string;
  /** Riesgos detectados en la tarea/cuadrilla actual. */
  detectedRisks: RiskCategory[];
  /** IDs de módulos ya certificados y vigentes para este worker. */
  certifiedModuleIds: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Canonical catalog (5+ módulos)
// ────────────────────────────────────────────────────────────────────────

export const MICROTRAINING_CATALOG: MicroTrainingModule[] = [
  {
    id: 'mt-altura-v1',
    title: 'Trabajo en altura: 3 reglas críticas',
    durationMinutes: 4,
    riskCategory: 'altura',
    certifyOnPass: true,
    content: [
      {
        kind: 'text',
        payload: {
          body: 'Toda altura ≥1.8m exige arnés certificado, doble línea de vida y punto de anclaje 22 kN.',
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: '¿Cuál es el factor de caída máximo aceptable?',
          options: ['0.5', '1.0', '2.0', 'Sin límite'],
          correctIndex: 1,
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: 'Antes de subir, ¿qué inspecciono primero?',
          options: ['El casco', 'Arnés y costuras', 'Mis zapatos', 'El clima'],
          correctIndex: 1,
        },
      },
    ],
  },
  {
    id: 'mt-electrico-v1',
    title: 'Riesgo eléctrico: las 5 reglas de oro',
    durationMinutes: 5,
    riskCategory: 'electrico',
    certifyOnPass: true,
    content: [
      {
        kind: 'text',
        payload: {
          body: 'Desconectar, bloquear, verificar ausencia de tensión, puesta a tierra y señalizar.',
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: '¿Qué herramienta verifica ausencia de tensión?',
          options: [
            'Voltímetro categorizado',
            'Destornillador',
            'Multitester barato',
            'La intuición',
          ],
          correctIndex: 0,
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: 'Si encuentro un cable expuesto, ¿qué hago primero?',
          options: [
            'Lo toco para confirmar',
            'Lo cubro con cinta',
            'Señalizo y reporto',
            'Sigo trabajando',
          ],
          correctIndex: 2,
        },
      },
    ],
  },
  {
    id: 'mt-hazmat-v1',
    title: 'Materiales peligrosos: HDS en 4 minutos',
    durationMinutes: 4,
    riskCategory: 'hazmat',
    certifyOnPass: true,
    content: [
      {
        kind: 'text',
        payload: {
          body: 'Antes de manipular un químico, leer la Hoja de Datos de Seguridad (HDS/SDS) sección 4 (primeros auxilios) y 8 (EPP).',
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: '¿Qué sección de la HDS describe el EPP requerido?',
          options: ['Sección 2', 'Sección 4', 'Sección 8', 'Sección 16'],
          correctIndex: 2,
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: 'Ante derrame de ácido, ¿neutralizo con agua?',
          options: [
            'Sí, siempre',
            'No, sigo protocolo HDS sección 6',
            'Solo si es poco',
            'Echo más ácido',
          ],
          correctIndex: 1,
        },
      },
    ],
  },
  {
    id: 'mt-ergo-v1',
    title: 'Ergonomía: levantar cargas sin lesión',
    durationMinutes: 3,
    riskCategory: 'ergo',
    certifyOnPass: false,
    content: [
      {
        kind: 'text',
        payload: {
          body: 'Flexionar rodillas, espalda recta, carga pegada al cuerpo. Ley 20.001: máx 25 kg hombres, 20 kg mujeres.',
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: 'Límite legal en Chile para mujeres adultas (Ley 20.001)',
          options: ['15 kg', '20 kg', '25 kg', '30 kg'],
          correctIndex: 1,
        },
      },
    ],
  },
  {
    id: 'mt-lineas-fuego-v1',
    title: 'Líneas de fuego: nunca entre la carga y la pared',
    durationMinutes: 3,
    riskCategory: 'lineas_de_fuego',
    certifyOnPass: true,
    content: [
      {
        kind: 'text',
        payload: {
          body: 'Una "línea de fuego" es la trayectoria que tomaría una carga, herramienta o energía liberada. Posicionarse fuera de ella.',
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: 'Al guiar una carga suspendida, ¿desde dónde lo hago?',
          options: [
            'Bajo la carga',
            'Lateralmente, fuera de su trayectoria',
            'Tirando del gancho',
            'Desde arriba',
          ],
          correctIndex: 1,
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: 'Si una manguera presurizada se suelta, ¿qué área es la línea de fuego?',
          options: [
            'Solo el frente',
            'Toda la trayectoria del latigazo posible',
            'A 1 metro',
            'Ninguna',
          ],
          correctIndex: 1,
        },
      },
    ],
  },
  {
    id: 'mt-confinado-v1',
    title: 'Espacios confinados: permiso + atmósfera',
    durationMinutes: 5,
    riskCategory: 'espacio_confinado',
    certifyOnPass: true,
    content: [
      {
        kind: 'text',
        payload: {
          body: 'Permiso de entrada obligatorio, medición de O2 (19.5-23.5%), gases inflamables (<10% LEL) y tóxicos. Vigía externo siempre.',
        },
      },
      {
        kind: 'quiz',
        payload: {
          question: 'Rango aceptable de O2 para entrar',
          options: ['18-22%', '19.5-23.5%', '15-25%', '21% exacto'],
          correctIndex: 1,
        },
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────────────
// Selection
// ────────────────────────────────────────────────────────────────────────

/**
 * Elige el primer módulo del catálogo cuyo riesgo está detectado y
 * cuyo módulo NO está aún certificado para el worker. Si todos los
 * riesgos ya están cubiertos, retorna null.
 */
export function selectMicroModule(
  trigger: ContextTrigger,
  catalog: MicroTrainingModule[] = MICROTRAINING_CATALOG,
): MicroTrainingModule | null {
  for (const risk of trigger.detectedRisks) {
    const candidate = catalog.find(
      (m) =>
        m.riskCategory === risk &&
        !trigger.certifiedModuleIds.includes(m.id),
    );
    if (candidate) return candidate;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Scoring
// ────────────────────────────────────────────────────────────────────────

/**
 * Calcula score 0-100 contra los bloques de tipo quiz del módulo.
 * Si el módulo no tiene quizzes, retorna 100 (sólo lectura).
 */
export function scoreSession(
  session: MicroTrainingSession,
  module: MicroTrainingModule,
): number {
  const quizBlocks = module.content
    .map((b, idx) => ({ block: b, idx }))
    .filter((x) => x.block.kind === 'quiz');

  if (quizBlocks.length === 0) return 100;

  let correct = 0;
  for (const { block, idx } of quizBlocks) {
    if (block.kind !== 'quiz') continue;
    const answer = session.answers.find((a) => a.blockIndex === idx);
    if (answer && answer.selectedIndex === block.payload.correctIndex) {
      correct += 1;
    }
  }
  return Math.round((correct / quizBlocks.length) * 100);
}

/** Umbral mínimo para aprobar. */
export const PASS_THRESHOLD = 80;

export function isPassing(score: number): boolean {
  return score >= PASS_THRESHOLD;
}

/**
 * Determina si la sesión genera certificación: pasa el threshold Y
 * el módulo está marcado como certifyOnPass.
 */
export function shouldCertify(
  session: MicroTrainingSession,
  module: MicroTrainingModule,
): boolean {
  if (!module.certifyOnPass) return false;
  const score = session.score ?? scoreSession(session, module);
  return isPassing(score);
}

// ────────────────────────────────────────────────────────────────────────
// Catalog coverage
// ────────────────────────────────────────────────────────────────────────

export function catalogRiskCoverage(
  catalog: MicroTrainingModule[] = MICROTRAINING_CATALOG,
): RiskCategory[] {
  return Array.from(new Set(catalog.map((m) => m.riskCategory)));
}

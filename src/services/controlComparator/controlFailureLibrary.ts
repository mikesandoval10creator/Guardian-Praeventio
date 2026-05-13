// Praeventio Guard — Sprint 52 §306: Biblioteca de Fallas de Controles
// (enhanced).
//
// Cierra: Documento usuario "§306 — Biblioteca de fallas de controles
// enhanced".
//
// Extiende el motor existente:
//   - `criticalControls/controlRobustness.ts` define los `ControlFailureMode`
//     canónicos (no_disponible, no_usado, ...).
//
// Este módulo agrega:
//   - Patrones observables (síntoma + causa raíz) por industria.
//   - Acciones correctivas estándar por modo de falla.
//   - Frecuencia histórica para priorizar prevención.
//
// 30+ entries inicial, todos basados en patrones reales OHS (Chile +
// referencia OSHA / HSE / ICMM). Extensible vía PR — agregar una entry =
// 1 objeto literal.

import type { ControlLevel } from '../criticalControls/criticalControlsLibrary.js';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/**
 * Modos de falla canónicos (alineado con
 * `controlRobustness.ControlFailureMode` pero con cobertura ampliada para
 * la biblioteca §306, en inglés snake_case para uniformidad con otras
 * APIs OHS).
 */
export type FailureMode =
  | 'no_available'
  | 'not_used'
  | 'inadequate'
  | 'not_maintained'
  | 'not_understood'
  | 'not_supervised'
  | 'misapplied'
  | 'circumvented';

export type ObservedFrequencyTier = 'rare' | 'occasional' | 'common' | 'very_common';

export interface FailureLibraryEntry {
  id: string;
  controlKind: ControlLevel;
  failureMode: FailureMode;
  /** Industria donde el patrón se observó (puede ser 'cross-industry'). */
  industry: string;
  /** Síntoma observable por supervisor / inspector. */
  symptom: string;
  /** Causa raíz típica detrás del síntoma. */
  rootCausePattern: string;
  /** Acciones correctivas estándar (3-6 ítems concretos). */
  standardCorrectiveActions: string[];
  /** Frecuencia histórica observada. */
  observedFrequencyTier: ObservedFrequencyTier;
}

// ────────────────────────────────────────────────────────────────────────
// Library — 30+ entries (Chile + cross-industry OHS patterns)
// ────────────────────────────────────────────────────────────────────────

export const FAILURE_LIBRARY: FailureLibraryEntry[] = [
  // ───────── EPP ─────────
  {
    id: 'epp-arnes-no-available',
    controlKind: 'epp',
    failureMode: 'no_available',
    industry: 'construction',
    symptom: 'Trabajador en altura sin arnés a la vista',
    rootCausePattern: 'Inventario insuficiente o arneses con certificación vencida retirados sin reemplazo',
    standardCorrectiveActions: [
      'Auditoría inmediata de stock vs. headcount expuesto',
      'Orden de compra emergencia con certificación vigente',
      'Bloquear trabajos en altura hasta reposición',
      'Implementar mínimo de stock con alerta automática',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'epp-arnes-not-used',
    controlKind: 'epp',
    failureMode: 'not_used',
    industry: 'construction',
    symptom: 'Arnés presente en faena pero trabajador no lo lleva puesto',
    rootCausePattern: 'Incomodidad térmica, cultura de "es solo un momento", supervisión ausente',
    standardCorrectiveActions: [
      'Charla 5 minutos con casos reales de caídas sin arnés',
      'Designar buddy-check antes de subir',
      'Sanción graduada documentada en RIOHS',
      'Selección de modelo con mejor ventilación',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'epp-arnes-not-maintained',
    controlKind: 'epp',
    failureMode: 'not_maintained',
    industry: 'cross-industry',
    symptom: 'Arnés con costuras deshilachadas, hebillas oxidadas o etiqueta ilegible',
    rootCausePattern: 'Sin programa de inspección periódica; almacenamiento en bodega húmeda',
    standardCorrectiveActions: [
      'Inspección visual pre-uso obligatoria con checklist',
      'Inspección documental trimestral por persona competente',
      'Retiro inmediato de arneses con daño',
      'Bodega seca con racks (no en suelo)',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'epp-respirador-misapplied',
    controlKind: 'epp',
    failureMode: 'misapplied',
    industry: 'mining',
    symptom: 'Filtro químico instalado donde se requiere filtro de partículas (o viceversa)',
    rootCausePattern: 'Confusión entre filtros A/B/E/K/P; falta de fit-test',
    standardCorrectiveActions: [
      'Matriz peligro → filtro correcto pegada en bodega',
      'Fit-test cuantitativo anual',
      'Capacitación con identificación visual de filtros',
      'Etiquetado por colores en racks',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'epp-zapato-circumvented',
    controlKind: 'epp',
    failureMode: 'circumvented',
    industry: 'logistics',
    symptom: 'Trabajadores cambian zapato de seguridad por zapatilla deportiva durante almuerzo y no se la cambian de vuelta',
    rootCausePattern: 'Zapato pesado, mal calce; ausencia de control en regreso al puesto',
    standardCorrectiveActions: [
      'Catálogo con 3+ modelos ergonómicos a elección',
      'Plantillas personalizables incluidas',
      'Check de EPP visible en supervisor pre-turno post-almuerzo',
      'Calidad de calce evaluada por podólogo si aplica',
    ],
    observedFrequencyTier: 'common',
  },

  // ───────── Engineering ─────────
  {
    id: 'eng-baranda-inadequate',
    controlKind: 'engineering',
    failureMode: 'inadequate',
    industry: 'construction',
    symptom: 'Baranda de obra de 80 cm de altura (requerido ≥ 100 cm)',
    rootCausePattern: 'Replicación de plantilla antigua; instalador sin verificar norma',
    standardCorrectiveActions: [
      'Re-medir todas las barandas perimetrales del proyecto',
      'Refuerzo a 100 cm con rodapié',
      'Verificación documental por residente antes de hand-off',
      'Plantilla de instalación actualizada a DS 594 art. 53',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'eng-baranda-no-available',
    controlKind: 'engineering',
    failureMode: 'no_available',
    industry: 'construction',
    symptom: 'Bordes abiertos en losa sin barandas',
    rootCausePattern: 'Avance de obra adelanta a montaje de protección colectiva',
    standardCorrectiveActions: [
      'Pre-requisito documental: protección colectiva precede vaciado',
      'Stop-work si se detecta borde abierto',
      'Alquiler de barandas modulares como buffer',
      'Visualización en planificación semanal',
    ],
    observedFrequencyTier: 'very_common',
  },
  {
    id: 'eng-loto-not-used',
    controlKind: 'engineering',
    failureMode: 'not_used',
    industry: 'manufacturing',
    symptom: 'Mantención eléctrica sin candado personal en interruptor',
    rootCausePattern: 'Presión productiva; cultura de "yo aviso al jefe"',
    standardCorrectiveActions: [
      'Candados personales con nombre estampado, asignados nominativos',
      'Try-out de voltaje obligatorio con foto adjunta a la OT',
      'Auditoría sorpresa mensual',
      'Tarjeta naranja → roja escalamiento al gerente',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'eng-loto-circumvented',
    controlKind: 'engineering',
    failureMode: 'circumvented',
    industry: 'manufacturing',
    symptom: 'Candado de LOTO con copia de llave guardada en supervisión',
    rootCausePattern: 'Excepciones operacionales mal documentadas; falta de procedimiento alterno',
    standardCorrectiveActions: [
      'Política: cada candado tiene una sola llave, en posesión del titular',
      'Procedimiento de remoción de candado huérfano con 3 firmas',
      'Auditoría de inventario de llaves',
      'Retiro disciplinario de copias indebidas',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'eng-ventilacion-not-maintained',
    controlKind: 'engineering',
    failureMode: 'not_maintained',
    industry: 'mining',
    symptom: 'Ventilador en espacio confinado con caudal bajo medición',
    rootCausePattern: 'Filtros saturados; sin programa preventivo',
    standardCorrectiveActions: [
      'Medición caudal pre-uso con anemómetro',
      'Cambio filtros mensual con registro',
      'Backup de ventilador disponible en pañol',
      'Indicador visual de presión diferencial',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'eng-extraccion-inadequate',
    controlKind: 'engineering',
    failureMode: 'inadequate',
    industry: 'chemical',
    symptom: 'Campana de extracción local con velocidad de captura insuficiente',
    rootCausePattern: 'Diseño sin estudio de aerodinámica; modificaciones ad-hoc al ducto',
    standardCorrectiveActions: [
      'Medición velocidad de captura en cara y en zona de respiración',
      'Rediseño con consultor higienista',
      'Sellar fugas en duct work',
      'Recálculo cuando se cambian procesos',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'eng-extintor-no-available',
    controlKind: 'engineering',
    failureMode: 'no_available',
    industry: 'cross-industry',
    symptom: 'Trabajo en caliente sin extintor portátil al alcance',
    rootCausePattern: 'Extintor "siempre estuvo" ya no está; recargas vencidas retiradas',
    standardCorrectiveActions: [
      'Pre-task check obligatorio con foto de extintor',
      'Calendario de recarga centralizado con alerta T-30',
      'Cantidad mínima por área basada en NFPA 10',
      'Stop-work si falta',
    ],
    observedFrequencyTier: 'common',
  },

  // ───────── Administrative ─────────
  {
    id: 'adm-permit-not-used',
    controlKind: 'administrative',
    failureMode: 'not_used',
    industry: 'cross-industry',
    symptom: 'Trabajo de alto riesgo iniciado sin permiso firmado',
    rootCausePattern: 'Urgencia operativa; supervisor no disponible',
    standardCorrectiveActions: [
      'Permiso digital con firma móvil y validación on-site',
      'Backup supervisor designado por turno',
      'Stop-work si permiso vacío',
      'Auditoría diaria de permisos vs OT',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'adm-permit-misapplied',
    controlKind: 'administrative',
    failureMode: 'misapplied',
    industry: 'cross-industry',
    symptom: 'Permiso de altura usado para tarea que también requiere permiso confinado',
    rootCausePattern: 'Permisos no concurrentes; matriz de combinación inexistente',
    standardCorrectiveActions: [
      'Matriz de permisos concurrentes',
      'Formulario unificado para trabajos multi-riesgo',
      'Validación cruzada por prevencionista',
      'Capacitación a supervisores',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'adm-vigia-not-supervised',
    controlKind: 'administrative',
    failureMode: 'not_supervised',
    industry: 'mining',
    symptom: 'Vigía de espacio confinado abandona posición durante trabajo',
    rootCausePattern: 'Sin relevo planificado; tareas adicionales asignadas',
    standardCorrectiveActions: [
      'Dedicación exclusiva del vigía durante todo el trabajo',
      'Relevo planificado documentado',
      'Comunicación radial cada 15 min',
      'Auditoría sorpresa por supervisor',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'adm-capacitacion-not-understood',
    controlKind: 'administrative',
    failureMode: 'not_understood',
    industry: 'cross-industry',
    symptom: 'Trabajadores firman ODI pero no pueden explicar peligros principales',
    rootCausePattern: 'ODI leída en grupo grande; sin verificación de comprensión',
    standardCorrectiveActions: [
      'Quiz de 3 preguntas post-ODI',
      'ODI en pictogramas para trabajadores con baja lectoescritura',
      'Sesiones en grupos ≤ 8 personas',
      'Retraining si quiz < 80%',
    ],
    observedFrequencyTier: 'very_common',
  },
  {
    id: 'adm-hds-no-available',
    controlKind: 'administrative',
    failureMode: 'no_available',
    industry: 'chemical',
    symptom: 'HDS no disponible en zona de almacenamiento',
    rootCausePattern: 'Producto nuevo ingresado sin documentación; archivo solo digital sin acceso terreno',
    standardCorrectiveActions: [
      'No-ingreso de productos sin HDS adjunta',
      'HDS impresa en carpeta zona + acceso digital QR',
      'Auditoría trimestral de HDS vs inventario',
      'Idioma local + traducción si proviene del extranjero',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'adm-supervisor-not-supervised',
    controlKind: 'administrative',
    failureMode: 'not_supervised',
    industry: 'construction',
    symptom: 'Supervisor de altura cubre 3 frentes simultáneos',
    rootCausePattern: 'Recortes de headcount; rotación alta',
    standardCorrectiveActions: [
      'Ratio máximo 1 supervisor por 15 trabajadores en altura',
      'Asistente supervisor competente con delegación documentada',
      'Stop-work si supervisor ausente >15 min',
      'Plan de cobertura por enfermedad/vacaciones',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'adm-rescate-inadequate',
    controlKind: 'administrative',
    failureMode: 'inadequate',
    industry: 'mining',
    symptom: 'Equipo de rescate en espacio confinado tarda > 6 min en alistarse',
    rootCausePattern: 'Equipos guardados lejos; sin simulacro reciente',
    standardCorrectiveActions: [
      'Equipo de rescate a < 3 min del punto de trabajo',
      'Simulacro mensual cronometrado',
      'Pre-check con maniquí antes del trabajo',
      'Compromiso de tiempo respuesta documentado',
    ],
    observedFrequencyTier: 'occasional',
  },

  // ───────── Substitution ─────────
  {
    id: 'sub-quimico-not-understood',
    controlKind: 'substitution',
    failureMode: 'not_understood',
    industry: 'chemical',
    symptom: 'Sustitución de solvente toxico aprobada pero operadores siguen pidiendo el original',
    rootCausePattern: 'Falta de capacitación en nuevo producto; percepción de menor rendimiento',
    standardCorrectiveActions: [
      'Demo en planta con resultado comparado',
      'Métricas de desempeño visibles del nuevo producto',
      'Champion designado por área',
      'Retiro físico del original del inventario activo',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'sub-no-soldar-circumvented',
    controlKind: 'substitution',
    failureMode: 'circumvented',
    industry: 'construction',
    symptom: 'Alternativa fría disponible pero cuadrilla sigue soldando por costumbre',
    rootCausePattern: 'Resistencia al cambio; alternativa requiere más planificación',
    standardCorrectiveActions: [
      'Política: hot-work solo con autorización explícita justificando por qué no se usa la alternativa',
      'KPI mensual de % hot-work sustituido',
      'Capacitación práctica en alternativa fría',
      'Incentivo por reducción hot-work',
    ],
    observedFrequencyTier: 'common',
  },

  // ───────── Elimination ─────────
  {
    id: 'elim-corte-circumvented',
    controlKind: 'elimination',
    failureMode: 'circumvented',
    industry: 'manufacturing',
    symptom: 'Trabajo eléctrico con energía cuando procedimiento exige corte total',
    rootCausePattern: 'Demanda productiva continua; falta backup eléctrico',
    standardCorrectiveActions: [
      'Política trabajo energizado solo con justificación documentada',
      'Programación de ventanas de corte semanales',
      'UPS o generación de respaldo para procesos críticos',
      'Auditoría gerencial mensual',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'elim-altura-not-used',
    controlKind: 'elimination',
    failureMode: 'not_used',
    industry: 'construction',
    symptom: 'Componentes prefabricados a nivel disponibles pero se opta por ensamble en altura',
    rootCausePattern: 'Logística no integrada con prevención; planificación reactiva',
    standardCorrectiveActions: [
      'Revisión de prefabricación en design review',
      'KPI horas-hombre en altura por proyecto',
      'Capacitación a planeadores en jerarquía de controles',
      'Aprobación residente para excepciones',
    ],
    observedFrequencyTier: 'occasional',
  },

  // ───────── Additional cross-industry ─────────
  {
    id: 'eng-medicion-gases-not-maintained',
    controlKind: 'engineering',
    failureMode: 'not_maintained',
    industry: 'mining',
    symptom: 'Detector multigas sin calibración vigente o sensor agotado',
    rootCausePattern: 'Sin programa de calibración; sensores con vida útil expirada',
    standardCorrectiveActions: [
      'Calibración bump-test diaria con gas patrón',
      'Calibración completa según fabricante (típ. 6 meses)',
      'Reemplazo de sensores antes de vida útil',
      'Registro digital de cada uso',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'epp-dielectrico-inadequate',
    controlKind: 'epp',
    failureMode: 'inadequate',
    industry: 'electric_utility',
    symptom: 'Guantes dieléctricos de clase inferior al voltaje de trabajo',
    rootCausePattern: 'Compra centralizada con criterio de costo; selección sin evaluación de tarea',
    standardCorrectiveActions: [
      'Matriz voltaje × clase de guante visible en bodega',
      'Test eléctrico anual obligatorio',
      'Inspección visual + air-test antes de cada uso',
      'Auditoría de adquisiciones por prevención',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'adm-licencia-inadequate',
    controlKind: 'administrative',
    failureMode: 'inadequate',
    industry: 'electric_utility',
    symptom: 'Operador eléctrico con licencia SEC vencida',
    rootCausePattern: 'Sin tracking de vencimientos; renovaciones reactivas',
    standardCorrectiveActions: [
      'Tablero de vencimientos centralizado con alerta T-90/T-30',
      'Bloqueo automático de OT para licencia vencida',
      'Renovación pre-pagada por la empresa',
      'Inducción de prevención al re-onboarding',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'eng-loto-inadequate',
    controlKind: 'engineering',
    failureMode: 'inadequate',
    industry: 'manufacturing',
    symptom: 'Candado de LOTO removible con herramienta común',
    rootCausePattern: 'Compra de candados estándar; sin estándar de seguridad industrial',
    standardCorrectiveActions: [
      'Estándar: candados acerados con cuerpo no removible',
      'Identificación nominal grabada (no etiqueta pegada)',
      'Set tagout + lockout combinado',
      'Auditoría anual de stock de candados',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'epp-casco-not-used',
    controlKind: 'epp',
    failureMode: 'not_used',
    industry: 'construction',
    symptom: 'Trabajadores en obra sin casco en zonas de circulación',
    rootCausePattern: 'Cultura "solo voy un momento"; supervisión variable por zona',
    standardCorrectiveActions: [
      'Política casco siempre dentro del perímetro',
      'Charlas de caso real (objeto caído)',
      'Casco confortable con suspensión moderna',
      'Sanción graduada',
    ],
    observedFrequencyTier: 'very_common',
  },
  {
    id: 'adm-capacitacion-not-supervised',
    controlKind: 'administrative',
    failureMode: 'not_supervised',
    industry: 'cross-industry',
    symptom: 'Capacitación obligatoria con asistencia firmada pero trabajadores ausentes en sala',
    rootCausePattern: 'Firma "por delegación"; sin control biométrico',
    standardCorrectiveActions: [
      'Asistencia con foto + firma digital georeferenciada',
      'Quiz post-capacitación individual',
      'Auditoría aleatoria de listados de asistencia',
      'Sanción a quien firma por otro',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'eng-extraccion-not-maintained',
    controlKind: 'engineering',
    failureMode: 'not_maintained',
    industry: 'manufacturing',
    symptom: 'Ducto de extracción con acumulación visible de polvo / residuo',
    rootCausePattern: 'Sin programa de limpieza interna; PdM ausente',
    standardCorrectiveActions: [
      'Programa de limpieza con frecuencia según carga',
      'Medición velocidad mensual',
      'Inspección visual semanal por operador',
      'Reemplazo de tramos colapsados',
    ],
    observedFrequencyTier: 'common',
  },
  {
    id: 'sub-quimico-misapplied',
    controlKind: 'substitution',
    failureMode: 'misapplied',
    industry: 'chemical',
    symptom: 'Producto sustituto utilizado para aplicación distinta a la validada',
    rootCausePattern: 'Comunicación incompleta del alcance; etiquetado genérico',
    standardCorrectiveActions: [
      'Etiqueta clara con aplicaciones permitidas / prohibidas',
      'Carta de aprobación pegada al envase grande',
      'Capacitación de operadores con casos de uso',
      'Auditoría de cumplimiento mensual',
    ],
    observedFrequencyTier: 'occasional',
  },
  {
    id: 'adm-rescate-no-available',
    controlKind: 'administrative',
    failureMode: 'no_available',
    industry: 'mining',
    symptom: 'Trabajo de rescate iniciado sin equipo de respiración autónoma operativo',
    rootCausePattern: 'Equipos en mantenimiento sin backup; logística deficiente',
    standardCorrectiveActions: [
      'Mínimo 2 sets ERA operativos por sitio',
      'Pre-task check obligatorio',
      'Calendario de mantención escalonado para no dejar sitio sin equipo',
      'Contrato de servicio 24/7 con proveedor',
    ],
    observedFrequencyTier: 'rare',
  },
  {
    id: 'eng-vigia-fuego-not-used',
    controlKind: 'administrative',
    failureMode: 'not_used',
    industry: 'construction',
    symptom: 'Trabajo en caliente sin vigía de fuego designado',
    rootCausePattern: 'Designación informal; rol asignado pero persona haciendo otras tareas',
    standardCorrectiveActions: [
      'Vigía dedicado exclusivo durante trabajo + 30 min post',
      'Documentación nominal en permiso',
      'Reloj de cuenta regresiva al cierre del trabajo',
      'Capacitación específica para vigía',
    ],
    observedFrequencyTier: 'common',
  },
];

// ────────────────────────────────────────────────────────────────────────
// Lookups
// ────────────────────────────────────────────────────────────────────────

/**
 * Busca patrones de falla en la biblioteca. Todos los filtros son
 * opcionales y se aplican en AND. `symptom` matchea substring case-insensitive.
 */
export function lookupFailurePatterns(
  controlKind: ControlLevel,
  industry?: string,
  symptom?: string,
): FailureLibraryEntry[] {
  const normalizedSymptom = symptom?.trim().toLowerCase();
  return FAILURE_LIBRARY.filter((entry) => {
    if (entry.controlKind !== controlKind) return false;
    if (industry && entry.industry !== industry && entry.industry !== 'cross-industry') {
      return false;
    }
    if (normalizedSymptom) {
      if (!entry.symptom.toLowerCase().includes(normalizedSymptom)) return false;
    }
    return true;
  });
}

/**
 * Devuelve la unión de acciones correctivas para todas las entries que
 * match (failureMode, controlKind). Deduplicado preservando orden.
 */
export function suggestCorrectiveActions(
  failureMode: FailureMode,
  controlKind: ControlLevel,
): string[] {
  const matches = FAILURE_LIBRARY.filter(
    (e) => e.failureMode === failureMode && e.controlKind === controlKind,
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    for (const a of m.standardCorrectiveActions) {
      if (!seen.has(a)) {
        seen.add(a);
        out.push(a);
      }
    }
  }
  return out;
}

/**
 * Devuelve estadísticas resumen de la biblioteca (útil para dashboards
 * §306). Conteo de entries por failureMode y por controlKind.
 */
export function summarizeFailureLibrary(): {
  totalEntries: number;
  byFailureMode: Record<FailureMode, number>;
  byControlKind: Record<ControlLevel, number>;
  byFrequencyTier: Record<ObservedFrequencyTier, number>;
} {
  const byFailureMode = {
    no_available: 0,
    not_used: 0,
    inadequate: 0,
    not_maintained: 0,
    not_understood: 0,
    not_supervised: 0,
    misapplied: 0,
    circumvented: 0,
  } as Record<FailureMode, number>;
  const byControlKind = {
    elimination: 0,
    substitution: 0,
    engineering: 0,
    administrative: 0,
    epp: 0,
  } as Record<ControlLevel, number>;
  const byFrequencyTier = {
    rare: 0,
    occasional: 0,
    common: 0,
    very_common: 0,
  } as Record<ObservedFrequencyTier, number>;

  for (const e of FAILURE_LIBRARY) {
    byFailureMode[e.failureMode] += 1;
    byControlKind[e.controlKind] += 1;
    byFrequencyTier[e.observedFrequencyTier] += 1;
  }

  return {
    totalEntries: FAILURE_LIBRARY.length,
    byFailureMode,
    byControlKind,
    byFrequencyTier,
  };
}

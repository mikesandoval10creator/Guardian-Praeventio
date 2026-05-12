// Praeventio Guard — Sprint 39 Fase L.6: Acciones Correctivas Robustas.
//
// Cierra: Documento usuario "§324-331" — Top usuario #8
//
// Detecta y clasifica acciones correctivas:
//   - Lenguaje débil/vago ("capacitar", "reforzar", "recordar") → §325
//   - Clasificación por jerarquía ISO 45001 (§326)
//   - Desequilibrio: 70%+ de acciones son `training` → flag
//   - Duplicación: N acciones idénticas → sugerir consolidar
//   - Cascade a sistémica multi-proyecto
//
// Determinístico, sin LLM. Las heurísticas son reglas simples sobre el
// texto + categoría. Si el usuario quiere sofisticar con LLM más
// adelante, este motor sigue funcionando como fallback.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type CorrectiveActionLevel =
  | 'elimination'
  | 'engineering'
  | 'administrative'
  | 'training'
  | 'epp'
  | 'supervision'
  | 'communication';

export interface CorrectiveAction {
  id: string;
  /** Descripción libre. */
  description: string;
  /** Clasificación jerárquica. */
  level?: CorrectiveActionLevel;
  /** Estado actual. */
  status: 'open' | 'closed' | 'verified';
  /** Si vinculada a una causa transversal (multi-proyecto). */
  isSystemic: boolean;
  /** Texto de la causa que origina la acción. */
  sourceCause?: string;
}

export interface WeakLanguageReport {
  actionId: string;
  /** Frases problemáticas detectadas. */
  weakPhrases: string[];
  /** Sugerencia de reescritura. */
  suggestion: string;
}

// ────────────────────────────────────────────────────────────────────────
// Weak language detection (§325)
// ────────────────────────────────────────────────────────────────────────

const WEAK_PHRASES: Array<{ pattern: RegExp; suggestion: string }> = [
  {
    pattern: /\b(capacitar|capacitaci[oó]n)\b/i,
    suggestion: 'Especifica QUÉ capacitación, A QUIÉN, plazo y modo de verificar eficacia.',
  },
  {
    pattern: /\b(reforzar|recordar|comunicar nuevamente)\b/i,
    suggestion: 'Reemplaza por una acción concreta y verificable (ej: cambio de procedimiento, ingeniería).',
  },
  {
    pattern: /\b(tener m[aá]s cuidado|estar atentos?|prestar atenci[oó]n)\b/i,
    suggestion: 'Una acción sobre el comportamiento individual NO previene reincidencia sistémica.',
  },
  {
    pattern: /\b(supervisar mejor|aumentar supervisi[oó]n)\b/i,
    suggestion: 'Define qué control de ingeniería o admin reduciría la necesidad de supervisión humana.',
  },
  {
    pattern: /\b(usar siempre el EPP|usar correctamente)\b/i,
    suggestion: 'EPP es el último nivel. Antes evalúa eliminación, sustitución, ingeniería.',
  },
];

const MIN_DESCRIPTION_LENGTH = 30;

export function detectWeakLanguage(action: CorrectiveAction): WeakLanguageReport | null {
  const found: string[] = [];
  const suggestions: string[] = [];

  for (const { pattern, suggestion } of WEAK_PHRASES) {
    const match = action.description.match(pattern);
    if (match) {
      found.push(match[0]);
      if (!suggestions.includes(suggestion)) suggestions.push(suggestion);
    }
  }

  // Acciones cortas también son débiles
  if (action.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    found.push('descripcion_corta');
    suggestions.unshift(
      `Acción demasiado breve (${action.description.trim().length} chars). Mínimo ${MIN_DESCRIPTION_LENGTH}.`,
    );
  }

  if (found.length === 0) return null;
  return {
    actionId: action.id,
    weakPhrases: found,
    suggestion: suggestions.join(' • '),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Action level classification (§326)
// ────────────────────────────────────────────────────────────────────────

const LEVEL_KEYWORDS: Array<{ level: CorrectiveActionLevel; patterns: RegExp[] }> = [
  {
    level: 'elimination',
    patterns: [/eliminar?\b/i, /quitar\b/i, /remover\b/i, /descontinuar\b/i],
  },
  {
    level: 'engineering',
    patterns: [
      /instalar?\b/i,
      /aislar\b/i,
      /encapsular\b/i,
      /barrera (f[ií]sica)?/i,
      /ventilaci[oó]n\b/i,
      /interlock\b/i,
      /sensor\b/i,
    ],
  },
  {
    level: 'epp',
    patterns: [/arn[eé]s/i, /guantes?\b/i, /casco\b/i, /m[áa]scara/i, /epp\b/i],
  },
  {
    level: 'training',
    patterns: [/capacitar|capacitaci[oó]n|curso|charla|inducci[oó]n/i],
  },
  {
    level: 'supervision',
    patterns: [/supervisar|vig[ií]a|presencia del supervisor/i],
  },
  {
    level: 'communication',
    patterns: [/comunicar|notificar|informar|difundir/i],
  },
  {
    level: 'administrative',
    patterns: [/procedimiento|política|instructivo|checklist/i],
  },
];

export function classifyActionLevel(description: string): CorrectiveActionLevel | null {
  for (const { level, patterns } of LEVEL_KEYWORDS) {
    if (patterns.some((p) => p.test(description))) return level;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Portfolio balance (§327)
// ────────────────────────────────────────────────────────────────────────

export interface ActionBalanceReport {
  total: number;
  byLevel: Record<CorrectiveActionLevel, number>;
  /** % de acciones que son `training`. */
  trainingShare: number;
  /** % de acciones que son `engineering` o más altas. */
  highTierShare: number;
  /** True si >70% son training → desequilibrio. */
  isImbalanced: boolean;
  /** Mensaje humano para el dashboard. */
  message: string;
}

export function buildBalanceReport(actions: CorrectiveAction[]): ActionBalanceReport {
  const byLevel: Record<CorrectiveActionLevel, number> = {
    elimination: 0,
    engineering: 0,
    administrative: 0,
    training: 0,
    epp: 0,
    supervision: 0,
    communication: 0,
  };

  for (const a of actions) {
    const level = a.level ?? classifyActionLevel(a.description);
    if (level) byLevel[level] += 1;
  }

  const total = Object.values(byLevel).reduce((s, n) => s + n, 0);
  const trainingShare = total > 0 ? byLevel.training / total : 0;
  const highTierShare = total > 0 ? (byLevel.elimination + byLevel.engineering) / total : 0;
  const isImbalanced = trainingShare > 0.7;

  let message = 'Portfolio balanceado.';
  if (isImbalanced) {
    message = `Desequilibrio: ${Math.round(trainingShare * 100)}% de las acciones son capacitaciones. Eleva más controles de ingeniería/eliminación.`;
  } else if (highTierShare === 0 && total > 0) {
    message = 'Ninguna acción de ingeniería o eliminación. Considera elevar al menos una.';
  }

  return { total, byLevel, trainingShare, highTierShare, isImbalanced, message };
}

// ────────────────────────────────────────────────────────────────────────
// Duplicate detection (§329)
// ────────────────────────────────────────────────────────────────────────

export interface DuplicateCluster {
  /** Hash normalizado de la descripción (clave del cluster). */
  fingerprint: string;
  actionIds: string[];
  /** Sugerencia: convertir en acción sistémica. */
  suggestion: string;
}

function fingerprint(description: string): string {
  return description
    .toLowerCase()
    .replace(/[áàä]/g, 'a')
    .replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 8) // primeras 8 palabras
    .join(' ');
}

export function detectDuplicateActions(
  actions: CorrectiveAction[],
  minClusterSize = 3,
): DuplicateCluster[] {
  const clusters = new Map<string, string[]>();
  for (const a of actions) {
    const fp = fingerprint(a.description);
    if (!clusters.has(fp)) clusters.set(fp, []);
    clusters.get(fp)!.push(a.id);
  }
  return [...clusters.entries()]
    .filter(([, ids]) => ids.length >= minClusterSize)
    .map(([fp, ids]) => ({
      fingerprint: fp,
      actionIds: ids,
      suggestion: `Acciones repetitivas (${ids.length}). Considera consolidar en una acción sistémica multi-proyecto.`,
    }));
}

// ────────────────────────────────────────────────────────────────────────
// Recidivism check (§331)
// ────────────────────────────────────────────────────────────────────────

export interface RecidivismCheckInput {
  /** Acción cerrada cuya eficacia queremos verificar. */
  closedAction: { id: string; sourceCause: string; closedAt: string };
  /** Incidentes posteriores con la misma causa. */
  laterIncidentsSameCause: Array<{ id: string; occurredAt: string }>;
}

export interface RecidivismReport {
  actionId: string;
  recurredInDays: number | null;
  hasRecurrence: boolean;
  /** Severidad del flag — más rápido se repite, más severo. */
  severity: 'none' | 'low' | 'medium' | 'high';
}

export function checkRecidivism(input: RecidivismCheckInput): RecidivismReport {
  const closedAtMs = Date.parse(input.closedAction.closedAt);
  let earliestRecurrenceMs = Infinity;
  for (const inc of input.laterIncidentsSameCause) {
    const incMs = Date.parse(inc.occurredAt);
    if (incMs > closedAtMs && incMs < earliestRecurrenceMs) {
      earliestRecurrenceMs = incMs;
    }
  }
  if (earliestRecurrenceMs === Infinity) {
    return {
      actionId: input.closedAction.id,
      recurredInDays: null,
      hasRecurrence: false,
      severity: 'none',
    };
  }
  const days = Math.floor((earliestRecurrenceMs - closedAtMs) / 86_400_000);
  const severity: 'low' | 'medium' | 'high' = days < 30 ? 'high' : days < 90 ? 'medium' : 'low';
  return {
    actionId: input.closedAction.id,
    recurredInDays: days,
    hasRecurrence: true,
    severity,
  };
}

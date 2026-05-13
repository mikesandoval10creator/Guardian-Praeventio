// Praeventio Guard — Sprint K Fase §191: Modo Investigación Causa Raíz Avanzado.
//
// Cierra: Documento usuario "§191 — Modo Investigación".
//
// Complementa rootCauseClassifier (taxonomía estadística) con un flujo
// guiado pregunta-respuesta para incidentes complejos:
//   - Construye árbol "5 Why's" con nodos anidados
//   - Detecta respuestas superficiales ("error humano" sin profundizar)
//   - Sugiere próximas preguntas según las 6M de Ishikawa
//     (Machine, Method, Material, Measurement, Man, Environment)
//
// Determinístico, sin LLM. Pensado para uso en terreno + auditoría externa.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SixMCategory =
  | 'machine'
  | 'method'
  | 'material'
  | 'measurement'
  | 'man'
  | 'environment';

export interface InvestigationNode {
  /** Identificador estable dentro del árbol. */
  id: string;
  /** Pregunta del facilitador (típicamente un "¿Por qué...?"). */
  question: string;
  /** Respuesta del participante. */
  answer: string;
  /** Categoría 6M detectada (heurístico). */
  category: SixMCategory;
  /** Profundidad (0 = raíz). */
  depth: number;
  /** True si la respuesta se considera superficial. */
  shallow: boolean;
  /** Hijos (sub-porqués). */
  children: InvestigationNode[];
}

export interface InvestigationTree {
  incidentId: string;
  /** Pregunta inicial (lo que se investiga). */
  rootQuestion: string;
  root: InvestigationNode;
  /** Categorías 6M cubiertas por el árbol. */
  coveredCategories: SixMCategory[];
  /** Sugerencia de próxima pregunta (categoría 6M no cubierta o nodo shallow). */
  nextQuestion: NextQuestionHint | null;
}

export interface NextQuestionHint {
  /** Categoría 6M sugerida. */
  category: SixMCategory;
  /** Texto sugerido. */
  text: string;
  /** Si el motivo es profundizar un nodo shallow, su id. */
  targetNodeId?: string;
  reason: 'shallow_answer' | 'uncovered_category';
}

export class InvestigationValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'InvestigationValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Shallow-answer detection
// ────────────────────────────────────────────────────────────────────────

const SHALLOW_TERMS = [
  'error humano',
  'descuido',
  'mala suerte',
  'no se sabe',
  'no sé',
  'no aplica',
  'porque sí',
  'siempre pasa',
  'estaba distraído',
  'fue culpa de',
];

/** Heurístico: <=4 palabras o contiene un término shallow conocido. */
export function isShallowAnswer(answer: string): boolean {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return true;
  return SHALLOW_TERMS.some((t) => trimmed.includes(t));
}

// ────────────────────────────────────────────────────────────────────────
// 6M routing
// ────────────────────────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<SixMCategory, string[]> = {
  machine: ['máquina', 'maquina', 'equipo', 'herramienta', 'vehículo', 'vehiculo', 'motor', 'sensor'],
  method: ['procedimiento', 'instructivo', 'protocolo', 'método', 'metodo', 'paso', 'norma interna'],
  material: ['material', 'químico', 'quimico', 'insumo', 'pieza', 'lote', 'epp', 'producto'],
  measurement: ['medición', 'medicion', 'calibración', 'calibracion', 'lectura', 'sensor', 'control de calidad'],
  man: ['trabajador', 'operador', 'supervisor', 'capacitación', 'capacitacion', 'fatiga', 'entrenamiento'],
  environment: ['clima', 'lluvia', 'temperatura', 'ruido', 'iluminación', 'iluminacion', 'piso', 'ventilación', 'ventilacion'],
};

export function classifyCategory(text: string): SixMCategory {
  const lc = text.toLowerCase();
  let bestCat: SixMCategory = 'man';
  let bestScore = 0;
  for (const cat of Object.keys(CATEGORY_KEYWORDS) as SixMCategory[]) {
    let score = 0;
    for (const kw of CATEGORY_KEYWORDS[cat]) {
      if (lc.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }
  return bestCat;
}

const SUGGESTION_BY_CATEGORY: Record<SixMCategory, string> = {
  machine: '¿Estaba la máquina o equipo en condiciones operativas? ¿Mantención al día?',
  method: '¿Existía un procedimiento escrito? ¿El trabajador lo conocía y lo aplicó?',
  material: '¿Los materiales o EPP eran los adecuados y estaban en buen estado?',
  measurement: '¿Hubo mediciones, controles o calibraciones previas que detectaran la anomalía?',
  man: '¿Qué factores humanos (fatiga, capacitación, presión) estaban presentes?',
  environment: '¿Cómo influyeron las condiciones ambientales (clima, piso, iluminación, ruido)?',
};

// ────────────────────────────────────────────────────────────────────────
// Tree build
// ────────────────────────────────────────────────────────────────────────

export interface NodeInput {
  id: string;
  question: string;
  answer: string;
  children?: NodeInput[];
}

export interface BuildTreeInput {
  incidentId: string;
  rootQuestion: string;
  root: NodeInput;
}

const ALL_CATEGORIES: SixMCategory[] = [
  'machine',
  'method',
  'material',
  'measurement',
  'man',
  'environment',
];

export function buildInvestigationTree(input: BuildTreeInput): InvestigationTree {
  if (!input.incidentId || !input.incidentId.trim()) {
    throw new InvestigationValidationError('NO_INCIDENT', 'incidentId requerido');
  }
  if (!input.rootQuestion || !input.rootQuestion.trim()) {
    throw new InvestigationValidationError('NO_ROOT_QUESTION', 'rootQuestion requerido');
  }
  const seenIds = new Set<string>();
  const root = buildNode(input.root, 0, seenIds);

  const covered = new Set<SixMCategory>();
  collectCategories(root, covered);
  const coveredCategories = ALL_CATEGORIES.filter((c) => covered.has(c));

  const nextQuestion = computeNextQuestion(root, coveredCategories);

  return {
    incidentId: input.incidentId,
    rootQuestion: input.rootQuestion,
    root,
    coveredCategories,
    nextQuestion,
  };
}

function buildNode(node: NodeInput, depth: number, seenIds: Set<string>): InvestigationNode {
  if (!node.id || !node.id.trim()) {
    throw new InvestigationValidationError('NO_NODE_ID', 'cada nodo necesita id');
  }
  if (seenIds.has(node.id)) {
    throw new InvestigationValidationError('DUPLICATE_ID', `id duplicado: ${node.id}`);
  }
  seenIds.add(node.id);
  if (depth > 5) {
    throw new InvestigationValidationError('TOO_DEEP', 'árbol excede 5 niveles');
  }
  const text = `${node.question} ${node.answer}`;
  const category = classifyCategory(text);
  const shallow = isShallowAnswer(node.answer);
  const children = (node.children ?? []).map((c) => buildNode(c, depth + 1, seenIds));
  return {
    id: node.id,
    question: node.question,
    answer: node.answer,
    category,
    depth,
    shallow,
    children,
  };
}

function collectCategories(node: InvestigationNode, out: Set<SixMCategory>): void {
  out.add(node.category);
  for (const c of node.children) collectCategories(c, out);
}

function findFirstShallow(node: InvestigationNode): InvestigationNode | null {
  if (node.shallow && node.children.length === 0) return node;
  for (const c of node.children) {
    const found = findFirstShallow(c);
    if (found) return found;
  }
  return null;
}

function computeNextQuestion(
  root: InvestigationNode,
  covered: SixMCategory[],
): NextQuestionHint | null {
  const shallow = findFirstShallow(root);
  if (shallow) {
    return {
      category: shallow.category,
      text: `Profundiza: "${shallow.answer}" es muy general. ${SUGGESTION_BY_CATEGORY[shallow.category]}`,
      targetNodeId: shallow.id,
      reason: 'shallow_answer',
    };
  }
  const coveredSet = new Set(covered);
  const uncovered = ALL_CATEGORIES.find((c) => !coveredSet.has(c));
  if (uncovered) {
    return {
      category: uncovered,
      text: SUGGESTION_BY_CATEGORY[uncovered],
      reason: 'uncovered_category',
    };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Convenience: extract 5-Whys chain from deepest branch
// ────────────────────────────────────────────────────────────────────────

export function extractDeepestChain(tree: InvestigationTree): string[] {
  const chain: string[] = [];
  let cursor: InvestigationNode | null = tree.root;
  while (cursor) {
    chain.push(cursor.question);
    if (cursor.children.length === 0) break;
    cursor = cursor.children.reduce((deepest, c) => {
      if (!deepest) return c;
      return subtreeDepth(c) > subtreeDepth(deepest) ? c : deepest;
    }, null as InvestigationNode | null);
  }
  return chain;
}

function subtreeDepth(node: InvestigationNode): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(subtreeDepth));
}

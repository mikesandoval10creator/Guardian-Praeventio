// Praeventio Guard — Sprint K §156: Prompts versionados.
//
// Catálogo canónico de prompts emitidos por el sistema hacia LLMs (Gemini,
// Vertex, SLM offline). Cada prompt es identificable por `id + version` y
// expone metadatos críticos para la capa de guardrails:
//
//   • `allowedTools`  → qué tool-calls puede emitir el LLM con este prompt
//   • `maxTokens`     → cap duro sobre el output (refuerzo del adapter)
//   • `citations`     → política de citation enforcement
//
// Histórico mínimo de 3 versiones por prompt: cuando un prompt se evoluciona
// (bump version), las versiones anteriores permanecen accesibles para
// rollback, comparación o reproducción de respuestas históricas. Eso es lo
// que hace este módulo "versionado" y no solo "un diccionario de strings".
//
// 100% determinístico. Sin I/O. Sin LLM. Solo lookup en tabla en memoria.

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/**
 * Política de citations exigida sobre la respuesta del LLM.
 *
 *   - `required`: toda afirmación factual debe ir con `[n]` donde `n` es un
 *     índice válido de la lista de sources. `citationValidator` exige
 *     existencia + validez. `hallucinationGuard` aplica heurísticas
 *     adicionales (números, fechas, leyes específicas → citation o bloqueo).
 *   - `optional`: el LLM puede citar pero no es obligatorio. Si emite `[n]`
 *     que no existe, sigue siendo error (citation inventada).
 */
export type CitationPolicy = 'required' | 'optional';

/**
 * Definición canónica de un prompt versionado.
 *
 * `id` + `version` es la clave única. Dos prompts con el mismo `id` y
 * `version` distinta son la misma "intención" en momentos distintos del
 * tiempo — útil para A/B, regresión y rollback.
 */
export interface VersionedPrompt {
  /** Identificador estable del prompt, ej. `'rag.zk.query'`. */
  readonly id: string;
  /** Semver del prompt, ej. `'1.0.0'`. */
  readonly version: string;
  /**
   * Cuerpo del prompt. Puede contener placeholders `{{var}}` que se
   * resuelven en tiempo de llamada por el wrapper (no por este módulo).
   */
  readonly body: string;
  /**
   * Tools permitidas que el LLM puede invocar con este prompt. Vacío =
   * texto plano, ningún function-call. El adapter debe verificar contra
   * esta lista antes de aceptar tool-calls del modelo.
   */
  readonly allowedTools: ReadonlyArray<string>;
  /** Cap duro sobre el número de tokens de salida. */
  readonly maxTokens: number;
  /** Política de citations exigida sobre la respuesta. */
  readonly citations: CitationPolicy;
}

/**
 * Error lanzado cuando se pide un prompt que no existe en el catálogo.
 *
 * Esta es una falla del programador (typo en el id, version no liberada)
 * — el wrapper debe surfacear esto loud porque el comportamiento de
 * fallback "usar string vacío" produce alucinaciones silenciosas.
 */
export class UnknownPromptError extends Error {
  constructor(promptId: string, version: string) {
    super(`unknown prompt: '${promptId}@${version}'`);
    this.name = 'UnknownPromptError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Catálogo de prompts canónicos
// ────────────────────────────────────────────────────────────────────────

/**
 * Tabla canónica de prompts. Cada entry es:
 *
 *   `<id>@<version>` → VersionedPrompt
 *
 * Cuando se evoluciona un prompt, NUNCA reescribir la entry existente —
 * agregar una nueva con version bumpeada. La política del módulo es
 * mantener mínimo las últimas 3 versiones de cada `id`.
 *
 * Sobre el contenido de los prompts: estos son cuerpos canónicos. Los
 * placeholders `{{var}}` se resuelven en otro lado (renderPrompt en el
 * `aiGuardrails.ts` legacy o en el wrapper). Aquí solo guardamos el
 * texto crudo.
 */
const PROMPT_CATALOG: ReadonlyArray<VersionedPrompt> = [
  // ────────────────────────────────────────────────────────────────────
  // rag.zk.query — RAG sobre Zettelkasten
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'rag.zk.query',
    version: '1.0.0',
    body:
      'Responde la pregunta usando SOLO los nodos del contexto.\n' +
      'Pregunta: {{question}}\n' +
      'Contexto: {{context}}',
    allowedTools: [],
    maxTokens: 1024,
    citations: 'required',
  },
  {
    id: 'rag.zk.query',
    version: '1.1.0',
    body:
      'Responde la pregunta usando SOLO los nodos del contexto.\n' +
      'Cita los nodos como [n] donde n es el índice del nodo.\n' +
      'Si no hay info suficiente, dilo explícitamente.\n' +
      'Pregunta: {{question}}\n' +
      'Contexto: {{context}}',
    allowedTools: [],
    maxTokens: 1024,
    citations: 'required',
  },
  {
    id: 'rag.zk.query',
    version: '2.0.0',
    body:
      'Eres un asistente de prevención de riesgos. Responde la pregunta ' +
      'usando ÚNICAMENTE los nodos del contexto provisto.\n\n' +
      'Reglas:\n' +
      '1. Toda afirmación factual debe tener citation [n] al nodo fuente.\n' +
      '2. Si no hay info suficiente, responde: "No tengo información ' +
      'suficiente en el contexto."\n' +
      '3. NO emitas diagnósticos médicos ni asesoría legal vinculante.\n\n' +
      'Pregunta: {{question}}\n' +
      'Contexto: {{context}}',
    allowedTools: [],
    maxTokens: 1024,
    citations: 'required',
  },

  // ────────────────────────────────────────────────────────────────────
  // safety.epp.suggest — sugerencia de EPP
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'safety.epp.suggest',
    version: '1.0.0',
    body:
      'Tarea: {{task}}\nSugerencias de EPP en formato lista.',
    allowedTools: [],
    maxTokens: 512,
    citations: 'optional',
  },
  {
    id: 'safety.epp.suggest',
    version: '1.1.0',
    body:
      'Sugiere EPP apropiado para la tarea.\n' +
      'Tarea: {{task}}\n' +
      'Contexto normativo: {{context}}\n' +
      'Formato: lista con citation al artículo legal correspondiente.',
    allowedTools: [],
    maxTokens: 512,
    citations: 'required',
  },
  {
    id: 'safety.epp.suggest',
    version: '2.0.0',
    body:
      'Eres asistente de seguridad ocupacional. Sugiere EPP apropiado.\n' +
      'Tarea: {{task}}\n' +
      'Riesgos identificados: {{risks}}\n' +
      'Contexto normativo: {{context}}\n' +
      'Devuelve lista citando [n] al artículo legal por cada item.',
    allowedTools: [],
    maxTokens: 768,
    citations: 'required',
  },

  // ────────────────────────────────────────────────────────────────────
  // incidents.summarize — resumen de incidente
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'incidents.summarize',
    version: '1.0.0',
    body: 'Resume el incidente: {{description}}',
    allowedTools: [],
    maxTokens: 512,
    citations: 'optional',
  },
  {
    id: 'incidents.summarize',
    version: '1.1.0',
    body:
      'Resume el incidente preservando datos críticos.\n' +
      'Descripción: {{description}}\n' +
      'Formato: 3 párrafos (qué, cuándo, dónde).',
    allowedTools: [],
    maxTokens: 512,
    citations: 'optional',
  },
  {
    id: 'incidents.summarize',
    version: '2.0.0',
    body:
      'Resume el incidente. NO inventes datos no provistos.\n' +
      'Descripción: {{description}}\n' +
      'Evidencias adjuntas: {{evidence}}\n' +
      'Formato: hechos verificables + clasificación tentativa.',
    allowedTools: [],
    maxTokens: 768,
    citations: 'optional',
  },
];

// ────────────────────────────────────────────────────────────────────────
// API pública
// ────────────────────────────────────────────────────────────────────────

/**
 * Recupera un prompt canónico por `id + version`.
 *
 * @throws {UnknownPromptError} si no existe esa combinación. Es intencional
 *   — fallar loud evita alucinaciones por strings vacíos.
 *
 * Ejemplo:
 * ```ts
 * const p = getPrompt('rag.zk.query', '2.0.0');
 * // p.body es el texto canónico
 * // p.citations === 'required' → el wrapper exige citations en la respuesta
 * ```
 */
export function getPrompt(promptId: string, version: string): VersionedPrompt {
  const found = PROMPT_CATALOG.find(
    (p) => p.id === promptId && p.version === version,
  );
  if (!found) {
    throw new UnknownPromptError(promptId, version);
  }
  return found;
}

/**
 * Lista todas las versiones disponibles para un `promptId`, en orden de
 * aparición en el catálogo (cronológico por convención).
 *
 * Retorna `[]` si el id no existe en el catálogo (NO lanza — útil para
 * UIs de exploración).
 */
export function listVersions(promptId: string): ReadonlyArray<string> {
  return PROMPT_CATALOG.filter((p) => p.id === promptId).map((p) => p.version);
}

/**
 * Lista todos los `promptId` únicos del catálogo. Útil para UIs de
 * exploración y validación de cobertura (¿están todos los call sites
 * apuntando a IDs que existen?).
 */
export function listPromptIds(): ReadonlyArray<string> {
  const ids = new Set<string>();
  for (const p of PROMPT_CATALOG) ids.add(p.id);
  return Array.from(ids);
}

/**
 * Recupera la última versión registrada para un `promptId`. Útil para
 * call sites que quieren "siempre la última" sin pinear versión.
 *
 * @throws {UnknownPromptError} si el id no existe.
 */
export function getLatestVersion(promptId: string): VersionedPrompt {
  const versions = PROMPT_CATALOG.filter((p) => p.id === promptId);
  if (versions.length === 0) {
    throw new UnknownPromptError(promptId, '*');
  }
  return versions[versions.length - 1]!;
}

/**
 * Vista de solo lectura del catálogo completo, para tests + auditoría.
 * NO mutable — es un array readonly.
 */
export function getCatalog(): ReadonlyArray<VersionedPrompt> {
  return PROMPT_CATALOG;
}

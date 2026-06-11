/**
 * Resilient AI Orchestrator — tiered fallback for emergency scenarios.
 *
 * Promise del producto al usuario: "la IA NUNCA falla". Significa que
 * cuando un trabajador en mina sin señal aprieta el asistente de IA,
 * la app entrega SIEMPRE algo útil — incluso si el SLM offline crashea,
 * Firestore está cortado, y Gemini no responde.
 *
 * La forma de cumplirlo es un pipeline de N tiers, cada uno
 * progresivamente más simple pero más confiable. El orchestrator
 * intenta el tier 1 (SLM local), y si falla cae al 2, al 3, etc.,
 * hasta llegar al tier de último recurso que es una respuesta canned
 * derivada del contexto disponible.
 *
 * Tier 1 — SLM offline (ONNX Runtime Web, WebGPU/WASM local).
 *           Mejor calidad. Funciona sin red. Puede crashear por OOM
 *           (iOS 4GB cap), shader compile errors, o cache corrupto.
 *
 * Tier 2 — Zettelkasten RAG. Búsqueda en el grafo de conocimiento
 *           del tenant + respuesta basada en nodos/edges (sin IA
 *           generativa). Determinístico, citation-grade.
 *
 * Tier 3 — Firestore knowledge base. Procedimientos / FAQ /
 *           normativas pre-curadas que viven en Firestore. Funciona
 *           offline gracias al persistence layer de Firebase, pero
 *           requiere que el cache local esté poblado.
 *
 * Tier 4 — Gemini server. LLM remoto. Requiere conectividad. Última
 *           opción porque consume cuota + tiene latencia + no
 *           respeta política offline-first.
 *
 * Tier 5 — Canned fallback. Respuesta hardcoded por dominio (medical,
 *           safety, emergency). Sirve como red de seguridad cuando
 *           TODO lo demás falla. Incluye un disclaimer claro.
 *
 * El caller (UI) recibe siempre una `AiResponse` con:
 *   - `text` — la respuesta
 *   - `tier` — qué tier la generó (para telemetría)
 *   - `confidence` — score 0..1 (alto en tier 1, bajo en tier 5)
 *   - `citations[]` — refs a normativas / nodos / fuente (opcional)
 *   - `degraded` — true si NO fue tier 1; UI puede mostrar banner
 */

export type AiTier = 'slm' | 'zettelkasten' | 'firestore' | 'gemini' | 'canned';

export interface AiQuery {
  /** El prompt del usuario. */
  prompt: string;
  /** Dominio de la pregunta (para canned + para dirigir RAG). */
  domain?: AiDomain;
  /** UID del tenant (para Firestore RAG / ZK). */
  tenantId?: string;
  /** UID del usuario (para personalización + audit). */
  userUid?: string;
  /** Contexto adicional (proyecto, ubicación, etc.). */
  context?: Record<string, string | number | boolean>;
  /**
   * Streaming hook OPCIONAL — el adapter SLM (y cualquier otro que
   * soporte streaming) lo invoca por cada token generado. Los adapters
   * que no soportan streaming simplemente ignoran este campo.
   *
   * El orchestrator NO interpreta este hook: solo lo pasa abajo. Caller
   * lo cablea para alimentar la UI mientras la respuesta se construye.
   */
  onStreamToken?: (token: string) => void;
}

export type AiDomain =
  | 'emergency'
  | 'epp'
  | 'medical'
  | 'normative'
  | 'training'
  | 'maintenance'
  | 'general';

export interface AiCitation {
  /** Tipo de fuente. */
  kind: 'node' | 'normative' | 'procedure' | 'faq';
  /** ID interno o ref legible. */
  ref: string;
  /** Texto humano para mostrar (opcional). */
  label?: string;
}

export interface AiResponse {
  text: string;
  tier: AiTier;
  /** 0..1 — mayor = mejor calidad. */
  confidence: number;
  citations: AiCitation[];
  /** True si NO fue servido por el tier preferido. */
  degraded: boolean;
  /** Latencia total del orchestrator en ms. */
  latencyMs: number;
  /** Errores acumulados por tier (debug + telemetría). */
  tierErrors: Array<{ tier: AiTier; error: string }>;
}

// ────────────────────────────────────────────────────────────────────────
// Tier adapters — caller-injected so we don't hard-couple a runtime
// ────────────────────────────────────────────────────────────────────────

/**
 * Un "tier function" recibe la query y devuelve `null` si NO puede
 * responder (caller cae al siguiente tier) o `AiResponse` parcial
 * (sin `tier`, `degraded`, `latencyMs`, `tierErrors` — el orchestrator
 * los llena). Si lanza, el orchestrator captura el error y cae al
 * siguiente tier con el error guardado para telemetría.
 */
export type TierAdapter = (query: AiQuery) => Promise<TierAdapterResult | null>;

export interface TierAdapterResult {
  text: string;
  confidence: number;
  citations?: AiCitation[];
}

export interface OrchestratorAdapters {
  slm?: TierAdapter;
  zettelkasten?: TierAdapter;
  firestore?: TierAdapter;
  gemini?: TierAdapter;
}

// ────────────────────────────────────────────────────────────────────────
// Canned fallback (tier 5) — last-resort responses per domain
// ────────────────────────────────────────────────────────────────────────

const CANNED_BY_DOMAIN: Record<AiDomain, { text: string; confidence: number }> = {
  emergency: {
    text:
      'EMERGENCIA: ' +
      'Activa el SOS desde el botón rojo. ' +
      'Llama al 131 (SAMU), 132 (Bomberos) o 133 (Carabineros). ' +
      'Mantén la calma, evalúa la escena antes de actuar, y NO muevas a la víctima salvo riesgo inminente. ' +
      'Si hay sangrado: presión directa con paño limpio. ' +
      'Si hay paro cardio-respiratorio y estás capacitado: inicia RCP (30 compresiones / 2 ventilaciones).',
    confidence: 0.5,
  },
  epp: {
    text:
      'Recuerda el EPP obligatorio según tu tarea: ' +
      'casco con barbiquejo, lentes de seguridad, calzado con punta de acero, ' +
      'arnés y línea de vida si trabajas a >1.8m de altura, ' +
      'guantes apropiados para la sustancia/material, ' +
      'protección auditiva si el ruido excede 85 dB. ' +
      'Verifica que todo esté en buen estado antes de iniciar. Si falta algo, NO inicies la tarea.',
    confidence: 0.4,
  },
  medical: {
    text:
      'Si tienes una urgencia médica en faena, contacta al policlínico de la empresa o al servicio mutual. ' +
      'Para sospecha de enfermedad profesional, debes declarar DIAT/DIEP en mutualidad dentro de las 24 horas siguientes al diagnóstico. ' +
      'Si estás herido, NO trates de continuar trabajando — informa a tu supervisor inmediatamente.',
    confidence: 0.4,
  },
  normative: {
    text:
      'Esta consulta requiere referencia a normativa específica. ' +
      'Las principales normativas chilenas vigentes son: Ley 16.744 (accidentes del trabajo), ' +
      'DS 594 (condiciones sanitarias y ambientales), DS 76 (subcontratación), ' +
      'DS 132 (minería), DS 109 (calificación de enfermedades). ' +
      'Consulta a tu CPHS o departamento de prevención para aplicación específica a tu caso.',
    confidence: 0.3,
  },
  training: {
    text:
      'Para verificar tu capacitación vigente, revisa el módulo Capacitaciones en la app. ' +
      'Las capacitaciones obligatorias dependen de tu rol: ' +
      'ODI (Obligación de Informar) para todos los trabajadores, ' +
      'capacitación específica para trabajos en altura, espacios confinados, ' +
      'electricidad, izaje, manejo de cargas. ' +
      'Si tu capacitación está vencida, NO ejecutes la tarea asociada.',
    confidence: 0.4,
  },
  maintenance: {
    text:
      'Antes de operar cualquier equipo, ejecuta el checklist pre-operacional. ' +
      'NUNCA operes un equipo con defectos detectados — repórtalo y aíslalo. ' +
      'Para mantención preventiva, sigue el calendario del horómetro de la máquina. ' +
      'Toda mantención correctiva debe estar autorizada por el supervisor de mantenimiento.',
    confidence: 0.4,
  },
  general: {
    text:
      'No tengo información suficiente para responder con certeza. ' +
      'Te recomiendo consultar a tu supervisor o al departamento de prevención. ' +
      'Si la consulta es urgente o relacionada con seguridad inmediata, ' +
      'no esperes — activa los protocolos de emergencia.',
    confidence: 0.2,
  },
};

function cannedFallback(query: AiQuery): TierAdapterResult {
  const domain = query.domain ?? detectDomain(query.prompt);
  const canned = CANNED_BY_DOMAIN[domain];
  return {
    text: canned.text,
    confidence: canned.confidence,
    citations: [],
  };
}

/**
 * Heurística simple para detectar dominio cuando el caller no lo pasa.
 * Pure — sin LLM. Solo keywords.
 */
export function detectDomain(prompt: string): AiDomain {
  // Substring matching — `\b` word boundaries en JS son ASCII-only y
  // rompen con caracteres acentuados (caída, mantención, hipoacusia).
  // Para detectar dominio basta con substring contains.
  const p = prompt.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => p.includes(n));

  if (
    has(
      'sos',
      'emergencia',
      'herido',
      'accidente',
      'caida',
      'caída',
      'cai del',
      'caí del',
      'incendio',
      'sangr', // sangrad-o, sangr-ando, sangr-iento — todas las flexiones
      'paro card',
      'paro respi',
      'evacua',
    )
  ) {
    return 'emergency';
  }
  if (has('epp', 'casco', 'arnes', 'arnés', 'guantes', 'lentes', 'botas', 'protección', 'proteccion')) {
    return 'epp';
  }
  if (
    has(
      'diat',
      'diep',
      'medico',
      'médico',
      'mutual',
      ' salud',
      'examen',
      'aptitud',
      'silicosis',
      'hipoacusia',
    )
  ) {
    return 'medical';
  }
  if (
    has(
      'ds 5',
      'ds 6',
      'ds 7',
      'ds 1',
      'ds5',
      'ds6',
      'ds7',
      'ds1',
      'ley 16',
      'ley 19',
      'ley 20',
      'ley16',
      'ley19',
      'ley20',
      'normativa',
      'reglamento',
      'articulo',
      'artículo',
      'art.',
    )
  ) {
    return 'normative';
  }
  if (has('capacit', 'curso', ' odi', 'certificad', 'entrenam')) {
    return 'training';
  }
  if (
    has(
      'mantenc',
      'mantención',
      'mantencion',
      'mantenimi',
      'horometro',
      'horómetro',
      'averia',
      'avería',
      'operacion del',
      'operación del',
    )
  ) {
    return 'maintenance';
  }
  return 'general';
}

// ────────────────────────────────────────────────────────────────────────
// Tier execution helper — runs an adapter under a timeout, swallows
// errors into the result.
// ────────────────────────────────────────────────────────────────────────

interface TryTierOptions {
  timeoutMs: number;
}

async function tryTier(
  tier: AiTier,
  adapter: TierAdapter | undefined,
  query: AiQuery,
  opts: TryTierOptions,
): Promise<{ result: TierAdapterResult; tier: AiTier } | { error: string }> {
  if (!adapter) return { error: `${tier}: no adapter` };
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutP = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`${tier}: timeout after ${opts.timeoutMs}ms`)),
        opts.timeoutMs,
      );
    });
    const adapterP = adapter(query);
    const result = await Promise.race([adapterP, timeoutP]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!result) return { error: `${tier}: returned null` };
    return { result, tier };
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return { error: `${tier}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ────────────────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  /** Timeout per tier en ms. Default 8000ms. */
  tierTimeoutMs?: number;
  /**
   * Si está set, el orchestrator SÓLO intenta estos tiers (en orden).
   * Útil para emergencias donde queremos solo respuesta local (slm +
   * zettelkasten + canned), saltando Gemini que requiere red.
   */
  allowedTiers?: AiTier[];
  /** Override `performance.now()` para tests. */
  nowMs?: () => number;
}

const DEFAULT_TIERS: AiTier[] = ['slm', 'zettelkasten', 'firestore', 'gemini'];

/**
 * B14 (2026-06-11) — connectivity-aware tier order, honoring the contract
 * the legacy `services/slm/orchestrator.ts` always had:
 *
 *   - ONLINE  → Gemini is PRIMARY (quality); the on-device SLM is the
 *               fallback when the server call fails. Then the local
 *               knowledge tiers.
 *   - OFFLINE → la escalera on-device: SLM → Zettelkasten (RAG con seed
 *               bundle siempre disponible) → Firestore cache local.
 *               Gemini se omite por completo (no hay red). Si todo
 *               falla, el orchestrator entrega el canned fallback con
 *               disclaimer honesto — nunca una respuesta fabricada.
 *
 * Callers (e.g. `ResilientAiAssistantPanel`) compute this per-ask from
 * `navigator.onLine` and pass it as `allowedTiers`.
 */
export function resolveTiersForConnectivity(online: boolean): AiTier[] {
  return online
    ? ['gemini', 'slm', 'zettelkasten', 'firestore']
    : ['slm', 'zettelkasten', 'firestore'];
}

export async function answer(
  query: AiQuery,
  adapters: OrchestratorAdapters,
  opts: OrchestratorOptions = {},
): Promise<AiResponse> {
  const now = opts.nowMs ?? (() => Date.now());
  const startedAt = now();
  const timeoutMs = opts.tierTimeoutMs ?? 8000;
  const allowed = opts.allowedTiers ?? DEFAULT_TIERS;
  const tierErrors: AiResponse['tierErrors'] = [];

  for (const tier of allowed) {
    const adapter = adapters[tier as Exclude<AiTier, 'canned'>];
    const r = await tryTier(tier, adapter, query, { timeoutMs });
    if ('result' in r) {
      const latencyMs = now() - startedAt;
      return {
        text: r.result.text,
        tier: r.tier,
        confidence: r.result.confidence,
        citations: r.result.citations ?? [],
        // B14: "degraded" = not served by the PREFERRED tier (the first
        // allowed one). With the default order (slm first) this is
        // byte-for-byte the old `tier !== 'slm'` semantics; with the
        // online order (gemini first) a Gemini answer is NOT degraded.
        degraded: r.tier !== allowed[0],
        latencyMs,
        tierErrors,
      };
    }
    tierErrors.push({ tier, error: r.error });
  }

  // All tiers failed — canned fallback.
  // Plan v2 F12 — prefix con disclaimer claro para que el usuario sepa que
  // esta es una respuesta de respaldo (no de la IA principal). El banner
  // `degraded:true` del UI puede no estar visible en todos los renderers
  // (asistente embebido, voz, mobile shell); el disclaimer inline asegura
  // visibilidad universal.
  const canned = cannedFallback(query);
  const latencyMs = now() - startedAt;
  const FALLBACK_DISCLAIMER =
    '[Respuesta de respaldo — la IA principal no está disponible. ' +
    'Esta información es genérica; para casos específicos consulta a tu ' +
    'supervisor o departamento de prevención.]\n\n';
  return {
    text: FALLBACK_DISCLAIMER + canned.text,
    tier: 'canned',
    confidence: canned.confidence,
    citations: canned.citations ?? [],
    degraded: true,
    latencyMs,
    tierErrors,
  };
}

/**
 * Conveniencia: respuesta "modo emergencia" — solo tiers locales
 * (SLM + Zettelkasten + canned). NO toca Gemini ni Firestore remoto
 * porque ambos requieren red.
 */
export async function answerEmergency(
  query: AiQuery,
  adapters: OrchestratorAdapters,
  opts: Omit<OrchestratorOptions, 'allowedTiers'> = {},
): Promise<AiResponse> {
  return answer(query, adapters, {
    ...opts,
    allowedTiers: ['slm', 'zettelkasten'],
    // Emergency mode usa timeouts más agresivos.
    tierTimeoutMs: opts.tierTimeoutMs ?? 3000,
  });
}

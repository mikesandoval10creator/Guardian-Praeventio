/**
 * GuardianOfflineService — Sprint 26 Bucket ZZ.
 *
 * Brecha B (SLM offline) se completa aqui: el caso del usuario es el
 * terremoto. Cuando se cae internet, El Guardian debe seguir respondiendo
 * preguntas basicas de prevencion. Esta clase es el wrapper "Guardian"
 * sobre los primitivos que ya entregaron Sprint 21 R + 23 DD:
 *
 *   - `OnnxSlmAdapter` (onnxAdapter.ts)        — generation engine
 *   - `sampling.ts`                            — greedy/nucleus + repetition
 *   - `tokenizer.ts`                           — tokenizer abstraction
 *
 * Lo que agrega:
 *
 *   1. Corpus de emergencia + retrieval simple por keyword overlap
 *      (sin embeddings para evitar dependencia adicional offline).
 *   2. Cache local IndexedDB de respuestas por hash(prompt) — TinyLlama
 *      Q4 corre a ~5 tok/s en CPU mobile, regenerar respuestas comunes
 *      seria desastroso para UX en emergencia.
 *   3. FAQ pre-generadas — cobertura garantizada incluso si el modelo
 *      ONNX aun no se descargo (caso "primer terremoto del usuario").
 *   4. Citaciones extraidas del corpus chunks usados en la respuesta,
 *      para que el trabajador pueda referenciar la norma chilena.
 *
 * Flow Infinito 3-fases mapping:
 *   - Deteccion Predictiva  → corpus pre-cargado + warmup en idle
 *   - Respuesta Adaptativa  → ask() con retrieval + cache
 *   - Consolidacion         → cache de Q&A persiste para futuros usos
 *
 * NUNCA expone el Zettelkasten interno — el corpus es un subset
 * publico-friendly autorizado para offline (CC BY-SA + dominio publico CL).
 */

import { OnnxSlmAdapter } from './onnxAdapter';

/**
 * Static config para construir el servicio. Todas las URLs son lazy:
 * el service no descarga nada hasta que `preload()` o `ask()` se llama.
 */
export interface GuardianOfflineConfig {
  /** URL del modelo ONNX. Default: `/models/slm/tinyllama-1.1b-q4.onnx`. */
  modelUrl?: string;
  /** URL del tokenizer.json. Default: `/models/slm/tokenizer.json`. */
  tokenizerUrl?: string;
  /**
   * URL del corpus JSON. Carga lazy desde
   * `/data/guardian-offline-corpus.json` por defecto.
   */
  corpusUrl?: string;
  /** Test injection — reemplaza globalThis.fetch para corpus + cache. */
  fetchImpl?: typeof fetch;
  /** Test injection — reemplaza el adapter ONNX (para evitar 600 MB en CI). */
  adapter?: GuardianAdapterLike;
  /**
   * Test injection — proveedor de IndexedDB cache. Por defecto usa el
   * almacenamiento `guardianOfflineCache` (separado del cache de pesos).
   */
  cacheImpl?: GuardianCacheLike;
}

export interface OfflineQueryOptions {
  prompt: string;
  /**
   * Si el caller ya determino que esta offline, lo declara aqui. Si es
   * `false` o ausente y el caller tampoco esta online, usa SLM igual —
   * la decision online/offline la hace el caller (orchestrator), no
   * este servicio.
   */
  forceOffline?: boolean;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
  /** Maximo de tokens a generar. Default: 256. */
  maxTokens?: number;
}

export interface OfflineQueryResult {
  answer: string;
  citations: string[];
  source: 'slm' | 'cache' | 'faq' | 'corpus-only';
  durationMs: number;
}

export interface CorpusChunk {
  id: string;
  topic: string;
  keywords: string[];
  text: string;
  citation: string;
}

interface CorpusFile {
  version: string;
  meta: { source: string; lastUpdated: string; license: string; purpose?: string };
  chunks: CorpusChunk[];
}

interface FAQEntry {
  question: string;
  answer: string;
  citations: string[];
}

/**
 * Subset del adapter que este servicio realmente toca. Definido aqui
 * (en lugar de importar `OnnxSlmAdapter` directo) para que los tests
 * puedan mockearlo sin construir la clase completa.
 */
export interface GuardianAdapterLike {
  preload?: () => Promise<void>;
  generate(opts: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    onToken?: (t: string) => void;
    signal?: AbortSignal;
  }): Promise<string>;
}

/** Subset del cache (IndexedDB-backed) que tocamos. */
export interface GuardianCacheLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const DEFAULT_CORPUS_URL = '/data/guardian-offline-corpus.json';
const TOP_K_CHUNKS = 3;

/**
 * Stop-words espanoles + algunas palabras genericas de seguridad que NO
 * aportan a la decision de retrieval. Mantener corto — un set demasiado
 * agresivo recorta keywords legitimas.
 */
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'a', 'en', 'con', 'sin', 'por', 'para',
  'y', 'o', 'u', 'que', 'qué', 'como', 'cómo', 'cuando', 'cuándo',
  'donde', 'dónde', 'porque', 'porqué', 'mi', 'tu', 'su', 'mis', 'tus', 'sus',
  'es', 'son', 'esta', 'está', 'estan', 'están', 'esto', 'eso',
  'hay', 'haber', 'tener', 'tiene', 'hace', 'hacer', 'hago',
  'lo', 'le', 'me', 'te', 'se', 'nos',
  'pero', 'si', 'sí', 'no', 'mas', 'más', 'muy',
  'qué', 'cuál', 'cuáles', 'quién', 'quiénes',
]);

const SYSTEM_PROMPT_EMERGENCY = [
  'Eres El Guardián, asistente de prevención de riesgos laborales en Chile.',
  'Estás en MODO OFFLINE (caso emergencia / sin internet).',
  'Responde basándote SOLO en el contexto entregado, en español claro y breve.',
  'Si no tienes información suficiente, di "Sin información local — busque ayuda profesional".',
  'NUNCA inventes citaciones normativas. Si citas, usa solo las del contexto.',
].join(' ');

/**
 * In-memory FAQ — cobertura garantizada incluso sin modelo descargado.
 * Cada entrada es derivada del corpus pero pre-generada para que ask()
 * pueda devolver respuesta sin pagar costo de generación SLM.
 */
const FAQ: FAQEntry[] = [
  {
    question: '¿Qué hago con un trabajador con sangrado abundante?',
    answer:
      'Aplica presión directa con tela limpia o gasa sobre la herida durante al menos 10 minutos sin levantar para revisar. Eleva la extremidad si no hay sospecha de fractura. Si no para y hay riesgo vital, considera torniquete proximal solo con formación previa, anotando la hora. Mantén al herido tendido y abrigado. Llama SAMU 131 cuando haya red.',
    citations: ['DS 109 + Cruz Roja Chile + NIOSH primeros auxilios'],
  },
  {
    question: '¿Cómo evacuamos esta zona si la salida principal está bloqueada?',
    answer:
      'Identifica la segunda salida de emergencia más cercana — toda faena debe tener mínimo dos según NCh 1410. Evacúa contra el viento, en dirección perpendicular al peligro. Llega al punto de reunión, haz recuento por cuadrilla y reporta faltantes al supervisor. NUNCA vuelvas por pertenencias.',
    citations: ['NCh 1410 + DS 594 art. 53'],
  },
  {
    question: '¿Qué hago durante un sismo?',
    answer:
      'Agáchate, cúbrete bajo mesa sólida y sujétate. NO corras, NO uses ascensores. Aléjate de ventanas y estanterías. Después del sismo, evacúa por escaleras solo si la estructura tiene daño visible o suena la alarma, y dirígete al punto de reunión. Espera réplicas.',
    citations: ['ONEMI + DS 594 + NCh 433'],
  },
  {
    question: '¿Cómo doy RCP?',
    answer:
      'Comprueba respuesta y respiración. Si no respira o solo jadea, inicia 30 compresiones torácicas (centro del pecho, 5-6 cm, 100-120 por minuto) y 2 ventilaciones si tienes barrera. Continúa hasta que llegue DEA o SAMU. Sin formación en ventilación, hacer compresiones continuas.',
    citations: ['AHA Guidelines 2020 + Cruz Roja Chile'],
  },
  {
    question: '¿Qué hago ante una quemadura?',
    answer:
      'Enfría con agua fría corriente (no helada) durante 10-20 minutos. NO apliques hielo, pasta dental ni aceite. Retira ropa y joyas que no estén pegadas. Cubre con gasa estéril sin algodón. Quemaduras grandes, en cara, manos, genitales o vías respiratorias requieren traslado urgente.',
    citations: ['DS 109 + protocolo MINSAL grandes quemados'],
  },
  {
    question: '¿Qué hago si huele a gas?',
    answer:
      'Si huele a huevo podrido es H2S, evacúa inmediato — sobre 100 ppm satura el olfato y deja de oler. Olor sulfuroso fuerte es gas natural odorizado o propano. El monóxido CO no tiene olor. El gas LP es más pesado que el aire y se acumula abajo. Si dudas, evacúa primero, identifica después.',
    citations: ['DS 148 + GHS UN ST/SG/AC.10/30'],
  },
  {
    question: '¿A qué número llamo?',
    answer:
      'SAMU 131 ambulancia, Bomberos 132, Carabineros 133, PDI 134, ONEMI 137, CITUC toxicología 22 247 3600. Entrega: tipo de incidente, ubicación exacta, número de afectados y estado, peligros activos, tu nombre y contacto.',
    citations: ['ONEMI + SAMU'],
  },
  {
    question: '¿Qué hago ante una persona electrocutada?',
    answer:
      'ANTES de tocarla, corta la energía desde el tablero o usa elemento aislante seco. Una vez liberada, evalúa respiración y pulso, inicia RCP si es necesario. Toda víctima de electrocución debe ser evaluada por arritmia aunque parezca bien.',
    citations: ['NCh Elec 4 + DS 132'],
  },
];

/**
 * Hash trivial pero estable para keys de cache. djb2 (no criptográfico —
 * solo deduplicación de prompts identicos). 32-bit hex.
 */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

/**
 * Normalizar texto para matching: lowercase + quitar acentos +
 * eliminar puntuación, dejar palabras alfa-numéricas.
 */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Score chunks por overlap de keywords (Jaccard-like sobre keywords + topic).
 * Devuelve los top-K por score descendente. Empate → orden de aparición.
 */
export function rankChunks(
  prompt: string,
  chunks: ReadonlyArray<CorpusChunk>,
  topK = TOP_K_CHUNKS,
): CorpusChunk[] {
  const tokens = new Set(tokenize(prompt));
  if (tokens.size === 0) return [];

  const scored = chunks.map((chunk) => {
    const haystack = new Set([
      ...chunk.keywords.flatMap((k) => tokenize(k)),
      ...tokenize(chunk.topic),
      ...tokenize(chunk.text).slice(0, 30), // primeras 30 palabras del cuerpo
    ]);
    let score = 0;
    for (const t of tokens) {
      if (haystack.has(t)) score += 1;
    }
    return { chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.chunk);
}

/**
 * Default IndexedDB-backed cache. Separado del modelCache.ts (que guarda
 * los pesos del modelo) para que limpiar respuestas cacheadas no implique
 * re-descargar 600 MB.
 *
 * Si IndexedDB no está disponible (SSR, tests sin polyfill) cae a un
 * Map en memoria — no rompe pero no persiste entre reloads.
 */
class IndexedDbCache implements GuardianCacheLike {
  private mem = new Map<string, string>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open('guardianOfflineCache', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('responses');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  async get(key: string): Promise<string | null> {
    const db = await this.openDb();
    if (!db) return this.mem.get(key) ?? null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('responses', 'readonly');
        const store = tx.objectStore('responses');
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(this.mem.get(key) ?? null);
      }
    });
  }

  async set(key: string, value: string): Promise<void> {
    this.mem.set(key, value);
    const db = await this.openDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('responses', 'readwrite');
        const store = tx.objectStore('responses');
        store.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

/**
 * Read env flag — espejo del helper de onnxAdapter pero local
 * (evita exportar el helper interno).
 */
function readEnvFlag(name: string): boolean {
  try {
    const meta = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (meta && isTruthy(meta[`VITE_${name}`])) return true;
  } catch {
    /* import.meta.env no siempre disponible en Node */
  }
  if (typeof process !== 'undefined' && process.env) {
    if (isTruthy(process.env[name])) return true;
  }
  const g = globalThis as unknown as Record<string, unknown>;
  if (isTruthy(g[`__${name}__`])) return true;
  return false;
}

function isTruthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    return lower === '1' || lower === 'true' || lower === 'yes';
  }
  return false;
}

/**
 * GuardianOfflineService — cara publica.
 *
 * Lifecycle:
 *   const svc = GuardianOfflineService.fromEnv();
 *   if (svc) {
 *     await svc.preload();           // idle, no bloquea UI
 *     const r = await svc.ask({ prompt: '¿Qué hago si...' });
 *     console.log(r.answer, r.citations);
 *   }
 */
export class GuardianOfflineService {
  private readonly corpusUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: GuardianCacheLike;
  private adapter: GuardianAdapterLike | null;

  private corpus: CorpusChunk[] | null = null;
  private corpusPromise: Promise<CorpusChunk[]> | null = null;

  constructor(config: GuardianOfflineConfig = {}) {
    this.corpusUrl = config.corpusUrl ?? DEFAULT_CORPUS_URL;
    this.fetchImpl =
      config.fetchImpl ??
      ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    this.cache = config.cacheImpl ?? new IndexedDbCache();

    if (config.adapter) {
      this.adapter = config.adapter;
    } else {
      // Intentar fromEnv — si el flag no esta encendido el adapter sera
      // null y caemos a corpus-only / FAQ.
      const onnx = OnnxSlmAdapter.fromEnv({
        modelUrl: config.modelUrl,
        tokenizerUrl: config.tokenizerUrl,
      });
      this.adapter = onnx
        ? {
            preload: () => onnx.warmup(),
            generate: (opts) => onnx.generate(opts),
          }
        : null;
    }
  }

  /**
   * Construye el service solo cuando el flag SLM_OFFLINE_ENABLED esta on.
   * Si esta off, retorna null — el caller sabe que no hay fallback offline
   * disponible y puede mostrar el banner correspondiente.
   */
  static fromEnv(config: GuardianOfflineConfig = {}): GuardianOfflineService | null {
    if (!readEnvFlag('SLM_OFFLINE_ENABLED')) return null;
    return new GuardianOfflineService(config);
  }

  /**
   * Pre-carga corpus + (opcional) modelo. Idempotente. Llamar en idle
   * para que el primer ask() no pague el costo de download.
   */
  async preload(): Promise<void> {
    await this.loadCorpus();
    // Adapter preload corre en paralelo si esta disponible.
    if (this.adapter?.preload) {
      try {
        await this.adapter.preload();
      } catch {
        // No bloquear preload del corpus por fallo del modelo — el
        // corpus solo + FAQ ya entregan valor.
      }
    }
  }

  /**
   * Devuelve la respuesta cacheada (si existe) sin generar nada nuevo.
   * Util para que el caller pueda decidir mostrar inmediatamente vs.
   * mostrar spinner mientras corre el SLM.
   */
  async getCached(prompt: string): Promise<string | null> {
    const key = `q:${djb2(normalizeText(prompt))}`;
    return this.cache.get(key);
  }

  /**
   * Lista de FAQs pre-generadas. Cobertura garantizada incluso sin
   * modelo descargado. La UI puede renderizar esto como sugerencias
   * tappable cuando se detecta offline.
   */
  getFAQ(): FAQEntry[] {
    return [...FAQ];
  }

  /**
   * Pregunta principal.
   *
   * 1. Buscar match exacto en FAQ (normalizado) → return inmediato.
   * 2. Cache hit por hash(prompt) → return cached.
   * 3. Retrieval: top-K chunks del corpus con keyword overlap.
   * 4. Si hay adapter: SLM generate con system prompt + contexto.
   *    Si NO hay adapter: devolver chunks concatenados (corpus-only).
   * 5. Cache result.
   */
  async ask(opts: OfflineQueryOptions): Promise<OfflineQueryResult> {
    const start = nowMs();
    const promptNorm = normalizeText(opts.prompt);

    // 1. FAQ exact-ish match
    const faqHit = matchFAQ(opts.prompt);
    if (faqHit) {
      return {
        answer: faqHit.answer,
        citations: faqHit.citations,
        source: 'faq',
        durationMs: nowMs() - start,
      };
    }

    // 2. Cache lookup
    const cacheKey = `q:${djb2(promptNorm)}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      // El cache no guarda citations en este formato simple; las
      // re-derivamos del corpus. En la practica esto es barato.
      const corpus = await this.loadCorpus();
      const ranked = rankChunks(opts.prompt, corpus);
      return {
        answer: cached,
        citations: ranked.map((c) => c.citation),
        source: 'cache',
        durationMs: nowMs() - start,
      };
    }

    // 3. Retrieval
    const corpus = await this.loadCorpus();
    const ranked = rankChunks(opts.prompt, corpus);
    const citations = uniq(ranked.map((c) => c.citation));

    // 4. Generation
    if (!this.adapter) {
      // Sin modelo disponible — devolver concatenacion de chunks.
      const answer = ranked.length > 0
        ? `${ranked.map((c) => c.text).join('\n\n')}`
        : 'Sin información local sobre esa consulta. Busque ayuda profesional o reintente cuando recupere conexión.';
      return {
        answer,
        citations,
        source: 'corpus-only',
        durationMs: nowMs() - start,
      };
    }

    // Pre-aborted signal → corpus-only fallback
    if (opts.signal?.aborted) {
      return {
        answer: ranked.map((c) => c.text).join('\n\n'),
        citations,
        source: 'corpus-only',
        durationMs: nowMs() - start,
      };
    }

    const augmentedPrompt = buildAugmentedPrompt(opts.prompt, ranked);
    let answer = '';
    try {
      answer = await this.adapter.generate({
        prompt: augmentedPrompt,
        systemPrompt: SYSTEM_PROMPT_EMERGENCY,
        maxTokens: opts.maxTokens ?? 256,
        onToken: opts.onToken,
        signal: opts.signal,
      });
    } catch {
      // Si la generacion falla, devolver corpus-only — nunca dejar al
      // usuario sin respuesta en una emergencia.
      return {
        answer: ranked.map((c) => c.text).join('\n\n') ||
          'Sin información local sobre esa consulta.',
        citations,
        source: 'corpus-only',
        durationMs: nowMs() - start,
      };
    }

    // 5. Cache (solo si la respuesta tiene contenido util)
    if (answer.trim().length > 0) {
      await this.cache.set(cacheKey, answer);
    }

    return {
      answer: answer || ranked.map((c) => c.text).join('\n\n'),
      citations,
      source: 'slm',
      durationMs: nowMs() - start,
    };
  }

  /**
   * Carga del corpus, idempotente y reentrante (concurrent callers
   * comparten el mismo in-flight fetch).
   */
  private async loadCorpus(): Promise<CorpusChunk[]> {
    if (this.corpus) return this.corpus;
    if (this.corpusPromise) return this.corpusPromise;
    this.corpusPromise = (async () => {
      try {
        const res = await this.fetchImpl(this.corpusUrl);
        if (!res.ok) {
          this.corpus = [];
          return this.corpus;
        }
        const json = (await res.json()) as CorpusFile;
        this.corpus = Array.isArray(json.chunks) ? json.chunks : [];
        return this.corpus;
      } catch {
        // Corpus opcional — fallar silently, el SLM puede contestar sin
        // contexto y la FAQ ya cubre los casos canonicos.
        this.corpus = [];
        return this.corpus;
      } finally {
        this.corpusPromise = null;
      }
    })();
    return this.corpusPromise;
  }
}

/**
 * Match FAQ por normalizacion + Jaccard sobre tokens significativos.
 * Threshold conservador (≥ 0.5) — preferimos no devolver FAQ falso
 * positivo y dejar que el SLM responda con contexto.
 */
function matchFAQ(prompt: string): FAQEntry | null {
  const promptTokens = new Set(tokenize(prompt));
  if (promptTokens.size === 0) return null;
  let best: { entry: FAQEntry; score: number } | null = null;
  for (const f of FAQ) {
    const qTokens = new Set(tokenize(f.question));
    if (qTokens.size === 0) continue;
    let inter = 0;
    for (const t of qTokens) if (promptTokens.has(t)) inter += 1;
    const union = qTokens.size + promptTokens.size - inter;
    const jaccard = union === 0 ? 0 : inter / union;
    if (!best || jaccard > best.score) best = { entry: f, score: jaccard };
  }
  if (best && best.score >= 0.5) return best.entry;
  return null;
}

function buildAugmentedPrompt(prompt: string, chunks: ReadonlyArray<CorpusChunk>): string {
  if (chunks.length === 0) return prompt;
  const ctx = chunks
    .map((c, i) => `[${i + 1}] (${c.topic}) ${c.text}\nFuente: ${c.citation}`)
    .join('\n\n');
  return `Contexto local de prevención (usa SOLO esto):\n${ctx}\n\nConsulta del trabajador:\n${prompt}`;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

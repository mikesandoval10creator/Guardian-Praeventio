// SPDX-License-Identifier: MIT
//
// Poster Catalog — catálogo de afiches de seguridad reconocibles por el
// scanner AR. Cada poster tiene:
//
//   - id estable (slug)
//   - título + referencia normativa
//   - URL de imagen de referencia (en Storage o asset estático)
//   - tipo de animación educativa a mostrar al matchear
//   - categoría (filtro UI + analytics)
//
// 2026-05-16 (Sprint G — AR Poster Scan):
// El usuario describió la visión:
//
//   "imagina la aplicación ya tiene para poder hacer afiches de
//    seguridad, entonces mediante el ar real, podría dirigir la
//    cámara hacia el afiche de seguridad y genera una animación
//    relacionada, uff que pasada"
//
// El catálogo seed cubre los 8 protocolos de seguridad más comunes en
// faena chilena (mineras + construcción). Los embeddings de referencia
// se computan offline una vez (script de seed) y se persisten para que
// el matcher en cliente solo compute el embedding del frame actual y
// haga cosine similarity contra el catálogo cacheado.
//
// Pattern matches `mountainRefuges.ts` (Sprint C): dataset literal +
// helpers puros, sin I/O. Para datasets tenant-specific (posters
// personalizados de la empresa) usar `posterFirestoreAdapter` (próxima
// iteración).

import { POSTER_EMBEDDINGS } from './posterEmbeddings.generated.js';

export type PosterCategory =
  | 'epp'
  | 'emergency'
  | 'lockout'
  | 'manual_handling'
  | 'work_at_height'
  | 'confined_space'
  | 'hazmat'
  | 'general_rules';

/**
 * Tipo de animación a mostrar cuando matchea el poster.
 *
 * - `step_sequence`: secuencia paso-a-paso (3-5 frames superpuestos)
 * - `model_3d`: modelo 3D animado (glTF embebido) — para arneses, EPP
 * - `flow_diagram`: diagrama de flujo (decisión tree)
 * - `video_clip`: clip corto pre-grabado
 *
 * Por ahora solo `step_sequence` está implementado (renderer fallback
 * funciona sin assets). Los otros se agregarán cuando lleguen los
 * modelos 3D + clips.
 */
export type PosterAnimationKind = 'step_sequence' | 'model_3d' | 'flow_diagram' | 'video_clip';

/**
 * Un paso individual en una `step_sequence`.
 * `iconKey` referencia un set de iconos Bioicons MIT/CC0
 * (ver `product_medical_iconography_2026-05-04.md` en memoria).
 */
export interface PosterAnimationStep {
  /** Número de orden (1-based). */
  order: number;
  /** Texto a mostrar (i18n key opcional + fallback ES). */
  text: string;
  /** Icono Bioicons o emoji fallback. */
  iconKey?: string;
  /** Duración en ms que se queda visible este paso antes del siguiente. */
  durationMs: number;
}

export interface PosterDefinition {
  /** Slug estable. */
  id: string;
  /** Título humano (español Chile, base). */
  title: string;
  /** Referencia normativa (DS / NCh / Ley). Para mostrar "según DS 594 art. 53". */
  regulationRef: string;
  /** Categoría para filtros + iconografía. */
  category: PosterCategory;
  /**
   * URL de la imagen de referencia que el ImageEmbedder usa para comparar.
   *
   * En producción: Storage `posters/{id}.jpg` (1024x1024 ideal, JPEG
   * para tamaño). En desarrollo: asset estático en `public/posters/`.
   *
   * Si está vacío, el poster NO se puede matchear (solo está en el
   * catálogo para referencia legal).
   */
  referenceImageUrl: string;
  /**
   * Embedding pre-computado de la imagen de referencia.
   *
   * Generado offline una vez vía MediaPipe ImageEmbedder (ver
   * `scripts/seed-poster-embeddings.ts`). El cliente compara con
   * cosine similarity sin tener que descargar la imagen de referencia.
   *
   * Array de 1024 floats típicamente (depende del modelo).
   * Si undefined, el matcher cae a "descargar imagen de referencia +
   * computar embedding on-demand" (más lento, mismo resultado).
   */
  referenceEmbedding?: number[];
  /** Animación a mostrar cuando matchea. */
  animation: {
    kind: PosterAnimationKind;
    steps?: PosterAnimationStep[];
    /** Para `model_3d`: URL del .glb. */
    modelUrl?: string;
    /** Para `video_clip`: URL del .mp4. */
    videoUrl?: string;
  };
  /** Tags para search/filter. */
  tags: string[];
}

/**
 * Catálogo SEED RAW — protocolos chilenos comunes SIN embeddings.
 *
 * IMPORTANTE: los `referenceImageUrl` apuntan a `public/posters/`
 * (assets bundleados). Cuando lleguen las imágenes reales del
 * diseñador, reemplazar por URLs de Storage.
 *
 * Los `referenceEmbedding` se inyectan en runtime mediante
 * `POSTER_EMBEDDINGS` (generado por `scripts/seed-poster-embeddings.ts`).
 *
 * Usa `POSTER_CATALOG_SEED` (export más abajo) para obtener el catálogo
 * MERGED — el que tiene los embeddings ya combinados. Los callers nunca
 * deben usar `POSTER_CATALOG_RAW` directamente (mantenido visible solo
 * para tests + para que el seed script lo importe sin ciclo).
 */
export const POSTER_CATALOG_RAW: readonly Omit<PosterDefinition, 'referenceEmbedding'>[] = [
  {
    id: 'epp_arnes_altura',
    title: 'Uso correcto de arnés de seguridad',
    regulationRef: 'DS 594 art. 53 + NCh 1258',
    category: 'work_at_height',
    referenceImageUrl: '/posters/epp_arnes_altura.jpg',
    animation: {
      kind: 'step_sequence',
      steps: [
        { order: 1, text: 'Inspecciona el arnés: sin cortes, sin oxidación en hebillas, etiqueta legible.', iconKey: 'inspect', durationMs: 4000 },
        { order: 2, text: 'Ajusta los tirantes a la altura del hombro — sin holgura.', iconKey: 'adjust', durationMs: 4000 },
        { order: 3, text: 'Las hebillas pectoral y subpélvica deben centrar firmemente.', iconKey: 'buckle', durationMs: 4000 },
        { order: 4, text: 'Conecta la línea de vida al anclaje certificado (carga ≥ 22 kN).', iconKey: 'anchor', durationMs: 5000 },
        { order: 5, text: 'Antes de subir: alguien debe verificar tu arnés. NUNCA solo.', iconKey: 'check', durationMs: 4000 },
      ],
    },
    tags: ['altura', 'arnes', 'epp', 'cinturon'],
  },
  {
    id: 'extintor_pqs_uso',
    title: 'Operación segura del extintor PQS',
    regulationRef: 'NCh 1428 + DS 594 art. 45',
    category: 'emergency',
    referenceImageUrl: '/posters/extintor_pqs_uso.jpg',
    animation: {
      kind: 'step_sequence',
      steps: [
        { order: 1, text: 'P — Pull: retira el pasador de seguridad.', iconKey: 'pull', durationMs: 3000 },
        { order: 2, text: 'A — Aim: apunta la boquilla a la BASE de la llama.', iconKey: 'aim', durationMs: 3500 },
        { order: 3, text: 'S — Squeeze: aprieta el gatillo con firmeza.', iconKey: 'squeeze', durationMs: 3000 },
        { order: 4, text: 'S — Sweep: barre la base del fuego en zig-zag.', iconKey: 'sweep', durationMs: 4000 },
        { order: 5, text: 'NUNCA des la espalda. Retírate de frente al fuego.', iconKey: 'retreat', durationMs: 4000 },
      ],
    },
    tags: ['extintor', 'fuego', 'incendio', 'pqs', 'emergencia'],
  },
  {
    id: 'loto_bloqueo_etiquetado',
    title: 'Procedimiento de bloqueo y etiquetado (LOTO)',
    regulationRef: 'NCh 2245 + DS 594 art. 39',
    category: 'lockout',
    referenceImageUrl: '/posters/loto_bloqueo_etiquetado.jpg',
    animation: {
      kind: 'step_sequence',
      steps: [
        { order: 1, text: 'Notifica a operadores afectados que el equipo se intervendrá.', iconKey: 'notify', durationMs: 4000 },
        { order: 2, text: 'Aísla todas las fuentes de energía (eléctrica, hidráulica, neumática, gravedad).', iconKey: 'isolate', durationMs: 5000 },
        { order: 3, text: 'Aplica candado + tarjeta con tu nombre y fecha.', iconKey: 'lock', durationMs: 4000 },
        { order: 4, text: 'Disipa energía residual: descarga condensadores, alivia presión.', iconKey: 'discharge', durationMs: 5000 },
        { order: 5, text: 'Verifica con instrumento que NO hay energía antes de tocar.', iconKey: 'verify', durationMs: 5000 },
        { order: 6, text: 'Al terminar: removedor de candado lo retira en orden inverso.', iconKey: 'unlock', durationMs: 4000 },
      ],
    },
    tags: ['loto', 'bloqueo', 'etiquetado', 'mantenimiento', 'energia'],
  },
  {
    id: 'manejo_manual_cargas',
    title: 'Manejo manual de cargas',
    regulationRef: 'Ley 20.001 + Guía MINSAL',
    category: 'manual_handling',
    referenceImageUrl: '/posters/manejo_manual_cargas.jpg',
    animation: {
      kind: 'step_sequence',
      steps: [
        { order: 1, text: 'Hombres ≤ 25 kg. Mujeres ≤ 20 kg. Adolescentes (15-18) ≤ 20 kg. Embarazadas: NO carga.', iconKey: 'weight', durationMs: 5000 },
        { order: 2, text: 'Evalúa: ¿peso? ¿forma? ¿distancia? ¿asas? ¿2 personas?', iconKey: 'assess', durationMs: 4000 },
        { order: 3, text: 'Acércate a la carga, pies separados al ancho de hombros.', iconKey: 'stance', durationMs: 4000 },
        { order: 4, text: 'Dobla rodillas — NO la espalda. Mantén columna recta.', iconKey: 'squat', durationMs: 4500 },
        { order: 5, text: 'Sujeta firme, abraza la carga al cuerpo.', iconKey: 'grip', durationMs: 4000 },
        { order: 6, text: 'Levanta con las piernas, mira al frente, gira con los pies (no la cintura).', iconKey: 'lift', durationMs: 4500 },
      ],
    },
    tags: ['cargas', 'lumbar', 'manual', 'levantar', 'ergonomia'],
  },
  {
    id: 'evacuacion_incendio',
    title: 'Protocolo de evacuación por incendio',
    regulationRef: 'DS 50 + NCh 2114',
    category: 'emergency',
    referenceImageUrl: '/posters/evacuacion_incendio.jpg',
    animation: {
      kind: 'step_sequence',
      steps: [
        { order: 1, text: 'Da la alarma — pulsa el botón rojo o grita "¡FUEGO!"', iconKey: 'alarm', durationMs: 3500 },
        { order: 2, text: 'Si el fuego es pequeño Y entrenado: usa extintor (PASS).', iconKey: 'extinguisher', durationMs: 4500 },
        { order: 3, text: 'Si NO: evacúa por la vía señalizada — NUNCA ascensor.', iconKey: 'stairs', durationMs: 4000 },
        { order: 4, text: 'Si hay humo: agáchate, gatea, cubre nariz con tela húmeda.', iconKey: 'crawl', durationMs: 4500 },
        { order: 5, text: 'Cierra puertas detrás (no con llave) — para que no se propague.', iconKey: 'close', durationMs: 4000 },
        { order: 6, text: 'Llega al punto de encuentro. Reporta presencia al brigadista.', iconKey: 'assembly', durationMs: 4000 },
      ],
    },
    tags: ['evacuacion', 'incendio', 'fuego', 'emergencia', 'humo'],
  },
  {
    id: 'espacio_confinado_entrada',
    title: 'Ingreso a espacio confinado',
    regulationRef: 'DS 594 art. 67 + NCh 1411/3',
    category: 'confined_space',
    referenceImageUrl: '/posters/espacio_confinado_entrada.jpg',
    animation: {
      kind: 'step_sequence',
      steps: [
        { order: 1, text: 'Permiso de trabajo escrito + vigente. Sin permiso = NO entras.', iconKey: 'permit', durationMs: 4500 },
        { order: 2, text: 'Mide atmósfera: O2 (19.5-23.5%), CO (≤25 ppm), H2S (≤10 ppm), explosivos (<10% LEL).', iconKey: 'gas_meter', durationMs: 6000 },
        { order: 3, text: 'Ventila al menos 15 min antes de entrar. Continúa ventilando.', iconKey: 'ventilate', durationMs: 4500 },
        { order: 4, text: 'Vigía afuera con radio + linterna + capacidad de rescate.', iconKey: 'attendant', durationMs: 4500 },
        { order: 5, text: 'Arnés + línea de vida + EPR si la atmósfera es deficiente.', iconKey: 'harness', durationMs: 4500 },
        { order: 6, text: 'NUNCA entres a "rescatar" sin EPR — la mayoría de muertos son rescatistas.', iconKey: 'warning', durationMs: 5000 },
      ],
    },
    tags: ['confinado', 'gases', 'oxigeno', 'h2s', 'permiso'],
  },
  {
    id: 'reglas_cardinales',
    title: 'Las 10 Reglas Cardinales de Seguridad',
    regulationRef: 'Política interna + DS 132 (minería) + DS 76 (construcción)',
    category: 'general_rules',
    referenceImageUrl: '/posters/reglas_cardinales.jpg',
    animation: {
      kind: 'step_sequence',
      steps: [
        { order: 1, text: 'Trabajo en altura: usa SIEMPRE arnés + línea de vida sobre 1.5m.', durationMs: 3500 },
        { order: 2, text: 'Aislación de energías: bloqueo + etiquetado antes de intervenir.', durationMs: 3500 },
        { order: 3, text: 'Espacios confinados: solo con permiso + monitoreo + vigía.', durationMs: 3500 },
        { order: 4, text: 'Conducción: cinturón siempre. Cero alcohol/drogas/celular.', durationMs: 3500 },
        { order: 5, text: 'Izajes: zona de exclusión + carga certificada + viento < 11 m/s.', durationMs: 3500 },
        { order: 6, text: 'Excavaciones: entibación obligatoria sobre 1.2m + atmósfera medida.', durationMs: 3500 },
        { order: 7, text: 'Equipo móvil: sin peatones en zona de operación + alertas reversa.', durationMs: 3500 },
        { order: 8, text: 'EPP: básico siempre. Específico según tarea + análisis riesgo.', durationMs: 3500 },
        { order: 9, text: 'Permisos de trabajo: NO inicies sin permiso firmado vigente.', durationMs: 3500 },
        { order: 10, text: 'Cero tolerancia: parar es un derecho. Reportar es un deber.', durationMs: 4000 },
      ],
    },
    tags: ['reglas', 'cardinales', 'fatalidad', 'high_risk'],
  },
  {
    id: 'hazmat_derrame_quimico',
    title: 'Protocolo de derrame químico',
    regulationRef: 'DS 78 + DS 594 art. 42 + GRE 2024',
    category: 'hazmat',
    referenceImageUrl: '/posters/hazmat_derrame_quimico.jpg',
    animation: {
      kind: 'step_sequence',
      steps: [
        { order: 1, text: 'EVACUA primero — al menos 30m si líquido pequeño, 100m si vapor.', iconKey: 'evacuate', durationMs: 4500 },
        { order: 2, text: 'Identifica la sustancia: lee la HDS o escanea el código UN.', iconKey: 'identify', durationMs: 4000 },
        { order: 3, text: 'Bloquea fuentes de ignición — no fumes, no celulares, no encender luz.', iconKey: 'no_fire', durationMs: 4500 },
        { order: 4, text: 'Avisa a brigada con sustancia + cantidad + ubicación + viento.', iconKey: 'notify', durationMs: 4500 },
        { order: 5, text: 'Si entrenado Y EPP adecuado: contiene con kit antiderrame.', iconKey: 'contain', durationMs: 4500 },
        { order: 6, text: 'NO mezcles químicos al limpiar (ej. lavandina + ácido = cloro gas).', iconKey: 'warning', durationMs: 4500 },
      ],
    },
    tags: ['derrame', 'quimico', 'hazmat', 'sustancia', 'peligro'],
  },
] as const;

/**
 * Merge `POSTER_EMBEDDINGS` (generated/seeded) sobre el RAW catalog.
 * Pure — sin I/O. El resultado es el catálogo "production-ready" que
 * los callers usan.
 *
 * Si `POSTER_EMBEDDINGS` está vacío (default antes del primer seed),
 * el catálogo queda sin embeddings y el matcher devuelve null para
 * todos los frames — el scanner UI muestra "0/N matcheables" como
 * status honesto.
 */
function mergeEmbeddingsIntoCatalog(): PosterDefinition[] {
  return POSTER_CATALOG_RAW.map((raw) => {
    const emb = POSTER_EMBEDDINGS[raw.id];
    const definition: PosterDefinition = {
      ...raw,
      referenceEmbedding: emb && emb.length > 0 ? [...emb] : undefined,
    };
    return definition;
  });
}

/**
 * Catálogo final — RAW + embeddings merged. Es el que los componentes
 * UI (ARPosterScanner) y el matcher consumen.
 */
export const POSTER_CATALOG_SEED: readonly PosterDefinition[] =
  mergeEmbeddingsIntoCatalog();

// ────────────────────────────────────────────────────────────────────
// Helpers puros (sin I/O — testeables directo)
// ────────────────────────────────────────────────────────────────────

/**
 * Busca un poster por id. Devuelve undefined si no existe.
 */
export function getPosterById(id: string): PosterDefinition | undefined {
  return POSTER_CATALOG_SEED.find((p) => p.id === id);
}

/**
 * Filtra el catálogo por categoría y/o tags. AND semántica entre los
 * filtros (categoría + todos los tags requeridos).
 */
export function filterPosters(opts: {
  category?: PosterCategory;
  tags?: string[];
  /** Solo posters con embedding pre-computado (matcheables sin red). */
  onlyWithEmbedding?: boolean;
}): PosterDefinition[] {
  return POSTER_CATALOG_SEED.filter((p) => {
    if (opts.category && p.category !== opts.category) return false;
    if (opts.tags && opts.tags.length > 0) {
      if (!opts.tags.every((t) => p.tags.includes(t))) return false;
    }
    if (opts.onlyWithEmbedding && !p.referenceEmbedding) return false;
    return true;
  });
}

/**
 * Lista los posters de una categoría. Atajo conveniente.
 */
export function postersByCategory(category: PosterCategory): PosterDefinition[] {
  return filterPosters({ category });
}

/**
 * Valida que un PosterDefinition esté bien formado.
 * Útil al cargar posters tenant-custom desde Firestore.
 */
export function isValidPoster(p: unknown): p is PosterDefinition {
  if (!p || typeof p !== 'object') return false;
  const obj = p as Partial<PosterDefinition>;
  if (typeof obj.id !== 'string' || obj.id.length === 0) return false;
  if (typeof obj.title !== 'string' || obj.title.length === 0) return false;
  if (typeof obj.regulationRef !== 'string') return false;
  if (typeof obj.referenceImageUrl !== 'string') return false;
  if (!Array.isArray(obj.tags)) return false;
  if (!obj.animation || typeof obj.animation !== 'object') return false;
  const animation = obj.animation as { kind?: string; steps?: unknown };
  if (typeof animation.kind !== 'string') return false;
  if (animation.kind === 'step_sequence') {
    if (!Array.isArray(animation.steps) || animation.steps.length === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Cosine similarity entre dos vectores de embedding.
 * Retorna valor en [-1, 1]. 1 = idéntico, 0 = ortogonal, -1 = opuesto.
 *
 * En la práctica con MediaPipe ImageEmbedder, valores típicos:
 *   > 0.95 = casi idéntica imagen (mismo poster, misma luz)
 *   > 0.85 = mismo poster, condiciones diferentes (luz, ángulo)
 *   > 0.70 = imágenes del mismo TIPO de objeto pero distintas
 *   < 0.70 = no relacionadas
 *
 * El threshold del matcher por defecto es 0.85 (estricto pero permisivo
 * con variación de luz).
 *
 * Pure — usable en tests y en hot loop del matcher.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: vectores de longitud distinta (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Dado un embedding del frame actual y el catálogo, devuelve el MEJOR
 * match si su similarity supera el threshold. null si nada matchea.
 *
 * Solo considera posters CON `referenceEmbedding` pre-computado — los
 * demás se omiten (el caller puede cargar embedding on-demand si quiere).
 */
export function findBestPosterMatch(
  frameEmbedding: readonly number[],
  catalog: readonly PosterDefinition[] = POSTER_CATALOG_SEED,
  thresholdSimilarity = 0.85,
): { poster: PosterDefinition; similarity: number } | null {
  let best: { poster: PosterDefinition; similarity: number } | null = null;
  for (const poster of catalog) {
    if (!poster.referenceEmbedding || poster.referenceEmbedding.length === 0) continue;
    const sim = cosineSimilarity(frameEmbedding, poster.referenceEmbedding);
    if (sim >= thresholdSimilarity && (best === null || sim > best.similarity)) {
      best = { poster, similarity: sim };
    }
  }
  return best;
}

/**
 * Localiza el título del poster usando traducciones si están disponibles
 * (futuro — por ahora solo devuelve el título base en español).
 *
 * Mantiene la firma para que cuando agreguemos i18n keys
 * (`poster.${id}.title`) podamos cambiar la implementación sin tocar
 * callers.
 */
export function getPosterTitle(
  poster: PosterDefinition,
  _t?: (key: string, fallback?: string) => string,
): string {
  // Stub i18n: cuando agreguemos `poster.${id}.title` al diccionario,
  // intentar `_t(\`poster.${poster.id}.title\`, poster.title)`.
  return poster.title;
}

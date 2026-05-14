/**
 * Static registry of on-device SLM candidates.
 *
 * Fase 1 (Sprint 20, Bucket Gamma, T-1.1) ships three models so the loader
 * — which arrives in T-1.2 — can pick based on device capability:
 *
 *   - phi-3-mini   — default; balances quality vs. footprint (~2.7 GB con
 *                    .onnx + .onnx_data split).
 *   - qwen-2.5-0.5b — fallback for low-storage devices (~483 MB).
 *   - gemma-2-2b   — premium opt-in; better generation quality. GATED por
 *                    Hugging Face — requiere aceptar términos Google.
 *
 * No runtime side effects. This module exports plain data + a tiny lookup
 * helper. Anything that needs to download / load a model lives downstream
 * (worker code in T-1.2).
 *
 * URL caveat: HuggingFace Hub layout is stable. URLs apuntan a
 * resolve/main/<path> directos así el loader puede hacer fetch sin
 * resolver path internamente.
 *
 * Sprint 47 C.9: distinción explícita entre `null` (pendiente — primer
 * download verificado lo computa) y `undefined` (no aplica).
 *
 * Sprint 54 SLM real: SHA-256 reales pineados desde HuggingFace LFS oid
 * (que ES el SHA-256 del contenido binario — autoritative). Verificado
 * 2026-05-13 contra `huggingface.co/api/models/<repo>/tree/main/onnx`.
 * Companion files (`.onnx_data`) agregados con sus propios hashes para
 * modelos split (Phi-3). Gemma marcado como gated.
 *
 * Tres consumidores activos:
 *   - `slmIntegrityCheck.ts` — política graceful (warn-in-staging)
 *   - `slmIntegrityGuard.ts` — política estricta (throw on mismatch)
 *   - `slmRuntime.ts`        — usa el guard antes de
 *                              `ort.InferenceSession.create()`
 */

import type { ModelDescriptor } from './types';

const MB = 1024 * 1024;

/** Sprint 54: timestamp de cuando se computaron los hashes (audit). */
const HASH_COMPUTED_AT = '2026-05-13T19:00:00Z';

/**
 * The canonical, ordered list of SLM models the app may use offline.
 *
 * Order matters: the first entry is treated as the default candidate by
 * `getDefaultModel()`.
 */
export const MODEL_REGISTRY: readonly ModelDescriptor[] = [
  {
    id: 'phi-3-mini',
    name: 'Phi-3 Mini 4K Instruct (ONNX int4)',
    // Tamaño real: model_q4.onnx 1.06GB + .onnx_data 1.66GB = ~2.7 GB.
    size: 1059602332,
    // Sprint 54: URL directa a resolve/main para que el loader puede
    // hacer fetch del archivo sin resolver el repo root.
    url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx-web/resolve/main/onnx/model_q4.onnx',
    weightFilename: 'onnx/model_q4.onnx',
    tokenizerUrl: 'microsoft/Phi-3-mini-4k-instruct-onnx-web',
    format: 'onnx-int4',
    license: 'MIT',
    preferredBackend: 'webgpu',
    quantization: 'int4',
    // Sprint 54: SHA-256 real desde HF LFS oid (huggingface.co API
    // /api/models/microsoft/Phi-3-mini-4k-instruct-onnx-web/tree/main/onnx).
    expectedSha256: '16b8e5d28a757c37bbfa7d9420fd094c0c20e3615ca3c203b5b9501015045c8f',
    hashComputedAt: HASH_COMPUTED_AT,
    // Phi-3 ONNX-web está split: el .onnx grande tiene weights externos
    // en .onnx_data. Loader debe descargar ambos.
    companionFiles: [
      {
        filename: 'onnx/model_q4.onnx_data',
        size: 1663524864,
        expectedSha256: '41d30b87f06b52e6b24c4e2e65a6a14e5c9fb5bc6f495fac17b19c6bc7875ff5',
      },
    ],
  },
  {
    id: 'qwen-2.5-0.5b',
    name: 'Qwen 2.5 0.5B Instruct (ONNX int4 f16)',
    // Tamaño real verificado: 483 MB para q4f16 (no 280 MB como decía
    // la doc legacy — onnx-community publica el archivo completo).
    size: 483003582,
    url: 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx',
    weightFilename: 'onnx/model_q4f16.onnx',
    tokenizerUrl: 'onnx-community/Qwen2.5-0.5B-Instruct',
    format: 'onnx-int4',
    license: 'Apache-2.0',
    preferredBackend: 'wasm-simd',
    quantization: 'int4',
    // Sprint 54: SHA-256 real desde HF LFS oid.
    expectedSha256: 'b11c1dd99efd57e6c6e5bc4443a019931a5fbd5dd500d48644d8225f5ce0b2cb',
    hashComputedAt: HASH_COMPUTED_AT,
    // Sprint 54 ext: pre-packaged path. Cuando el release pipeline copie
    // el .onnx a `public/models/qwen-2.5-0.5b/model_q4f16.onnx` el
    // runtime lo prefiere sobre la descarga HF. Modelo de 483 MB → cabe
    // en Android Asset Pack o iOS asset catalog.
    prePackagedPath: '/models/qwen-2.5-0.5b/model_q4f16.onnx',
  },
  {
    id: 'gemma-2-2b',
    name: 'Gemma 2 2B IT (ONNX int4) — GATED',
    // ~1.4 GB. Gemma usa Google's bespoke "Gemma Terms of Use" — gated
    // en Hugging Face (requiere aceptar términos + HF token con acceso
    // al repo).
    size: 1400 * MB,
    url: 'https://huggingface.co/onnx-community/gemma-2-2b-it-ONNX/resolve/main/onnx/model_q4f16.onnx',
    weightFilename: 'onnx/model_q4f16.onnx',
    tokenizerUrl: 'onnx-community/gemma-2-2b-it-ONNX',
    format: 'onnx-int4',
    license: 'Gemma',
    preferredBackend: 'webgpu',
    quantization: 'int4',
    // Sprint 54: Gemma sigue pendiente porque el repo es GATED — el
    // API `/tree/main` devolvió 401. Pipeline release debe usar un HF
    // token con scope al repo gemma-2-2b-it-ONNX (accept terms primero)
    // y poblar este campo. Loader fail-closed sin hash en prod.
    expectedSha256: null,
    gated: true,
  },
] as const;

/**
 * The id of the model the app should attempt to load by default.
 * Currently Phi-3 Mini, which is permissively licensed (MIT) and offers
 * the best quality/size trade-off in the registry.
 */
export const DEFAULT_MODEL_ID = 'phi-3-mini';

/**
 * Look up a model descriptor by its registry id.
 *
 * @returns the descriptor, or `undefined` if no model has the given id.
 */
export function getModelById(id: string): ModelDescriptor | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

/**
 * Return the default model descriptor (the one keyed by DEFAULT_MODEL_ID).
 *
 * @throws if the registry has been mis-edited and no default is present.
 */
export function getDefaultModel(): ModelDescriptor {
  const m = getModelById(DEFAULT_MODEL_ID);
  if (!m) {
    throw new Error(
      `SLM registry: default model id "${DEFAULT_MODEL_ID}" not found.`,
    );
  }
  return m;
}

/**
 * Sprint 54 SLM real: filtra modelos que tienen hash real disponible.
 * El runtime puede pedir esta lista para excluir gated/pending hashes
 * en production.
 */
export function listModelsWithVerifiedHash(): readonly ModelDescriptor[] {
  return MODEL_REGISTRY.filter((m) => typeof m.expectedSha256 === 'string');
}

/**
 * Sprint 54: total bytes a descargar (peso principal + companions).
 */
export function totalDownloadBytes(model: ModelDescriptor): number {
  const companionsBytes = (model.companionFiles ?? []).reduce(
    (s, f) => s + f.size,
    0,
  );
  return model.size + companionsBytes;
}

/**
 * Sprint 54: lista todos los archivos a descargar para un modelo
 * (principal + companions) con sus hashes esperados.
 */
export interface DownloadableFile {
  url: string;
  filename: string;
  expectedSha256: string | null;
  size: number;
}

export function listDownloadableFiles(model: ModelDescriptor): DownloadableFile[] {
  const repoBaseFromUrl = (url: string): string => {
    // Si la URL incluye /resolve/main/... extrae el prefix
    const match = url.match(/^(https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[^/]+)\//);
    return match ? match[1]! : url.replace(/\/[^/]+\.onnx.*$/, '');
  };

  const files: DownloadableFile[] = [];
  files.push({
    url: model.url,
    filename: model.weightFilename ?? 'model.onnx',
    expectedSha256: model.expectedSha256 ?? null,
    size: model.size,
  });

  if (model.companionFiles) {
    const base = repoBaseFromUrl(model.url);
    for (const c of model.companionFiles) {
      files.push({
        url: `${base}/${c.filename}`,
        filename: c.filename,
        expectedSha256: c.expectedSha256,
        size: c.size,
      });
    }
  }
  return files;
}

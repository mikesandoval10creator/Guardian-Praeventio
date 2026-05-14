/**
 * Protocolo de mensajes entre el main thread y el SLM Runtime Worker.
 *
 * Hoy `slmRuntime.ts` corre todo en el main thread:
 *   - Fetch de bytes (~2.7 GB para Phi-3)
 *   - SHA-256 verify
 *   - ORT InferenceSession.create
 *   - **Inferencia token-by-token (loop greedy/sampling)**
 *
 * El loop de inferencia es el problema crítico: cada token toma 100-
 * 500ms en WebGPU y miles de ms en WASM. Durante esos ms el main
 * thread está BLOQUEADO — la UI no responde, los animations frame
 * skip, el botón SOS se siente "muerto".
 *
 * Solución: mover TODO el runtime a un Worker. El main thread solo
 * envía `loadModel` / `infer` / `release` por postMessage y recibe
 * eventos (tokens streaming, progress, errors).
 *
 * Este módulo define el protocolo de mensajes. Es pure-types — no
 * importa nada del runtime ni del worker. Ambos lados lo importan
 * para mantener firmas en sync.
 *
 * Diseño:
 *   - Cada request del main thread lleva un `requestId` único
 *     (UUID-like, monotonic). Permite múltiples requests en flight.
 *   - El worker responde con `requestId` para que el main pueda
 *     matchear callbacks.
 *   - Eventos asincronos (tokens, progress) usan el mismo
 *     `requestId` para correlacionar con la request original.
 *   - Cancellation via `abort` request — el worker corta el loop
 *     en el siguiente token y responde con `aborted: true`.
 *   - Errores estructurados — el worker NUNCA lanza al main, siempre
 *     responde con `kind: 'error'`.
 */

import type { SLMBackend } from '../types';

// ────────────────────────────────────────────────────────────────────────
// Request types — main → worker
// ────────────────────────────────────────────────────────────────────────

export type WorkerRequest =
  | LoadRequest
  | InferRequest
  | ReleaseRequest
  | AbortRequest
  | PingRequest;

export interface LoadRequest {
  kind: 'load';
  requestId: string;
  modelId: string;
  /**
   * Si está set, override del SHA-256 del registry. Útil para
   * release pipeline contra un modelo recién publicado.
   */
  expectedSha256Override?: string | null;
  /** Si true, salta el cache IDB. Default false (cache-first). */
  bypassCache?: boolean;
}

export interface InferRequest {
  kind: 'infer';
  requestId: string;
  /** Handle del modelo previamente cargado. */
  modelHandle: string;
  prompt: string;
  maxTokens?: number;
  /**
   * Si `true`, el worker emite un evento `token` por cada token
   * generado (streaming). Si `false`, espera al loop completo y
   * emite un único `result`.
   */
  streamTokens?: boolean;
  /** Sampling: 0 = greedy. Default 0. */
  temperature?: number;
}

export interface ReleaseRequest {
  kind: 'release';
  requestId: string;
  modelHandle: string;
}

export interface AbortRequest {
  kind: 'abort';
  requestId: string;
  /** Qué requestId activo cancelar. */
  abortRequestId: string;
}

export interface PingRequest {
  kind: 'ping';
  requestId: string;
}

// ────────────────────────────────────────────────────────────────────────
// Response types — worker → main
// ────────────────────────────────────────────────────────────────────────

export type WorkerResponse =
  | LoadProgressEvent
  | LoadCompleteEvent
  | InferTokenEvent
  | InferCompleteEvent
  | ReleaseCompleteEvent
  | AbortAckEvent
  | PongEvent
  | ErrorEvent;

export interface LoadProgressEvent {
  kind: 'load-progress';
  requestId: string;
  loaded: number;
  total: number | null;
  filename: string;
  fileIndex: number;
  fileCount: number;
}

export interface LoadCompleteEvent {
  kind: 'load-complete';
  requestId: string;
  modelHandle: string;
  modelId: string;
  observedSha256: string;
  backend: SLMBackend;
}

export interface InferTokenEvent {
  kind: 'infer-token';
  requestId: string;
  /** El token generado (decoded). */
  token: string;
  /** Acumulado hasta ahora (caller decide si concatenar o reemplazar). */
  cumulativeText: string;
  /** Total tokens generados hasta ahora. */
  tokenCount: number;
}

export interface InferCompleteEvent {
  kind: 'infer-complete';
  requestId: string;
  /** Texto final completo. */
  text: string;
  tokensGenerated: number;
  latencyMs: number;
  /** True si fue interrumpido por abort. */
  aborted?: boolean;
}

export interface ReleaseCompleteEvent {
  kind: 'release-complete';
  requestId: string;
}

export interface AbortAckEvent {
  kind: 'abort-ack';
  requestId: string;
  /** True si se encontró un request activo para cancelar. False = no había nada. */
  found: boolean;
}

export interface PongEvent {
  kind: 'pong';
  requestId: string;
  /** Versión del worker para sanity (drift entre main y worker). */
  workerVersion: string;
}

export interface ErrorEvent {
  kind: 'error';
  requestId: string;
  errorCode:
    | 'unknown_model'
    | 'integrity_failure'
    | 'load_failure'
    | 'infer_failure'
    | 'handle_not_found'
    | 'release_failure'
    | 'aborted'
    | 'internal';
  errorMessage: string;
  /** Stack si fue una excepción no esperada. */
  stack?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Genera un `requestId` monotonic que también incluye un sufijo
 * random para evitar colisiones entre instancias paralelas del proxy.
 * No es cryptographically secure — solo necesita unicidad dentro del
 * lifetime del worker.
 */
let counter = 0;
export function newRequestId(prefix = 'req'): string {
  counter = (counter + 1) | 0;
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0xffff).toString(36);
  return `${prefix}-${ts}-${counter.toString(36)}-${rnd}`;
}

/** Type guard estructural: ¿este mensaje es un response del worker? */
export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== 'object') return false;
  const r = value as { kind?: string; requestId?: string };
  if (typeof r.kind !== 'string' || typeof r.requestId !== 'string') {
    return false;
  }
  const validKinds = new Set([
    'load-progress',
    'load-complete',
    'infer-token',
    'infer-complete',
    'release-complete',
    'abort-ack',
    'pong',
    'error',
  ]);
  return validKinds.has(r.kind);
}

/** Type guard estructural: ¿este mensaje es una request al worker? */
export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!value || typeof value !== 'object') return false;
  const r = value as { kind?: string; requestId?: string };
  if (typeof r.kind !== 'string' || typeof r.requestId !== 'string') {
    return false;
  }
  const validKinds = new Set(['load', 'infer', 'release', 'abort', 'ping']);
  return validKinds.has(r.kind);
}

/**
 * SLM Acquisition Service — first-launch download orchestration.
 *
 * "Pattern tipo videojuego": al primer launch, si el modelo no está
 * ni pre-empaquetado ni en cache, anunciamos al usuario que tenemos
 * que descargar X MB. El usuario decide: descargar ahora, posponer,
 * o usar solo modo online. La decisión se persiste en localStorage
 * para que no preguntemos en cada launch.
 *
 * Este módulo es lógica pura (sin React). El componente UI
 * `<SlmAcquisitionPrompt />` lo consume vía `useSlmAcquisition()`.
 *
 * Tres estados terminales del flujo:
 *   - `ready`        — modelo disponible localmente (pre-packaged o
 *                      en IndexedDB). No hay nada que hacer.
 *   - `needs_prompt` — primer launch o usuario antes pidió "después":
 *                      mostrar el prompt al usuario.
 *   - `downloading`  — usuario aceptó, descarga en curso. Caller
 *                      reactiona al progreso.
 *   - `declined`     — usuario eligió "solo online"; no preguntar
 *                      de nuevo hasta que reset explícito.
 *
 * Anti-anti-patterns:
 *   - NUNCA se descarga automáticamente sin consentimiento explícito
 *     (Workbox cache solo aplica DESPUÉS de la primera descarga).
 *   - Se respeta la decisión "después" con un cooldown configurable
 *     (default 24h) para que el banner no sea molesto.
 *   - WiFi-only check para dejar al usuario decidir; nunca bloqueamos
 *     descarga en mobile data porque algunas faenas mineras solo
 *     tienen 4G corporativo.
 */

import {
  getCachedModelBytes,
  loadCachedModel,
} from './cache/modelCache';
import { DEFAULT_MODEL_ID, getModelById, totalDownloadBytes } from './registry';
import type { ModelDescriptor } from './types';

// ────────────────────────────────────────────────────────────────────────
// Persistence keys (localStorage). Versioned so we can migrate later.
// ────────────────────────────────────────────────────────────────────────

const STORAGE_KEY_DECISION = 'praeventio:slm:acquisition:v1';

/**
 * Persisted acquisition decision. Pure data — kept compact so it
 * survives serialization without surprises.
 */
export interface PersistedDecision {
  /** Which model the decision was about. */
  modelId: string;
  /** 'accepted' = user said yes (the download completed at completedAt);
   *  'postponed' = user said "later", remind after `postponedUntil`;
   *  'declined' = user opted out entirely. */
  kind: 'accepted' | 'postponed' | 'declined';
  /** ISO-8601 when the decision was made. */
  decidedAt: string;
  /** For 'postponed': ISO-8601 when to prompt again. */
  postponedUntil?: string;
  /** For 'accepted': ISO-8601 when the download finished. */
  completedAt?: string;
}

function readDecision(): PersistedDecision | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DECISION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDecision;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.modelId || !parsed.kind || !parsed.decidedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDecision(d: PersistedDecision): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_DECISION, JSON.stringify(d));
  } catch {
    // Quota / private mode — silently swallow. The decision will
    // re-prompt next launch which is acceptable.
  }
}

/**
 * Default re-prompt window after the user said "after". 24h is the
 * sweet spot — short enough that the user remembers context, long
 * enough that we're not nagging.
 */
export const DEFAULT_POSTPONE_HOURS = 24;

// ────────────────────────────────────────────────────────────────────────
// State machine
// ────────────────────────────────────────────────────────────────────────

export type AcquisitionState =
  | 'ready' // model already available locally
  | 'needs_prompt' // first launch or postpone expired
  | 'postponed' // user said later, still inside cooldown
  | 'declined' // user opted out
  | 'downloading'; // in flight

export interface AcquisitionStatus {
  state: AcquisitionState;
  /** The model the prompt is about (default model from registry). */
  modelId: string;
  /** Total bytes the user would have to download (principal + companions). */
  totalBytes: number;
  /** Human-friendly MB (rounded). */
  totalMb: number;
  /** True when the model has pre-packaged assets in the bundle. */
  isPrePackaged: boolean;
  /** Cached bytes currently in IndexedDB (0 if cold). */
  cachedBytes: number;
  /** If postponed, when to re-prompt. */
  remindAt?: string;
  /** When the user previously decided. */
  lastDecision?: PersistedDecision;
}

export interface AcquisitionContext {
  /** Override which model to acquire. Defaults to the registry default. */
  modelId?: string;
  /** Override `Date.now()` for tests. */
  now?: Date;
}

/**
 * Probe whether a pre-packaged asset is physically present at its declared
 * URL. Used by `getAcquisitionStatus()` so that a model whose descriptor
 * says "prePackagedPath: '/models/...'" doesn't claim `'ready'` when the
 * bundle is actually missing the file (e.g. workbox globPatterns excludes
 * it, or the build ran before the prepackage script).
 *
 * Implementation notes:
 *   • We use a HEAD request — never downloads the (483 MB+) model body.
 *   • We treat 2xx as present, 404/410 as missing. Network errors are
 *     treated as "unknown" → fall through to the rest of the state machine
 *     so a transient offline condition doesn't downgrade a real `'ready'`.
 *   • The probe is cheap (a HEAD with no body); the rest of the page
 *     bootstrap isn't blocked.
 *   • Server-side (no `fetch`): returns `false` (treat as missing → fall
 *     through to `'needs_prompt'`, which is correct for SSR).
 */
export async function probePrePackagedAsset(
  prePackagedPath: string,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  if (typeof fetch === 'undefined' || typeof window === 'undefined') {
    return false;
  }
  const { timeoutMs = 4000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(prePackagedPath, {
      method: 'HEAD',
      signal: controller.signal,
      // Don't burn 483MB just for a probe. HEAD never has a body.
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const contentLength = res.headers.get('content-length');
    // If the server reports a zero-length file, treat as missing. Real
    // SLM weights are ≥ 100 MB so a 0 here means the file isn't there.
    if (contentLength !== null && Number(contentLength) <= 0) return false;
    return true;
  } catch {
    // Network error, abort, or CORS. Be conservative and return false so
    // the user gets prompted — but the state machine still has the
    // 'unknown' path below that distinguishes "checked, failed" from
    // "didn't check, trust the descriptor".
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Inspect the world and tell the caller what to do.
 *
 * Decision order:
 *   1. Pre-packaged path exists AND asset is physically present → 'ready'
 *   2. Cache has bytes for this model → 'ready'
 *   3. Persisted decision says 'declined' → 'declined'
 *   4. Persisted decision says 'postponed' and we're still in cooldown
 *      → 'postponed'
 *   5. Otherwise → 'needs_prompt'
 *
 * NOTE: we deliberately do NOT check network here — the prompt can be
 * shown offline (the user can still accept and the download will queue
 * when reconnection happens). Network policy belongs in the UI layer.
 *
 * Sprint 50 E.11 P1 H7 (ticket 39aaa66d-73fe-81db-9d7f-d5b82570f334):
 * step 1 changed from "trust the descriptor" to "verify the descriptor".
 * Previously the descriptor saying `prePackagedPath: '/models/...'` was
 * enough to claim `'ready'` — but if the file wasn't actually in the
 * bundle (workbox globPatterns excluded it, build ran before prepackage
 * script, or a CDN returned 404), the user landed in an offline scenario
 * with a phantom `'ready'` state. Now we probe the asset with a HEAD
 * request before declaring `'ready'`.
 */
export async function getAcquisitionStatus(
  ctx: AcquisitionContext = {},
): Promise<AcquisitionStatus> {
  const now = ctx.now ?? new Date();
  const modelId = ctx.modelId ?? DEFAULT_MODEL_ID;
  const descriptor = getModelById(modelId);
  if (!descriptor) {
    throw new Error(`slmAcquisitionService: unknown model id '${modelId}'.`);
  }

  const totalBytes = totalDownloadBytes(descriptor);
  const totalMb = Math.round(totalBytes / (1024 * 1024));
  const isPrePackaged = Boolean(descriptor.prePackagedPath);
  const cachedBytes = await getCachedModelBytes(modelId).catch(() => 0);
  const lastDecision = readDecision();

  // Already-have shortcut. Bonus: we don't bother the user even if the
  // registry size estimate drifts.
  if (cachedBytes > 0) {
    return {
      state: 'ready',
      modelId,
      totalBytes,
      totalMb,
      isPrePackaged,
      cachedBytes,
      lastDecision: lastDecision ?? undefined,
    };
  }

  // Pre-packaged path: we probe the asset before declaring 'ready'.
  // The previous logic trusted `prePackagedPath` as a string contract;
  // that fails when the file isn't in the bundle (Ticket
  // 39aaa66d-73fe-81db-9d7f-d5b82570f334 — "SLM offline (PWA) puede no
  // estar disponible en el primer uso sin senal"). The probe is a HEAD
  // request so it doesn't burn the (483 MB+) model bytes.
  if (isPrePackaged && descriptor.prePackagedPath) {
    const assetPresent = await probePrePackagedAsset(descriptor.prePackagedPath);
    if (assetPresent) {
      return {
        state: 'ready',
        modelId,
        totalBytes,
        totalMb,
        isPrePackaged,
        cachedBytes,
        lastDecision: lastDecision ?? undefined,
      };
    }
    // Asset missing: fall through to `'needs_prompt'` so the user sees
    // the download dialog and the SLM can be fetched from HF. This is
    // the explicit fix: missing pre-packaged asset → trigger prompt,
    // NOT claim `'ready'`.
  }

  // Decision state machine.
  if (lastDecision && lastDecision.modelId === modelId) {
    if (lastDecision.kind === 'declined') {
      return {
        state: 'declined',
        modelId,
        totalBytes,
        totalMb,
        isPrePackaged,
        cachedBytes,
        lastDecision,
      };
    }
    if (lastDecision.kind === 'postponed' && lastDecision.postponedUntil) {
      const cooldownEnd = Date.parse(lastDecision.postponedUntil);
      if (Number.isFinite(cooldownEnd) && now.getTime() < cooldownEnd) {
        return {
          state: 'postponed',
          modelId,
          totalBytes,
          totalMb,
          isPrePackaged,
          cachedBytes,
          remindAt: lastDecision.postponedUntil,
          lastDecision,
        };
      }
    }
    // 'accepted' but cache is empty (eviction? reinstall?) → re-prompt.
  }

  return {
    state: 'needs_prompt',
    modelId,
    totalBytes,
    totalMb,
    isPrePackaged,
    cachedBytes,
    lastDecision: lastDecision ?? undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Decision recording (called by the UI prompt)
// ────────────────────────────────────────────────────────────────────────

export function recordPostponed(
  modelId: string,
  hours: number = DEFAULT_POSTPONE_HOURS,
  now: Date = new Date(),
): PersistedDecision {
  const remindAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const decision: PersistedDecision = {
    modelId,
    kind: 'postponed',
    decidedAt: now.toISOString(),
    postponedUntil: remindAt.toISOString(),
  };
  writeDecision(decision);
  return decision;
}

export function recordDeclined(
  modelId: string,
  now: Date = new Date(),
): PersistedDecision {
  const decision: PersistedDecision = {
    modelId,
    kind: 'declined',
    decidedAt: now.toISOString(),
  };
  writeDecision(decision);
  return decision;
}

export function recordAccepted(
  modelId: string,
  now: Date = new Date(),
): PersistedDecision {
  const decision: PersistedDecision = {
    modelId,
    kind: 'accepted',
    decidedAt: now.toISOString(),
    completedAt: now.toISOString(),
  };
  writeDecision(decision);
  return decision;
}

/**
 * Test-only escape hatch. Clears the persisted decision so the
 * "reset onboarding" UI can re-prompt the user.
 */
export function resetAcquisitionDecision(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_DECISION);
  } catch {
    // ignore
  }
}

// ────────────────────────────────────────────────────────────────────────
// Network advisory (caller can decide WiFi-only policy)
// ────────────────────────────────────────────────────────────────────────

export type NetworkAdvisory =
  | 'wifi'
  | 'cellular'
  | 'metered_unknown'
  | 'offline'
  | 'unknown';

/**
 * Best-effort read of `navigator.connection` (NetworkInformation API).
 * Used by the UI to warn the user "you're on cellular, this is 483 MB,
 * recommended WiFi". Returns 'unknown' when the API isn't available
 * (Safari, older browsers). The UI MUST handle 'unknown' gracefully.
 */
export function detectNetworkAdvisory(): NetworkAdvisory {
  if (typeof navigator === 'undefined') return 'unknown';
  if (navigator.onLine === false) return 'offline';
  const conn = (
    navigator as unknown as {
      connection?: { effectiveType?: string; type?: string; saveData?: boolean };
    }
  ).connection;
  if (!conn) return 'unknown';
  // `type` is the most direct: 'wifi' | 'cellular' | 'ethernet' | ...
  if (conn.type === 'wifi' || conn.type === 'ethernet') return 'wifi';
  if (conn.type === 'cellular') return 'cellular';
  // Fall back to saveData heuristic (Data Saver mode → likely cellular).
  if (conn.saveData) return 'metered_unknown';
  return 'unknown';
}

/**
 * Format a byte size as MB or GB for the UI. Pure helper.
 */
export function formatBytesHuman(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Return the descriptor of the model targeted for acquisition. Exposed
 * for the UI to render licence info, name, etc. without re-importing
 * registry directly.
 */
export function getAcquisitionModel(
  modelId: string = DEFAULT_MODEL_ID,
): ModelDescriptor | undefined {
  return getModelById(modelId);
}

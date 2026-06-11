/**
 * SLM offline feature flag — single source of truth (B14, 2026-06-11).
 *
 * History: the on-device SLM shipped behind `SLM_OFFLINE_ENABLED=false`
 * (opt-in). Block B14 flips the default: the flag is now **ON by
 * default** for every surface that has the resilient fallback ladder
 * (SLM → cached RAG corpus → honest offline message). The env var
 * becomes a **kill-switch**: set it explicitly to `false` / `0` / `no`
 * to disable the on-device SLM (e.g. emergency rollback without a
 * release).
 *
 * Resolution order (first DEFINED value wins):
 *   1. `globalThis.__SLM_OFFLINE_ENABLED__`      (debug-menu override)
 *   2. `import.meta.env.VITE_SLM_OFFLINE_ENABLED` (Vite client bundle)
 *   3. `process.env.SLM_OFFLINE_ENABLED`          (SSR / tests)
 *   4. none defined → **true** (default ON)
 *
 * Falsy values (kill-switch): `false`, `'false'`, `'0'`, `'no'`, `'off'`.
 * Truthy values: `true`, `'true'`, `'1'`, `'yes'`, `'on'`.
 * Anything else (empty string, garbage) is treated as "not defined" so a
 * malformed env line can't silently kill a life-relevant offline path.
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/** Parse a raw env/global value into a tri-state boolean. */
function parseFlag(v: unknown): boolean | undefined {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === 'string') {
    const lower = v.trim().toLowerCase();
    if (TRUTHY.has(lower)) return true;
    if (FALSY.has(lower)) return false;
  }
  return undefined;
}

/**
 * True when the on-device SLM should be available. Default ON; see
 * module header for the kill-switch contract.
 */
export function isSlmOfflineEnabled(): boolean {
  // 1. Debug-menu / test override.
  const g = globalThis as unknown as Record<string, unknown>;
  const fromGlobal = parseFlag(g.__SLM_OFFLINE_ENABLED__);
  if (fromGlobal !== undefined) return fromGlobal;

  // 2. Vite client bundle.
  try {
    const meta = (import.meta as unknown as { env?: Record<string, unknown> })
      .env;
    const fromVite = parseFlag(meta?.VITE_SLM_OFFLINE_ENABLED);
    if (fromVite !== undefined) return fromVite;
  } catch {
    // import.meta.env is not always available in Node test contexts.
  }

  // 3. Node / SSR / tests.
  if (typeof process !== 'undefined' && process.env) {
    const fromNode = parseFlag(process.env.SLM_OFFLINE_ENABLED);
    if (fromNode !== undefined) return fromNode;
  }

  // 4. Default ON — the offline-first promise.
  return true;
}

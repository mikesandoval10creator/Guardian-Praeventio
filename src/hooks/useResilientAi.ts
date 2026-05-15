/**
 * useResilientAi — React hook que envuelve el resilient AI orchestrator
 * con state, cancelación y un policy de adapters por default.
 *
 * El hook expone:
 *   - `ask(prompt, opts)` — dispara una consulta. Devuelve la `AiResponse`
 *     (no lanza nunca; el orchestrator garantiza que SIEMPRE entrega algo).
 *   - `loading` — true mientras una consulta corre.
 *   - `lastResponse` — última respuesta entregada (o null).
 *   - `error` — solo poblado para fallas catastróficas del HOOK (ej. caller
 *     pasa adapters mal-configurados). El orchestrator por sí mismo NUNCA
 *     produce error porque cae a `canned`.
 *   - `cancel()` — abort en curso. Idempotente.
 *
 * Adapters: el hook recibe un set de adapters parciales. Cualquier tier
 * sin adapter se salta limpiamente (el orchestrator devuelve null para
 * ese tier y cae al siguiente). Esto permite que un caller use solo
 * SLM + canned, o solo Zettelkasten + Gemini, etc.
 *
 * Default behaviour: si el caller no pasa adapters, el hook usa el
 * stack canónico: SLM + Zettelkasten(seed) + Gemini? — la decisión
 * del default queda en el caller para que tests no necesiten mockear
 * el runtime real.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  answer,
  answerEmergency,
  type AiQuery,
  type AiResponse,
  type AiTier,
  type OrchestratorAdapters,
  type OrchestratorOptions,
} from '../services/ai/resilientAiOrchestrator';

export interface UseResilientAiOptions {
  /** Adapters cableados al orchestrator. Cualquier tier sin adapter se salta. */
  adapters: OrchestratorAdapters;
  /** Si `true`, usa el path `answerEmergency` (solo tiers locales, timeout 3s). */
  emergencyMode?: boolean;
  /** Override default tier timeout (orchestrator default = 8s). */
  tierTimeoutMs?: number;
  /** Override allowedTiers para forzar un subset. */
  allowedTiers?: AiTier[];
}

export interface UseResilientAiResult {
  ask: (
    prompt: string,
    opts?: Pick<AiQuery, 'domain' | 'tenantId' | 'userUid' | 'context'>,
  ) => Promise<AiResponse>;
  loading: boolean;
  lastResponse: AiResponse | null;
  error: string | null;
  cancel: () => void;
  /** Limpia `lastResponse` + `error` sin cancelar query en curso. */
  reset: () => void;
  /**
   * Estado de streaming token-by-token. `null` cuando no hay query
   * activa o cuando el tier final no fue SLM (zettelkasten/firestore/
   * gemini/canned no streamean). El caller pasa este objeto a
   * `<AiResponseCard streaming={...} />` para mostrar tokens mientras
   * llegan.
   */
  streaming: { text: string; tokensReceived: number; tier: 'slm' } | null;
}

export function useResilientAi(
  options: UseResilientAiOptions,
): UseResilientAiResult {
  const [loading, setLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<AiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<UseResilientAiResult['streaming']>(
    null,
  );

  // Track active query so we can ignore late results after `cancel()`.
  const activeIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Invalida queries en curso al unmount.
      activeIdRef.current += 1;
    };
  }, []);

  const ask = useCallback<UseResilientAiResult['ask']>(
    async (prompt, queryExtras = {}) => {
      // Reserve a new query id for cancellation invalidation.
      const id = ++activeIdRef.current;
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
        setStreaming({ text: '', tokensReceived: 0, tier: 'slm' });
      }

      // Codex P2 fix (PR #250, 2026-05-15): "Stop streaming after the SLM
      // tier fails". El orchestrator hace race(adapter, timeout) pero NO
      // aborta el inferStream subyacente cuando timeout gana — la SLM
      // sigue emitiendo tokens en background durante el fallback window.
      // Sin este gate, late tokens mutarían `streaming.text` mientras
      // zettelkasten/gemini corren → UI confusa (texto cambiando bajo el
      // usuario).
      //
      // Mantenemos una flag local a esta query: tokens solo se aceptan
      // hasta que (a) el orchestrator returns (cualquier tier), o (b) un
      // safety timeout = tierTimeoutMs × 1.1 (margen sobre el race del
      // orchestrator). Después de eso, tokens tardíos se descartan.
      const tierTimeoutMs = options.tierTimeoutMs ?? 8000;
      let slmTokenWindowOpen = true;
      const closeStreamWindow = (): void => {
        slmTokenWindowOpen = false;
      };
      const safetyTimeoutHandle = setTimeout(
        closeStreamWindow,
        Math.ceil(tierTimeoutMs * 1.1),
      );

      // Cable el streaming hook: cada token del SLM incrementa el
      // estado para que la UI se actualice incrementalmente. Si el tier
      // final NO fue slm (cae a zettelkasten/firestore/gemini/canned),
      // el setStreaming(null) en el wrap del response lo limpia.
      const onStreamToken = (token: string) => {
        if (
          id !== activeIdRef.current ||
          !mountedRef.current ||
          !slmTokenWindowOpen
        ) {
          return;
        }
        setStreaming((prev) =>
          prev
            ? {
                text: prev.text + token,
                tokensReceived: prev.tokensReceived + 1,
                tier: 'slm',
              }
            : null,
        );
      };

      const query: AiQuery = { prompt, ...queryExtras, onStreamToken };
      const orchestratorOpts: OrchestratorOptions = {
        tierTimeoutMs: options.tierTimeoutMs,
        allowedTiers: options.allowedTiers,
      };

      try {
        const r = options.emergencyMode
          ? await answerEmergency(query, options.adapters, {
              tierTimeoutMs: options.tierTimeoutMs,
            })
          : await answer(query, options.adapters, orchestratorOpts);

        // Closing the stream window inmediatamente — cualquier token tardío
        // del SLM (still running underground) ya no debe mutar la UI.
        closeStreamWindow();
        clearTimeout(safetyTimeoutHandle);

        // If a newer query started, discard this result silently.
        if (id !== activeIdRef.current || !mountedRef.current) {
          return r;
        }
        setLastResponse(r);
        setLoading(false);
        // Limpiar streaming — el caller ahora muestra `lastResponse`.
        setStreaming(null);
        return r;
      } catch (err) {
        closeStreamWindow();
        clearTimeout(safetyTimeoutHandle);
        // El orchestrator NO debería lanzar — esta rama atrapa errores
        // catastróficos del hook (e.g. caller pasó adapters undefined).
        const msg = err instanceof Error ? err.message : String(err);
        if (id === activeIdRef.current && mountedRef.current) {
          setError(msg);
          setLoading(false);
          setStreaming(null);
        }
        // Re-throw para que el caller pueda manejar el caso edge.
        throw err;
      }
    },
    [options],
  );

  const cancel = useCallback(() => {
    activeIdRef.current += 1;
    if (mountedRef.current) {
      setLoading(false);
      setStreaming(null);
    }
  }, []);

  const reset = useCallback(() => {
    if (mountedRef.current) {
      setLastResponse(null);
      setError(null);
      setStreaming(null);
    }
  }, []);

  return { ask, loading, lastResponse, error, cancel, reset, streaming };
}

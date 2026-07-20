// Sprint 20 fifth wave (Bucket Phi): wired al orchestrator SLM, soporta offline-first via Brecha B.
import React, { useState } from 'react';
import { Send, ShieldAlert, Loader2, Crosshair } from 'lucide-react';
import { logger } from '../../utils/logger';
// Bucket Phi T-1.5.x: orchestrator picks online (Gemini) vs. offline
// (on-device SLM) automatically, and `enqueueSession` captures offline
// answers for the reconciliation pass once connectivity returns.
import { ask, enqueueSession, type SLMResponse } from '../../services/slm';
import { SLM_ENQUEUED_EVENT } from '../slm/SLMProvider';
import { buildAsesorPrompt } from './asesorPrompt';
import { useProject } from '../../contexts/ProjectContext';
import { auth } from '../../services/firebase';

export function Asesor() {
  const { selectedProject } = useProject();
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  // Last response backend, for the small debug chip ("online" vs.
  // "offline"). Null until the first response.
  const [lastBackend, setLastBackend] = useState<SLMResponse['backend'] | null>(null);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      // The user's report is untrusted: fence it as data and keep the tactical
      // rules non-overridable (prompt-injection defense — see asesorPrompt.ts).
      const contextualQuery = buildAsesorPrompt(query);

      // Single entry point: orchestrator chooses online (Gemini, with the
      // Firebase ID token attached internally) vs. offline (on-device SLM)
      // based on `navigator.onLine`. We don't need to gate on `auth` here
      // anymore — the orchestrator falls back to the SLM if auth/network
      // is unavailable, which is exactly what we want for an emergency
      // tactical advisor.
      const slmResponse = await ask({ prompt: contextualQuery });
      setLastBackend(slmResponse.backend);
      setResponse(slmResponse.text || '');

      // If the orchestrator chose (or fell back to) the on-device SLM,
      // enqueue the session for later reconciliation against the server
      // LLM so the canonical record reflects the authoritative answer.
      if (slmResponse.backend === 'webgpu' || slmResponse.backend === 'wasm-simd') {
        try {
          // Seal the capture context: this answer belongs to the site and
          // the worker that produced it, not to whatever project happens
          // to be selected when connectivity returns.
          await enqueueSession({ prompt: contextualQuery }, slmResponse, {
            projectId: selectedProject?.id,
            uid: auth.currentUser?.uid,
          });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(SLM_ENQUEUED_EVENT));
          }
        } catch (queueErr) {
          logger.error('Error enqueueing offline emergency session:', queueErr);
        }
      }
    } catch (error) {
      logger.error('Error asking Asesor:', error);
      setResponse('Error de comunicación con el Asesor. Proceda con protocolo estándar de emergencia.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-rose-500/20 rounded-3xl p-6 flex flex-col h-full">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20 shrink-0">
          <Crosshair className="w-6 h-6 text-rose-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">El Asesor</h3>
          <p className="text-[10px] text-rose-500 dark:text-rose-400 font-bold uppercase tracking-widest">Estratega Táctico RAG (Seguro)</p>
        </div>
        {/* Bucket Phi: backend chip — surfaces which engine answered the
            last query (online Gemini vs. on-device SLM). */}
        {lastBackend && (
          <span
            className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border shrink-0 ${
              lastBackend === 'gemini'
                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
            }`}
            title={`Respuesta servida por: ${lastBackend}`}
          >
            {lastBackend === 'gemini' ? 'online' : 'offline'}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto mb-4 min-h-[200px] max-h-[400px] bg-white dark:bg-black/40 rounded-2xl p-4 border border-zinc-200 dark:border-white/5 custom-scrollbar">
        {response ? (
          <div className="prose prose-invert max-w-none">
            <div className="text-emerald-600 dark:text-emerald-400 font-mono text-sm sm:text-base whitespace-pre-wrap leading-relaxed">
              {response}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 py-8">
            <ShieldAlert className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-xs uppercase tracking-widest font-bold text-center px-4">Esperando reporte de situación para emitir plan táctico...</p>
          </div>
        )}
      </div>

      <form onSubmit={handleAsk} className="relative mt-auto">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Describa la emergencia (ej. 'Derrame de ácido en bodega 3')..."
          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl pl-4 pr-12 py-4 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          // Audit P0 §1.1 — WCAG 2.5.5 + Apple HIG 44pt + Material 48dp: min 44x44 touch target.
          className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 inline-flex items-center justify-center p-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}

// Praeventio Guard — Wire UI: <ResilientAiAssistantPanel />
//
// Host completo del asistente IA resiliente. Une:
//   - Input para que el usuario escriba prompts
//   - useResilientAi hook con adapters provistos por el caller
//   - <AiResponseCard /> para mostrar la respuesta
//   - Botón "Modo emergencia" que conmuta a answerEmergency (solo
//     tiers locales, timeout 3s)
//   - History interno (últimas 5 respuestas) que el usuario puede
//     revisar
//
// Diseñado para drop-in en cualquier route: el caller pasa los
// adapters (que son inyectados desde el shell vía context o providers).

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Send,
  Sparkles,
  AlertOctagon,
  Loader2,
  X,
  RotateCcw,
} from 'lucide-react';
import { useResilientAi } from '../../hooks/useResilientAi';
import { AiResponseCard } from './AiResponseCard';
import type {
  AiCitation,
  AiDomain,
  AiResponse,
  OrchestratorAdapters,
} from '../../services/ai/resilientAiOrchestrator';

interface ResilientAiAssistantPanelProps {
  adapters: OrchestratorAdapters;
  /** Tenant id para query (caller lo conoce). */
  tenantId?: string;
  /** User uid para query. */
  userUid?: string;
  /** Dominio default (suele detectarse, pero el caller puede forzar). */
  defaultDomain?: AiDomain;
  /** Callback al click en una citation (typically opens detail view). */
  onCitationClick?: (c: AiCitation) => void;
  /** Sugerencias de prompts predefinidos. Caller-provided. */
  suggestions?: string[];
  /** Placeholder del input. */
  placeholder?: string;
  /** Cap de history. Default 5. */
  maxHistory?: number;
}

interface HistoryEntry {
  prompt: string;
  response: AiResponse;
}

export function ResilientAiAssistantPanel({
  adapters,
  tenantId,
  userUid,
  defaultDomain,
  onCitationClick,
  suggestions = [],
  placeholder,
  maxHistory = 5,
}: ResilientAiAssistantPanelProps) {
  const { t } = useTranslation();
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const ai = useResilientAi({
    adapters,
    emergencyMode,
    tierTimeoutMs: emergencyMode ? 3000 : undefined,
  });

  const submit = useCallback(async () => {
    const prompt = draft.trim();
    if (prompt.length === 0 || ai.loading) return;
    setDraft('');
    const response = await ai.ask(prompt, {
      domain: defaultDomain,
      tenantId,
      userUid,
    });
    setHistory((prev) => {
      const next = [{ prompt, response }, ...prev];
      return next.slice(0, maxHistory);
    });
  }, [
    ai,
    defaultDomain,
    draft,
    maxHistory,
    tenantId,
    userUid,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter (sin shift) submitea; Shift+Enter inserta newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    ai.reset();
  }, [ai]);

  return (
    <section
      data-testid="resilient-ai-panel"
      data-emergency-mode={emergencyMode ? 'true' : 'false'}
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4 flex flex-col gap-3"
      aria-label={t('aiPanel.aria', 'Asistente IA resiliente') as string}
    >
      <header className="flex items-center gap-2">
        <Sparkles
          className="w-5 h-5 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100 flex-1">
          {t('aiPanel.title', 'Asistente IA')}
        </h2>
        <button
          type="button"
          onClick={() => setEmergencyMode((v) => !v)}
          data-testid="ai-panel-emergency-toggle"
          data-active={emergencyMode ? 'true' : 'false'}
          aria-pressed={emergencyMode}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border ${
            emergencyMode
              ? 'bg-rose-600 text-white border-rose-700'
              : 'bg-white/40 dark:bg-stone-800/40 text-stone-700 dark:text-stone-300 border-stone-500/30 hover:bg-rose-500/15'
          }`}
        >
          <AlertOctagon className="w-3 h-3" aria-hidden="true" />
          {emergencyMode
            ? t('aiPanel.emergencyActive', 'Modo emergencia')
            : t('aiPanel.emergencyToggle', 'Emergencia')}
        </button>
      </header>

      {/* Suggestions chips */}
      {suggestions.length > 0 && history.length === 0 && (
        <div className="flex flex-wrap gap-1" data-testid="ai-panel-suggestions">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setDraft(s)}
              data-testid={`ai-panel-suggestion-${i}`}
              className="inline-flex items-center px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/30 text-[11px] text-teal-700 dark:text-teal-300 hover:bg-teal-500/20"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* History (latest first) */}
      {history.length > 0 && (
        <div className="space-y-3" data-testid="ai-panel-history">
          {history.map((h, i) => (
            <AiResponseCard
              key={`${i}-${h.response.latencyMs}`}
              response={h.response}
              prompt={h.prompt}
              onCitationClick={onCitationClick}
              hideTelemetry={i > 0}
            />
          ))}
          <button
            type="button"
            onClick={clearHistory}
            data-testid="ai-panel-clear"
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold opacity-60 hover:opacity-100"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            {t('aiPanel.clear', 'Limpiar')}
          </button>
        </div>
      )}

      {/* Input */}
      <div className="relative">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={ai.loading}
          data-testid="ai-panel-input"
          placeholder={
            placeholder ??
            (t('aiPanel.placeholder', '¿Qué necesitas saber? (Enter para enviar)') as string)
          }
          rows={2}
          className="w-full px-3 py-2 pr-10 rounded-md border border-stone-500/30 bg-white/60 dark:bg-stone-800/50 text-sm text-stone-800 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={ai.loading || draft.trim().length === 0}
          data-testid="ai-panel-submit"
          aria-label={t('aiPanel.send', 'Enviar') as string}
          className="absolute right-2 top-2 p-1.5 rounded-md bg-teal-600 text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {ai.loading ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
        {ai.loading && (
          <button
            type="button"
            onClick={ai.cancel}
            data-testid="ai-panel-cancel"
            aria-label={t('aiPanel.cancel', 'Cancelar') as string}
            className="absolute right-12 top-2 p-1.5 rounded-md bg-stone-500/20 text-stone-700 dark:text-stone-300 hover:bg-stone-500/30"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {emergencyMode && (
        <p
          data-testid="ai-panel-emergency-hint"
          className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug"
        >
          {t(
            'aiPanel.emergencyHint',
            'En modo emergencia solo se consulta IA local + grafo. Sin red ni Gemini. Timeout 3s.',
          )}
        </p>
      )}
    </section>
  );
}

// Praeventio Guard — Wire UI: <AiResponseCard />
//
// Renderiza una `AiResponse` del orchestrator (#221). Mostrar:
//   - Texto de la respuesta (preservando saltos de línea)
//   - Badge del tier que respondió (color por confianza)
//   - Banner "Modo degradado" cuando degraded=true (con el motivo)
//   - Citations clickables agrupadas por kind (normative, node,
//     procedure, faq)
//   - Confidence visual (puntos en una barra)
//   - Latency en footer para debug
//
// El componente es presentational — recibe la AiResponse computada
// por el hook + callbacks opcionales para citation clicks.

import { useTranslation } from 'react-i18next';
import {
  Cpu,
  Network,
  Server,
  Database,
  ShieldAlert,
  AlertTriangle,
  FileText,
  BookOpen,
  GitBranch,
  HelpCircle,
  Clock,
  Sparkles,
} from 'lucide-react';
import type {
  AiResponse,
  AiTier,
  AiCitation,
} from '../../services/ai/resilientAiOrchestrator';

interface AiResponseCardProps {
  /**
   * Respuesta final del orchestrator. Si `streaming` está set, este prop
   * puede ser null/undefined hasta que termine el streaming.
   */
  response?: AiResponse | null;
  /** Callback al click en una citation. */
  onCitationClick?: (citation: AiCitation) => void;
  /** Si está set, muestra el prompt original encima de la respuesta. */
  prompt?: string;
  /** Override: oculta el footer de telemetría (tier badge + latency). */
  hideTelemetry?: boolean;
  /**
   * Estado de streaming token-by-token desde el SLM worker. Cuando está
   * presente, la card renderiza el texto en construcción + caret + skipea
   * citations/footer hasta que el caller swap `response` final.
   *
   * El caller es responsable de:
   *   - Incrementar `text` con cada token desde el worker
   *   - Limpiar este prop al recibir el `final` y pasar `response`
   */
  streaming?: {
    /** Texto acumulado hasta ahora. */
    text: string;
    /** Cuántos tokens / chunks recibidos. */
    tokensReceived: number;
    /** Tier que está streameando (típicamente 'slm'). */
    tier?: AiTier;
  } | null;
}

const TIER_META: Record<
  AiTier,
  { Icon: typeof Cpu; label: string; cls: string }
> = {
  slm: {
    Icon: Cpu,
    label: 'IA en dispositivo',
    cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  },
  zettelkasten: {
    Icon: GitBranch,
    label: 'Grafo del proyecto',
    cls: 'bg-teal-500/15 border-teal-500/40 text-teal-700 dark:text-teal-300',
  },
  firestore: {
    Icon: Database,
    label: 'Base de conocimiento',
    cls: 'bg-blue-500/15 border-blue-500/40 text-blue-700 dark:text-blue-300',
  },
  gemini: {
    Icon: Server,
    label: 'IA en línea',
    cls: 'bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-300',
  },
  canned: {
    Icon: ShieldAlert,
    label: 'Información base',
    cls: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300',
  },
};

const CITATION_ICON: Record<AiCitation['kind'], typeof BookOpen> = {
  normative: BookOpen,
  node: GitBranch,
  procedure: FileText,
  faq: HelpCircle,
};

const CITATION_LABEL: Record<AiCitation['kind'], string> = {
  normative: 'Normativa',
  node: 'Nodo del grafo',
  procedure: 'Procedimiento',
  faq: 'FAQ',
};

function ConfidenceDots({ value }: { value: number }) {
  // Render 5 dots, lit proportionally to value (0..1).
  const filled = Math.round(value * 5);
  return (
    <div
      className="inline-flex items-center gap-0.5"
      data-testid="ai-response-confidence"
      data-value={value.toFixed(2)}
      aria-label={`Confianza ${Math.round(value * 100)}%`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${
            i < filled
              ? value >= 0.7
                ? 'bg-emerald-500'
                : value >= 0.4
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              : 'bg-stone-300/40 dark:bg-stone-700/40'
          }`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function AiResponseCard({
  response,
  onCitationClick,
  prompt,
  hideTelemetry = false,
  streaming,
}: AiResponseCardProps) {
  const { t } = useTranslation();
  const isStreaming = Boolean(streaming);
  // Codex P2 fix (PR #250, 2026-05-15): cuando hay `response` final (caller
  // olvidó limpiar `streaming` o el final vino de otro tier post-fallback),
  // el badge debe reflejar el tier del response final, NO el del streaming
  // estancado. El final manda.
  const tierForBadge = response?.tier ?? streaming?.tier ?? 'slm';
  const tierMeta = TIER_META[tierForBadge];

  // Si solo hay streaming (sin response todavía) → render skeleton + stream.
  // Si hay response (con o sin streaming) → render lo final, ignorando stream
  //   (el caller debió limpiar `streaming` al recibir el final).
  // Si hay ambos (caso edge) → response gana.
  const displayText = response
    ? response.text
    : streaming
      ? streaming.text
      : '';

  // Group citations by kind for cleaner rendering.
  const citationsByKind = new Map<AiCitation['kind'], AiCitation[]>();
  if (response) {
    for (const c of response.citations) {
      const existing = citationsByKind.get(c.kind) ?? [];
      existing.push(c);
      citationsByKind.set(c.kind, existing);
    }
  }

  return (
    <article
      data-testid="ai-response-card"
      data-tier={tierForBadge}
      data-degraded={response?.degraded ? 'true' : 'false'}
      data-streaming={isStreaming && !response ? 'true' : 'false'}
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      aria-label={t('aiCard.aria', 'Respuesta del asistente IA') as string}
      aria-busy={isStreaming && !response}
    >
      {/* Optional prompt header */}
      {prompt && (
        <header className="mb-3 pb-2 border-b border-stone-500/20">
          <p
            data-testid="ai-response-prompt"
            className="text-[11px] uppercase tracking-wide font-bold text-stone-500 dark:text-stone-400 mb-1 flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            {t('aiCard.questionLabel', 'Pregunta')}
          </p>
          <p className="text-xs italic text-stone-700 dark:text-stone-300">
            {prompt}
          </p>
        </header>
      )}

      {/* Degraded banner — only when NOT tier=slm */}
      {response?.degraded && (
        <DegradedBanner tier={response.tier} tierErrors={response.tierErrors} />
      )}

      {/* Streaming progress indicator — solo mientras llegan tokens */}
      {isStreaming && !response && (
        <div
          data-testid="ai-response-streaming-indicator"
          data-tokens={streaming?.tokensReceived ?? 0}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-bold text-emerald-700 dark:text-emerald-300 mb-2"
          role="status"
          aria-live="polite"
        >
          <Cpu className="w-3 h-3 animate-pulse" aria-hidden="true" />
          {t('aiCard.streaming', 'IA generando…')}
          <span className="font-mono opacity-60">
            ({streaming?.tokensReceived ?? 0} tk)
          </span>
        </div>
      )}

      {/* Response text — preserve line breaks via whitespace-pre-wrap.
          Durante streaming agrega un caret animado al final. */}
      <p
        data-testid="ai-response-text"
        className="text-sm text-stone-800 dark:text-stone-100 leading-relaxed whitespace-pre-wrap mb-3"
      >
        {displayText}
        {isStreaming && !response && (
          <span
            data-testid="ai-response-streaming-caret"
            aria-hidden="true"
            className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-emerald-500 animate-pulse"
          />
        )}
      </p>

      {/* Citations grouped by kind */}
      {response && response.citations.length > 0 && (
        <div className="mb-3" data-testid="ai-response-citations">
          <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-1.5">
            {t('aiCard.citationsLabel', 'Fuentes')} ({response.citations.length})
          </p>
          <div className="space-y-2">
            {Array.from(citationsByKind.entries()).map(([kind, items]) => {
              const Icon = CITATION_ICON[kind];
              return (
                <div key={kind} data-testid={`ai-response-citation-group-${kind}`}>
                  <p className="text-[10px] font-bold opacity-70 flex items-center gap-1 mb-0.5">
                    <Icon className="w-3 h-3" aria-hidden="true" />
                    {CITATION_LABEL[kind]}
                  </p>
                  <ul className="flex flex-wrap gap-1">
                    {items.map((c) => {
                      const node = (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full bg-stone-500/10 border border-stone-500/30 text-[11px] font-mono text-stone-700 dark:text-stone-200"
                          data-testid={`ai-citation-${c.ref}`}
                        >
                          {c.label ?? c.ref}
                        </span>
                      );
                      return (
                        <li key={`${c.kind}-${c.ref}`}>
                          {onCitationClick ? (
                            <button
                              type="button"
                              onClick={() => onCitationClick(c)}
                              data-testid={`ai-citation-btn-${c.ref}`}
                              className="hover:brightness-110"
                            >
                              {node}
                            </button>
                          ) : (
                            node
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer: tier badge + confidence + latency. Solo cuando hay
          response final — durante streaming la métrica de confidence
          aún no está computada y el latency es 0. */}
      {!hideTelemetry && response && (
        <footer
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] pt-2 border-t border-stone-500/20"
          data-testid="ai-response-footer"
        >
          <span
            data-testid="ai-response-tier-badge"
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-bold uppercase tracking-wide ${tierMeta.cls}`}
          >
            <tierMeta.Icon className="w-3 h-3" aria-hidden="true" />
            {tierMeta.label}
          </span>
          <ConfidenceDots value={response.confidence} />
          <span
            data-testid="ai-response-latency"
            className="inline-flex items-center gap-0.5 opacity-60 font-mono"
          >
            <Clock className="w-3 h-3" aria-hidden="true" />
            {response.latencyMs} ms
          </span>
        </footer>
      )}
    </article>
  );
}

// ────────────────────────────────────────────────────────────────────────
// DegradedBanner — explica por qué la respuesta viene de un tier "bajo"
// ────────────────────────────────────────────────────────────────────────

interface DegradedBannerProps {
  tier: AiTier;
  tierErrors: AiResponse['tierErrors'];
}

const DEGRADED_REASON_BY_TIER: Record<AiTier, string> = {
  slm: '',
  zettelkasten:
    'La IA en dispositivo no respondió. Respuesta tomada del grafo del proyecto.',
  firestore:
    'La IA en dispositivo y el grafo no respondieron. Respuesta del banco de conocimiento.',
  gemini:
    'No fue posible responder offline. Se consultó la IA en línea (puede consumir datos).',
  canned:
    'Sin acceso a IA ni datos del proyecto. Respuesta base — confirma con tu prevencionista.',
};

function DegradedBanner({ tier, tierErrors }: DegradedBannerProps) {
  const { t } = useTranslation();
  const reason = DEGRADED_REASON_BY_TIER[tier];
  if (!reason) return null;
  return (
    <div
      data-testid="ai-response-degraded-banner"
      data-tier={tier}
      className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 mb-3 flex items-start gap-2"
      role="status"
    >
      <AlertTriangle
        className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wide">
          {t('aiCard.degradedLabel', 'Modo degradado')}
        </p>
        <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug mt-0.5">
          {reason}
        </p>
        {tierErrors.length > 0 && (
          <details className="mt-1 text-[10px] opacity-75">
            <summary
              data-testid="ai-response-degraded-details"
              className="cursor-pointer font-bold"
            >
              {t('aiCard.degradedDebug', 'Detalle técnico')}
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {tierErrors.map((e, i) => (
                <li key={i}>
                  <span className="inline-block w-20 opacity-70">{e.tier}:</span>
                  {e.error}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

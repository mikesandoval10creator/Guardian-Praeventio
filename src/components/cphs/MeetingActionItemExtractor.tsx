// Praeventio Guard — Fase 5 B12: <MeetingActionItemExtractor />
//
// Wires the orphaned meeting-pack capability (`extractMeetingActionItems`,
// server endpoint POST /api/sprint-k/:projectId/meeting-pack/extract-action-items)
// into the CPHS page. This is NON-duplicative: ComiteParitario already
// SUMMARIZES existing agreements (geminiService.summarizeAgreements); this goes
// the other direction — it reads raw meeting discussion text and proposes
// STRUCTURED action items (description + assignee + due date) that the user can
// add as `acuerdos`. The deterministic extractor lives server-side; this is the
// thin UI that had no consumer.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2, Loader2, Plus, AlertTriangle } from 'lucide-react';
import { extractMeetingActionItems } from '../../hooks/useMeetingPack';
import type { ActionItemSuggestion } from '../../services/meetingPack/meetingPackBuilder';
import { logger } from '../../utils/logger';
import { humanErrorMessage } from '../../lib/humanError';


export interface ExtractedAcuerdo {
  descripcion: string;
  responsable: string;
  fechaPlazo: string;
}

interface Props {
  projectId: string;
  /** Called when the user accepts a suggestion — pre-fills the acuerdo form. */
  onAdd: (item: ExtractedAcuerdo) => void;
}

export function MeetingActionItemExtractor({ projectId, onAdd }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<ActionItemSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExtract = useCallback(async () => {
    if (text.trim().length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await extractMeetingActionItems(projectId, { text: text.trim() });
      setSuggestions(res.suggestions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('meeting_action_items_extract_failed', { err: msg });
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [projectId, text]);

  return (
    <section
      className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-900/15 p-4 space-y-3"
      data-testid="meeting-action-extractor"
    >
      <h3 className="text-xs font-black text-violet-700 dark:text-violet-300 uppercase tracking-widest flex items-center gap-2">
        <Wand2 className="w-4 h-4" /> {t('cphs.extractor.heading', 'Extraer acuerdos del acta')}
      </h3>
      <p className="text-[11px] text-zinc-500">
        {t(
          'cphs.extractor.hint',
          'Pega la discusión de la reunión; se proponen acciones estructuradas (descripción, responsable, plazo) para agregar como acuerdos. La revisión final es del comité.',
        )}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={t('cphs.extractor.placeholder', 'Ej: "El supervisor debe revisar el andamio antes del viernes…"')}
        data-testid="meeting-action-text"
        className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
      />
      <button
        type="button"
        onClick={handleExtract}
        disabled={loading || text.trim().length === 0}
        data-testid="meeting-action-extract-btn"
        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white flex items-center gap-2"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        {t('cphs.extractor.run', 'Extraer acciones')}
      </button>

      {error && (
        <div className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1" data-testid="meeting-action-error">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {humanErrorMessage(error)}
        </div>
      )}

      {suggestions && suggestions.length === 0 && (
        <p className="text-[11px] text-zinc-500" data-testid="meeting-action-empty">
          {t('cphs.extractor.none', 'No se detectaron acciones en el texto.')}
        </p>
      )}

      {suggestions && suggestions.length > 0 && (
        <ul className="space-y-1.5" data-testid="meeting-action-list">
          {suggestions.map((s, i) => (
            <li
              key={`${s.description}-${i}`}
              data-testid={`meeting-action-item-${i}`}
              className="flex items-start gap-2 rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/50 p-2 text-xs"
            >
              <span className="flex-1 min-w-0">
                <span className="font-bold">{s.description}</span>
                {s.proposedDueDate && (
                  <span className="text-[10px] text-zinc-500"> · {s.proposedDueDate.slice(0, 10)}</span>
                )}
                <span className="text-[9px] text-zinc-400 block">
                  {t('cphs.extractor.confidence', 'confianza')} {Math.round(s.confidence * 100)}%
                </span>
              </span>
              <button
                type="button"
                onClick={() =>
                  onAdd({
                    descripcion: s.description,
                    responsable: s.proposedAssigneeUid ?? '',
                    fechaPlazo: s.proposedDueDate ? s.proposedDueDate.slice(0, 10) : '',
                  })
                }
                data-testid={`meeting-action-add-${i}`}
                className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> {t('cphs.extractor.add', 'Agregar')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default MeetingActionItemExtractor;

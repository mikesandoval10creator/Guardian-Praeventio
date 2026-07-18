// Praeventio Guard — Bloque 4.3 UI #3: <LessonPublishForm />
//
// Admin publica la leccion aprendida derivada de la investigacion. Incluye
// resumen, audiencia (uids), tags y categorias de riesgo. La publicacion
// dispara el paso 4 (Check) del PDCA. El paso 5 (Act) se lanza desde aqui
// con el boton "asignar capacitacion" en un componente hermano.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Tag, Users, Send } from 'lucide-react';
import {
  publishLesson,
  type PublishLessonPayload,
} from '../../hooks/useIncidentFlow';
import { humanErrorMessage } from '../../lib/humanError';


interface LessonPublishFormProps {
  projectId: string;
  incidentId: string;
  /** Auto-suggested lesson id (e.g. `lesson-${incidentId}-altura`). */
  defaultLessonId: string;
  /** Conclusion data needed for the chain (the orchestrator derives the
   *  rootCause node id from it). */
  conclusion: PublishLessonPayload['conclusion'];
  /** Preselected audience — typically the involved workers. */
  defaultAudienceUids: string[];
  onSuccess?: (lessonId: string) => void;
}

function csvSplit(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function LessonPublishForm({
  projectId,
  incidentId,
  defaultLessonId,
  conclusion,
  defaultAudienceUids,
  onSuccess,
}: LessonPublishFormProps) {
  const { t } = useTranslation();

  const [lessonId, setLessonId] = useState(defaultLessonId);
  const [summary, setSummary] = useState('');
  const [audience, setAudience] = useState(defaultAudienceUids.join(', '));
  const [tags, setTags] = useState('');
  const [riskCats, setRiskCats] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const audienceList = csvSplit(audience);
  const canSubmit =
    lessonId.trim().length > 0 &&
    summary.trim().length >= 10 &&
    audienceList.length > 0 &&
    !submitting &&
    !success;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const payload: PublishLessonPayload = {
        lessonId: lessonId.trim(),
        publishedAtIso: new Date().toISOString(),
        summary: summary.trim(),
        audienceUids: audienceList,
        tags: csvSplit(tags),
        riskCategories: csvSplit(riskCats),
        conclusion,
      };
      await publishLesson(projectId, incidentId, payload);
      setSuccess(true);
      onSuccess?.(lessonId.trim());
    } catch (err) {
      setErrorMsg(humanErrorMessage((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-amber-500/30 bg-surface p-4 shadow-mode space-y-3"
      data-testid="lesson-publish-form"
      aria-label={t('incidentFlow.lessonForm.aria', 'Publicar leccion aprendida') as string}
    >
      <header className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wide text-primary-token">
          {t('incidentFlow.lessonForm.title', 'Publicar leccion aprendida')}
        </h2>
      </header>

      <div>
        <label className="text-[10px] uppercase font-bold tracking-wide text-secondary-token block">
          {t('incidentFlow.lessonForm.idLabel', 'ID de la leccion')}
        </label>
        <input
          data-testid="lesson-id"
          value={lessonId}
          onChange={(e) => setLessonId(e.target.value)}
          maxLength={128}
          className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs font-mono focus:border-amber-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="text-[10px] uppercase font-bold tracking-wide text-secondary-token block">
          {t('incidentFlow.lessonForm.summaryLabel', 'Resumen de la leccion')}
          <span className="text-rose-500 ml-1">*</span>
        </label>
        <textarea
          data-testid="lesson-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder={t(
            'incidentFlow.lessonForm.summaryPlaceholder',
            'Una o dos frases sistemicas que cualquiera del rubro pueda aplicar.',
          ) as string}
          rows={4}
          minLength={10}
          maxLength={2000}
          required
          className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="text-[10px] uppercase font-bold tracking-wide text-secondary-token block flex items-center gap-1">
          <Users className="w-3 h-3" aria-hidden="true" />
          {t('incidentFlow.lessonForm.audienceLabel', 'Audiencia (uids separados por coma)')}
          <span className="text-rose-500 ml-1">*</span>
        </label>
        <textarea
          data-testid="lesson-audience"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="u-worker-1, u-worker-2, u-worker-3"
          rows={2}
          className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs font-mono focus:border-amber-500 focus:outline-none"
        />
        <p className="text-[9px] text-secondary-token mt-0.5">
          {audienceList.length} {t('incidentFlow.lessonForm.audienceCount', 'trabajadores')}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase font-bold tracking-wide text-secondary-token block flex items-center gap-1">
            <Tag className="w-3 h-3" aria-hidden="true" />
            {t('incidentFlow.lessonForm.tagsLabel', 'Tags')}
          </label>
          <input
            data-testid="lesson-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="altura, procedimiento"
            className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold tracking-wide text-secondary-token block">
            {t('incidentFlow.lessonForm.riskCatsLabel', 'Categorias de riesgo')}
          </label>
          <input
            data-testid="lesson-risk-cats"
            value={riskCats}
            onChange={(e) => setRiskCats(e.target.value)}
            placeholder="altura, electrico"
            className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none"
          />
        </div>
      </div>

      {errorMsg && (
        <div
          className="text-[11px] rounded bg-rose-500/10 border border-rose-500/30 px-2 py-1.5 text-rose-700 dark:text-rose-300"
          data-testid="lesson-error"
          role="alert"
        >
          {humanErrorMessage(errorMsg)}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="lesson-submit"
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-bold bg-amber-600 text-white disabled:opacity-40 hover:bg-amber-700"
      >
        <Send className="w-3.5 h-3.5" aria-hidden="true" />
        {success
          ? t('incidentFlow.lessonForm.published', 'Leccion publicada')
          : submitting
          ? t('incidentFlow.lessonForm.publishing', 'Publicando...')
          : t('incidentFlow.lessonForm.submit', 'Publicar leccion')}
      </button>
    </form>
  );
}

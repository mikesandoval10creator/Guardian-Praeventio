// Praeventio Guard — CEAL-SM/SUSESO worker response flow (anonymous).
//
// Renders the OFFICIAL Sección II of the CEAL-SM/SUSESO questionnaire (54
// items, 12 dimensions) verbatim from cealSmDefinition.ts (legal instrument
// text — es-CL only by design; UI chrome is i18n-translated). The worker
// answers once per campaign; the server stores only a peppered responder
// hash with the answers (never the uid) — see src/server/routes/cealSm.ts.
//
// The anonymity notice is rendered PROMINENTLY before the questionnaire:
// trust in the anonymity is what makes the answers honest (manual CEAL-SM
// §3.2.2 campaña de sensibilización).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, CheckCircle2, Loader2, Lock, Send } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import {
  listCealCampaigns,
  submitCealResponse,
  type CealCampaignSummary,
} from '../hooks/useCealSm';
import {
  CEAL_DIMENSIONS,
  CEAL_SCALE_OPTIONS,
  CEAL_ITEM_CODES,
} from '../services/protocols/cealSmDefinition';
import type { CealAnswers } from '../services/protocols/cealSm';
import { humanErrorMessage } from '../lib/humanError';


export function CealSmResponder() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();

  const [campaigns, setCampaigns] = useState<CealCampaignSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<CealAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectId = selectedProject?.id ?? null;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { campaigns: list } = await listCealCampaigns(projectId);
      setCampaigns(list.filter((c) => c.status === 'open'));
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = campaigns.find((c) => c.id === selectedId) ?? null;
  const answeredCount = useMemo(
    () => CEAL_ITEM_CODES.filter((code) => answers[code] !== undefined).length,
    [answers],
  );
  const complete = answeredCount === CEAL_ITEM_CODES.length;

  if (!selectedProject) {
    return (
      <div className="p-8 max-w-3xl mx-auto" data-testid="ceal-responder-empty">
        <p className="text-zinc-400 text-sm">
          {t('protocols_minsal.select_project', 'Selecciona un proyecto para gestionar el protocolo.')}
        </p>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!selected || !complete) return;
    setError(null);
    setSubmitting(true);
    try {
      await submitCealResponse(selectedProject.id, selected.id, answers);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'already_responded'
          ? t('ceal_sm.already_responded', 'Ya respondiste esta campaña. Solo se admite una respuesta por persona.')
          : t('ceal_sm.submit_error', 'No se pudo enviar tu respuesta. Reintenta.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6" data-testid="ceal-responder-page">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-primary uppercase tracking-tighter leading-tight flex items-center gap-3">
          <Brain className="w-8 h-8 text-violet-400" />
          {t('ceal_sm.responder_title', 'Cuestionario CEAL-SM / SUSESO')}
        </h1>
        <p className="text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] mt-2">
          {t('ceal_sm.responder_subtitle', 'Evaluación del ambiente laboral — Salud mental')}
        </p>
      </div>

      {/* Anonymity notice — prominent, before anything else. */}
      <div
        role="note"
        aria-label="Aviso de anonimato"
        data-testid="ceal-anonymity-notice"
        className="bg-teal-500/10 border-2 border-teal-500/40 rounded-2xl p-4 sm:p-5 flex items-start gap-3"
      >
        <Lock className="w-6 h-6 text-teal-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-black text-teal-300 uppercase tracking-wide">
            {t('ceal_sm.anonymity_title', 'Tu respuesta es anónima')}
          </p>
          <p className="text-xs text-teal-200/80 leading-relaxed">
            {t('ceal_sm.anonymity_body')}
          </p>
        </div>
      </div>

      {submitted ? (
        <div
          data-testid="ceal-submitted"
          className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 flex items-start gap-3"
        >
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-emerald-300">
              {t('ceal_sm.thanks_title', '¡Gracias por responder!')}
            </p>
            <p className="text-xs text-emerald-200/80 mt-1 leading-relaxed">
              {t('ceal_sm.thanks_body', 'Tu respuesta quedó registrada de forma anónima. Los resultados solo se mostrarán de manera agregada cuando haya suficientes respuestas para proteger el anonimato de todas las personas.')}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Campaign picker */}
          <div data-testid="ceal-open-campaigns" className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6 space-y-3">
            <h3 className="text-sm font-bold text-primary">
              {t('ceal_sm.open_campaigns', 'Campañas abiertas')}
            </h3>
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
              </div>
            ) : campaigns.length === 0 ? (
              <p data-testid="ceal-no-open" className="text-xs text-zinc-500">
                {t('ceal_sm.no_open_campaigns', 'No hay campañas abiertas en este momento.')}
              </p>
            ) : (
              <ul className="space-y-2">
                {campaigns.map((c) => (
                  <li key={c.id}>
                    {c.hasResponded ? (
                      <div
                        data-testid={`ceal-responded-${c.id}`}
                        className="w-full border border-white/5 rounded-xl p-3 flex items-center justify-between gap-2 opacity-70"
                      >
                        <span className="text-xs text-secondary line-clamp-1">{c.title}</span>
                        <span className="text-[10px] font-black text-emerald-400 shrink-0">
                          {t('ceal_sm.responded_badge', 'YA RESPONDIDA')}
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`ceal-pick-${c.id}`}
                        onClick={() => {
                          setSelectedId(c.id);
                          setAnswers({});
                          setError(null);
                        }}
                        className={`w-full text-left border rounded-xl p-3 flex items-center justify-between gap-2 transition-colors ${
                          selectedId === c.id
                            ? 'border-violet-500/50 bg-violet-500/5'
                            : 'border-white/5 hover:border-white/15'
                        }`}
                      >
                        <span className="text-xs font-bold text-primary line-clamp-1">{c.title}</span>
                        <span className="text-[10px] text-muted-token shrink-0">
                          {t('ceal_sm.respond_cta', 'Responder')} →
                        </span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Questionnaire — official Sección II, verbatim legal text. */}
          {selected && (
            <div data-testid="ceal-questionnaire" className="space-y-4">
              <div className="bg-surface border border-default-token rounded-2xl p-4">
                <p className="text-xs text-secondary leading-relaxed">
                  {/* Official instruction, Anexo Nº 1 Sección II (es-CL legal text). */}
                  A continuación, encontrará una serie de preguntas sobre los
                  contenidos y exigencias de su trabajo. Por favor, responda a
                  TODAS las preguntas y elija UNA SOLA RESPUESTA para cada una
                  de ellas. Recuerde que no existen respuestas buenas o malas.
                </p>
                <p className="text-[10px] font-bold text-violet-300 uppercase tracking-widest mt-3" data-testid="ceal-progress">
                  {t('ceal_sm.progress', {
                    defaultValue: 'Progreso: {{answered}} de {{total}}',
                    answered: answeredCount,
                    total: CEAL_ITEM_CODES.length,
                  })}
                </p>
              </div>

              {CEAL_DIMENSIONS.map((dim) => (
                <fieldset
                  key={dim.id}
                  data-testid={`ceal-dimension-${dim.id}`}
                  className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6 space-y-4"
                >
                  <legend className="sr-only">{dim.name}</legend>
                  <h3 className="text-xs font-black text-violet-400 uppercase tracking-widest">
                    {dim.name}
                  </h3>
                  {dim.items.map((item) => (
                    <div key={item.code} data-testid={`ceal-item-${item.code}`} className="space-y-2">
                      <p className="text-xs text-secondary leading-relaxed">{item.text}</p>
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={item.code}>
                        {CEAL_SCALE_OPTIONS[item.scale].map((opt) => {
                          const active = answers[item.code] === opt.points;
                          return (
                            <button
                              key={`${item.code}-${opt.points}`}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              data-testid={`ceal-opt-${item.code}-${opt.points}`}
                              onClick={() =>
                                setAnswers((prev) => ({ ...prev, [item.code]: opt.points }))
                              }
                              className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
                                active
                                  ? 'border-violet-500 bg-violet-500/20 text-violet-200 font-bold'
                                  : 'border-default-token bg-elevated text-secondary hover:border-white/25'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </fieldset>
              ))}

              <div className="sticky bottom-4 bg-canvas/90 backdrop-blur border border-default-token rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-3">
                <p className="text-xs text-secondary flex-1">
                  {complete
                    ? t('ceal_sm.ready_to_send', 'Cuestionario completo. Puedes enviar tu respuesta anónima.')
                    : t('ceal_sm.answer_all', {
                        defaultValue: 'Responde las {{remaining}} preguntas restantes para poder enviar.',
                        remaining: CEAL_ITEM_CODES.length - answeredCount,
                      })}
                </p>
                <button
                  type="button"
                  data-testid="ceal-submit-btn"
                  onClick={handleSubmit}
                  disabled={!complete || submitting}
                  className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {t('ceal_sm.submit', 'Enviar respuesta anónima')}
                </button>
              </div>
              {error && (
                <p data-testid="ceal-responder-error" className="text-xs text-rose-400">{humanErrorMessage(error)}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

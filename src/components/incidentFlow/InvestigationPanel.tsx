// Praeventio Guard — Bloque 4.3 UI #2: <InvestigationPanel />
//
// Admin / supervisor panel para conducir la investigacion. Tres tabs:
//   1. Testimonios — captura WitnessTestimony con versionado.
//   2. Causa raiz — analisis sistemico no-blame (usa PunitiveLanguageWarning).
//   3. Conclusion — submit del root cause + acciones preventivas.
//
// El panel cubre los pasos 2 y 3 del PDCA (Plan + Do): abrir investigacion
// + concluirla con causa raiz no-punitiva. La transicion al paso 4 (lesson)
// vive en LessonPublishForm.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Brain, FileCheck, Plus, Trash2 } from 'lucide-react';
import { PunitiveLanguageWarning } from '../investigation/PunitiveLanguageWarning';
import {
  openInvestigation,
  concludeInvestigation,
  type OpenInvestigationPayload,
  type ConcludeInvestigationPayload,
  type IncidentReportPayload,
} from '../../hooks/useIncidentFlow';

type Tab = 'testimonies' | 'rootCause' | 'conclude';

interface InvestigationPanelProps {
  projectId: string;
  incidentId: string;
  /** The original report payload — needed by the route to derive edges. */
  report: IncidentReportPayload;
  /** The current investigator uid (typically `auth.currentUser.uid` of admin). */
  investigatorUid: string;
  onOpened?: () => void;
  /** Fired after a successful conclusion. Surfaces the conclusion payload so a
   *  parent can feed it straight into <LessonPublishForm> (PDCA Check step). */
  onConcluded?: (conclusion: {
    concludedAtIso: string;
    rootCauseSummary: string;
    contributingFactor?: string;
    preventiveActions: string[];
    closedByUid: string;
  }) => void;
}

export function InvestigationPanel({
  projectId,
  incidentId,
  report,
  investigatorUid,
  onOpened,
  onConcluded,
}: InvestigationPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('testimonies');

  // Open-investigation state
  const [scopeNotes, setScopeNotes] = useState('');
  const [openSubmitting, setOpenSubmitting] = useState(false);
  const [opened, setOpened] = useState(false);
  const [openedAtIso, setOpenedAtIso] = useState<string | null>(null);

  // Conclusion state
  const [rootCauseSummary, setRootCauseSummary] = useState('');
  const [contributingFactor, setContributingFactor] = useState('');
  const [preventiveActions, setPreventiveActions] = useState<string[]>(['']);
  const [concludeSubmitting, setConcludeSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleOpenInvestigation = async () => {
    if (scopeNotes.trim().length < 10) return;
    setOpenSubmitting(true);
    setErrorMsg(null);
    try {
      const nowIso = new Date().toISOString();
      const payload: OpenInvestigationPayload = {
        investigatorUid,
        openedAtIso: nowIso,
        scopeNotes: scopeNotes.trim(),
        report,
      };
      await openInvestigation(projectId, incidentId, payload);
      setOpened(true);
      setOpenedAtIso(nowIso);
      setTab('rootCause');
      onOpened?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setOpenSubmitting(false);
    }
  };

  const handleConclude = async () => {
    if (rootCauseSummary.trim().length < 20) return;
    const cleanActions = preventiveActions
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    if (cleanActions.length === 0) return;
    if (!openedAtIso) return;

    setConcludeSubmitting(true);
    setErrorMsg(null);
    try {
      const payload: ConcludeInvestigationPayload = {
        concludedAtIso: new Date().toISOString(),
        rootCauseSummary: rootCauseSummary.trim(),
        contributingFactor: contributingFactor.trim() || undefined,
        preventiveActions: cleanActions,
        opening: {
          investigatorUid,
          openedAtIso,
          scopeNotes: scopeNotes.trim(),
        },
      };
      await concludeInvestigation(projectId, incidentId, payload);
      onConcluded?.({
        concludedAtIso: payload.concludedAtIso,
        rootCauseSummary: payload.rootCauseSummary,
        contributingFactor: payload.contributingFactor,
        preventiveActions: payload.preventiveActions,
        closedByUid: investigatorUid,
      });
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setConcludeSubmitting(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="investigation-panel"
      aria-label={t('incidentFlow.investigation.aria', 'Panel de investigacion') as string}
    >
      <header className="flex items-center gap-2">
        <Search className="w-5 h-5 text-teal-600 dark:text-teal-300" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wide text-primary-token">
          {t('incidentFlow.investigation.title', 'Investigacion del incidente')}
        </h2>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-default-token text-[11px] font-bold">
        {(
          [
            { id: 'testimonies', labelKey: 'incidentFlow.investigation.tabTestimonies', labelDefault: 'Apertura' },
            { id: 'rootCause', labelKey: 'incidentFlow.investigation.tabRoot', labelDefault: 'Causa raiz' },
            { id: 'conclude', labelKey: 'incidentFlow.investigation.tabConclude', labelDefault: 'Concluir' },
          ] as Array<{ id: Tab; labelKey: string; labelDefault: string }>
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            data-testid={`investigation-tab-${opt.id}`}
            onClick={() => setTab(opt.id)}
            aria-pressed={tab === opt.id}
            className={`px-3 py-1.5 -mb-px border-b-2 ${
              tab === opt.id
                ? 'border-teal-500 text-teal-700 dark:text-teal-300'
                : 'border-transparent text-secondary-token'
            }`}
          >
            {t(opt.labelKey, opt.labelDefault)}
          </button>
        ))}
      </div>

      {/* Apertura tab */}
      {tab === 'testimonies' && (
        <div className="space-y-2" data-testid="investigation-pane-open">
          <label className="text-[10px] uppercase font-bold tracking-wide text-secondary-token block">
            {t('incidentFlow.investigation.scopeLabel', 'Alcance de la investigacion')}
            <span className="text-rose-500 ml-1">*</span>
          </label>
          <textarea
            data-testid="investigation-scope"
            value={scopeNotes}
            onChange={(e) => setScopeNotes(e.target.value)}
            placeholder={t(
              'incidentFlow.investigation.scopePlaceholder',
              'Foco inicial: que procedimientos / equipos / contextos revisar.',
            ) as string}
            rows={4}
            minLength={10}
            maxLength={4000}
            className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
          />
          <button
            type="button"
            data-testid="investigation-open-submit"
            onClick={handleOpenInvestigation}
            disabled={scopeNotes.trim().length < 10 || openSubmitting || opened}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-bold bg-teal-600 text-white disabled:opacity-40 hover:bg-teal-700"
          >
            <Brain className="w-3.5 h-3.5" aria-hidden="true" />
            {opened
              ? t('incidentFlow.investigation.opened', 'Investigacion abierta')
              : openSubmitting
              ? t('incidentFlow.investigation.opening', 'Abriendo...')
              : t('incidentFlow.investigation.openSubmit', 'Abrir investigacion')}
          </button>
        </div>
      )}

      {/* Causa raiz tab */}
      {tab === 'rootCause' && (
        <div className="space-y-2" data-testid="investigation-pane-root">
          <label className="text-[10px] uppercase font-bold tracking-wide text-secondary-token block">
            {t('incidentFlow.investigation.rootLabel', 'Causa raiz (no-blame)')}
            <span className="text-rose-500 ml-1">*</span>
          </label>
          <textarea
            data-testid="investigation-root-cause"
            value={rootCauseSummary}
            onChange={(e) => setRootCauseSummary(e.target.value)}
            placeholder={t(
              'incidentFlow.investigation.rootPlaceholder',
              'Foco sistemico: que procedimiento, que recurso, que decision faltaba. No nombres personas.',
            ) as string}
            rows={5}
            minLength={20}
            maxLength={4000}
            className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
          />
          <p className="text-[9px] text-secondary-token">
            {rootCauseSummary.trim().length}/20{' '}
            {t('incidentFlow.investigation.rootMin', 'caracteres minimos')}
          </p>
          <PunitiveLanguageWarning text={rootCauseSummary} />

          <label className="text-[10px] uppercase font-bold tracking-wide text-secondary-token block mt-3">
            {t('incidentFlow.investigation.factorLabel', 'Factor contributivo (opcional)')}
          </label>
          <select
            data-testid="investigation-contributing-factor"
            value={contributingFactor}
            onChange={(e) => setContributingFactor(e.target.value)}
            className="w-full rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
          >
            <option value="">{t('incidentFlow.investigation.factorNone', '— sin clasificar —')}</option>
            <option value="procedure">procedure</option>
            <option value="training">training</option>
            <option value="supervision">supervision</option>
            <option value="resources">resources</option>
            <option value="equipment">equipment</option>
            <option value="environment">environment</option>
            <option value="organization">organization</option>
            <option value="communication">communication</option>
          </select>
        </div>
      )}

      {/* Concluir tab */}
      {tab === 'conclude' && (
        <div className="space-y-2" data-testid="investigation-pane-conclude">
          <p className="text-[11px] text-secondary-token leading-snug">
            {t(
              'incidentFlow.investigation.concludeHelper',
              'ISO 45001 exige al menos 1 accion preventiva. Cada accion sera trazable como nodo de cierre.',
            )}
          </p>

          <label className="text-[10px] uppercase font-bold tracking-wide text-secondary-token block">
            {t('incidentFlow.investigation.actionsLabel', 'Acciones preventivas')}
            <span className="text-rose-500 ml-1">*</span>
          </label>
          <ul className="space-y-1.5">
            {preventiveActions.map((a, i) => (
              <li key={i} className="flex gap-1.5">
                <input
                  data-testid={`investigation-action-${i}`}
                  value={a}
                  onChange={(e) => {
                    const next = [...preventiveActions];
                    next[i] = e.target.value;
                    setPreventiveActions(next);
                  }}
                  placeholder={t(
                    'incidentFlow.investigation.actionPlaceholder',
                    'Accion preventiva especifica',
                  ) as string}
                  maxLength={500}
                  className="flex-1 rounded border border-default-token bg-surface-elevated px-2 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
                />
                {preventiveActions.length > 1 && (
                  <button
                    type="button"
                    aria-label={t('incidentFlow.investigation.removeAction', 'Eliminar accion') as string}
                    data-testid={`investigation-remove-${i}`}
                    onClick={() => {
                      const next = [...preventiveActions];
                      next.splice(i, 1);
                      setPreventiveActions(next);
                    }}
                    className="px-2 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="investigation-add-action"
            onClick={() => setPreventiveActions([...preventiveActions, ''])}
            className="text-[11px] font-bold text-teal-700 dark:text-teal-300 hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
            {t('incidentFlow.investigation.addAction', 'Agregar accion')}
          </button>

          <button
            type="button"
            data-testid="investigation-conclude-submit"
            onClick={handleConclude}
            disabled={
              rootCauseSummary.trim().length < 20 ||
              preventiveActions.every((a) => a.trim().length === 0) ||
              concludeSubmitting ||
              !opened
            }
            className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-bold bg-amber-600 text-white disabled:opacity-40 hover:bg-amber-700"
          >
            <FileCheck className="w-3.5 h-3.5" aria-hidden="true" />
            {concludeSubmitting
              ? t('incidentFlow.investigation.concluding', 'Concluyendo...')
              : t('incidentFlow.investigation.conclude', 'Concluir investigacion')}
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          className="text-[11px] rounded bg-rose-500/10 border border-rose-500/30 px-2 py-1.5 text-rose-700 dark:text-rose-300"
          data-testid="investigation-error"
          role="alert"
        >
          {errorMsg}
        </div>
      )}
    </section>
  );
}

// Praeventio Guard — CEAL-SM/SUSESO campaign management (prevencionista).
//
// Riesgos psicosociales laborales: Protocolo de Vigilancia MINSAL oct. 2022,
// instrumento CEAL-SM/SUSESO (obligatorio desde 2023, reemplaza
// SUSESO/ISTAS21). This page lets the prevencionista/admin: crear campañas,
// monitorear participación (validez >= 60%, Protocolo sección 9) y ver los
// resultados k-gated del centro de trabajo: semáforo por dimensión, estado
// de riesgo del centro (Tabla 3/4) y acciones que exige el protocolo.
//
// ANONIMATO: this page only ever sees server aggregates. Below 10 responses
// the server suppresses everything (manual CEAL-SM §3.2.1.1) and the page
// renders the suppression notice instead.
//
// ADR 0012: evaluates the WORKPLACE, never a person; no clinical judgment.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Brain,
  Loader2,
  Plus,
  Scale,
  ShieldCheck,
  Users,
  AlertTriangle,
  ClipboardList,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import {
  createCealCampaign,
  listCealCampaigns,
  getCealResults,
  type CealCampaignSummary,
  type CealResultsResponse,
} from '../hooks/useCealSm';
import type { CealRiskLevel } from '../services/protocols/cealSmDefinition';
import { humanErrorMessage } from '../lib/humanError';


const RISK_BADGE: Record<CealRiskLevel, string> = {
  bajo: 'bg-emerald-500/10 text-emerald-400',
  medio: 'bg-orange-500/10 text-orange-400',
  alto: 'bg-rose-500/10 text-rose-400',
};

// Semáforo bar colors — manual: verde / naranja (no amarillo) / rojo.
const LEVEL_BAR: Record<CealRiskLevel, string> = {
  bajo: 'bg-emerald-500',
  medio: 'bg-orange-500',
  alto: 'bg-rose-500',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-CL');
}

function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function CealSmCampaigns() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();

  const [campaigns, setCampaigns] = useState<CealCampaignSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [openAt, setOpenAt] = useState('');
  const [closeAt, setCloseAt] = useState('');
  const [totalWorkers, setTotalWorkers] = useState(0);
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<CealResultsResponse | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);

  const projectId = selectedProject?.id ?? null;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { campaigns: list } = await listCealCampaigns(projectId);
      setCampaigns(list);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectId || !selectedId) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setResultsLoading(true);
    getCealResults(projectId, selectedId)
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .catch(() => {
        if (!cancelled) setResults(null);
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedId]);

  if (!selectedProject) {
    return (
      <div className="p-8 max-w-3xl mx-auto" data-testid="ceal-page-empty">
        <p className="text-muted-token text-sm">
          {t('protocols_minsal.select_project', 'Selecciona un proyecto para gestionar el protocolo.')}
        </p>
      </div>
    );
  }

  const handleCreate = async () => {
    setError(null);
    if (!title.trim() || !openAt || !closeAt || totalWorkers < 1) {
      setError(t('ceal_sm.form_incomplete', 'Completa título, fechas y dotación del centro de trabajo.'));
      return;
    }
    setCreating(true);
    try {
      await createCealCampaign(selectedProject.id, {
        title: title.trim(),
        openAt: new Date(`${openAt}T00:00:00.000Z`).toISOString(),
        closeAt: new Date(`${closeAt}T23:59:59.999Z`).toISOString(),
        totalWorkers,
      });
      setShowForm(false);
      setTitle('');
      setOpenAt('');
      setCloseAt('');
      setTotalWorkers(0);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'forbidden_role'
          ? t('ceal_sm.forbidden_role', 'Solo el administrador o el prevencionista pueden crear campañas CEAL-SM.')
          : t('ceal_sm.create_error', 'No se pudo crear la campaña. Reintenta.'),
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" data-testid="ceal-page">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Brain className="w-8 h-8 text-violet-400" />
            {t('ceal_sm.title', 'CEAL-SM / SUSESO')}
          </h1>
          <p className="text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] mt-2">
            {t('ceal_sm.subtitle', 'Vigilancia de riesgos psicosociales — Protocolo MINSAL 2022')}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/ceal-sm/responder"
            data-testid="ceal-responder-link"
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2.5 rounded-xl font-black uppercase tracking-widest text-xs transition-all"
          >
            <ClipboardList className="w-4 h-4" />
            {t('ceal_sm.go_respond', 'Responder cuestionario')}
          </Link>
          <button
            type="button"
            data-testid="ceal-new-campaign-btn"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            {t('ceal_sm.new_campaign', 'Nueva campaña')}
          </button>
        </div>
      </div>

      <div
        data-testid="ceal-legal-frame"
        className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 flex items-start gap-3"
      >
        <Scale className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-violet-200/90 leading-relaxed">
          {t('ceal_sm.legal_frame')}
        </p>
      </div>

      <div
        role="note"
        data-testid="ceal-anonymity-note"
        className="bg-teal-50/10 border border-teal-500/20 rounded-xl p-3 flex items-start gap-2"
      >
        <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-teal-200/80 leading-relaxed">
          {t('ceal_sm.anonymity_admin_note')}
        </p>
      </div>

      {showForm && (
        <div data-testid="ceal-create-form" className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-primary">
            {t('ceal_sm.create_title', 'Crear campaña de evaluación')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block sm:col-span-2">
              <span className="text-xs font-bold text-secondary uppercase tracking-widest">
                {t('ceal_sm.campaign_title', 'Título de la campaña')}
              </span>
              <input
                type="text"
                data-testid="ceal-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('ceal_sm.campaign_title_placeholder', 'Ej: Evaluación CEAL-SM 2026 — Faena Norte')}
                className="mt-1 w-full bg-elevated border border-default-token rounded-xl py-2.5 px-3 text-sm text-primary placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-secondary uppercase tracking-widest">
                {t('ceal_sm.open_at', 'Fecha de apertura')}
              </span>
              <input
                type="date"
                data-testid="ceal-openat-input"
                value={openAt}
                onChange={(e) => setOpenAt(e.target.value)}
                className="mt-1 w-full bg-zinc-800/70 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-secondary uppercase tracking-widest">
                {t('ceal_sm.close_at', 'Fecha de cierre')}
              </span>
              <input
                type="date"
                data-testid="ceal-closeat-input"
                value={closeAt}
                onChange={(e) => setCloseAt(e.target.value)}
                className="mt-1 w-full bg-zinc-800/70 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-secondary uppercase tracking-widest">
                {t('ceal_sm.total_workers', 'Dotación del centro de trabajo')}
              </span>
              <input
                type="number"
                min={1}
                data-testid="ceal-workers-input"
                value={totalWorkers || ''}
                onChange={(e) => setTotalWorkers(Number(e.target.value))}
                placeholder={t('ceal_sm.total_workers_placeholder', 'Nº total de trabajadores/as')}
                className="mt-1 w-full bg-elevated border border-default-token rounded-xl py-2.5 px-3 text-sm text-primary placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            </label>
          </div>
          <p className="text-[10px] text-muted-token leading-relaxed">
            {t('ceal_sm.total_workers_hint', 'La dotación es el denominador de la participación: el Protocolo exige que responda al menos el 60% para que la evaluación sea válida.')}
          </p>
          <button
            type="button"
            data-testid="ceal-create-btn"
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('ceal_sm.create', 'Crear campaña')}
          </button>
          {error && (
            <p data-testid="ceal-error" className="text-xs text-rose-400">{humanErrorMessage(error)}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Campaign list */}
        <div data-testid="ceal-campaign-list" className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6">
          <h3 className="text-sm font-bold text-primary mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-400" />
            {t('ceal_sm.campaigns_title', 'Campañas')}
          </h3>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
            </div>
          ) : campaigns.length === 0 ? (
            <p data-testid="ceal-campaigns-empty" className="text-xs text-muted-token">
              {t('ceal_sm.campaigns_empty', 'Aún no hay campañas CEAL-SM en este proyecto.')}
            </p>
          ) : (
            <ul className="space-y-3">
              {campaigns.map((c) => {
                const participation = c.participationRate ?? 0;
                const validityOk = participation >= 0.6;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-testid={`ceal-campaign-item-${c.id}`}
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left border rounded-xl p-3 space-y-2 transition-colors ${
                        selectedId === c.id
                          ? 'border-violet-500/50 bg-violet-500/5'
                          : 'border-white/5 hover:border-white/15'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-primary line-clamp-1">{c.title}</span>
                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded ${
                            c.status === 'open'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-elevated text-secondary'
                          }`}
                        >
                          {c.status === 'open'
                            ? t('ceal_sm.status_open', 'ABIERTA')
                            : t('ceal_sm.status_closed', 'CERRADA')}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-token">
                        {formatDate(c.openAt)} → {formatDate(c.closeAt)}
                      </p>
                      <div>
                        <div className="flex justify-between text-[10px] text-secondary mb-1">
                          <span>
                            {t('ceal_sm.participation', 'Participación')}: {c.responseCount}/{c.totalWorkers} ({pct(c.participationRate)})
                          </span>
                          <span className={validityOk ? 'text-emerald-400' : 'text-orange-400'}>
                            {validityOk
                              ? t('ceal_sm.valid_60', '≥60% ✓')
                              : t('ceal_sm.below_60', '<60%')}
                          </span>
                        </div>
                        <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
                          <div
                            className={`h-full ${validityOk ? 'bg-emerald-500' : 'bg-orange-500'}`}
                            style={{ width: `${Math.min(100, participation * 100)}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Results */}
        <div data-testid="ceal-results-panel" className="lg:col-span-2 bg-surface border border-default-token rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-primary">
            {t('ceal_sm.results_title', 'Resultados del centro de trabajo')}
          </h3>
          {!selectedId ? (
            <p data-testid="ceal-results-none" className="text-xs text-muted-token">
              {t('ceal_sm.results_select', 'Selecciona una campaña para ver sus resultados agregados.')}
            </p>
          ) : resultsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
            </div>
          ) : !results ? (
            <p className="text-xs text-rose-400">
              {t('ceal_sm.results_error', 'No se pudieron cargar los resultados.')}
            </p>
          ) : results.insufficientResponses ? (
            <div
              data-testid="ceal-results-suppressed"
              className="bg-teal-50/10 border border-teal-500/20 rounded-xl p-4 flex items-start gap-3"
            >
              <ShieldCheck className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs text-teal-200/80 leading-relaxed space-y-1">
                <p className="font-bold">
                  {t('ceal_sm.suppressed_title', 'Resultados protegidos por anonimato')}
                </p>
                <p>
                  {t('ceal_sm.suppressed_body', {
                    defaultValue:
                      'Hay {{count}} respuestas y se requieren al menos {{threshold}} para mostrar cualquier agregado. Con menos respuestas, los resultados podrían permitir identificar a quienes respondieron.',
                    count: results.totalResponses,
                    threshold: results.threshold ?? 10,
                  })}
                </p>
              </div>
            </div>
          ) : results.result ? (
            <div className="space-y-5">
              {/* Center verdict */}
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-testid="ceal-center-badge"
                  className={`text-xs font-black px-3 py-1.5 rounded-lg ${RISK_BADGE[results.result.centerRisk]}`}
                >
                  {t(`ceal_sm.center_risk_${results.result.centerRisk}`)}
                </span>
                <span className="text-xs text-secondary">
                  {t('ceal_sm.center_score', 'Puntaje del centro')}: <b className="text-primary">{results.result.centerScore}</b> (−24 a +24)
                </span>
                <span
                  data-testid="ceal-validity-badge"
                  className={`text-[10px] font-black px-2 py-1 rounded ${
                    results.result.evaluationValid
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-orange-500/10 text-orange-400'
                  }`}
                >
                  {results.result.evaluationValid
                    ? t('ceal_sm.evaluation_valid', 'EVALUACIÓN VÁLIDA (≥60%)')
                    : t('ceal_sm.evaluation_invalid', 'NO VÁLIDA: PARTICIPACIÓN <60%')}
                </span>
              </div>

              {/* Semáforo por dimensión */}
              <div data-testid="ceal-semaforo" className="space-y-2">
                <h4 className="text-[10px] font-black text-muted-token uppercase tracking-widest">
                  {t('ceal_sm.semaforo_title', 'Semáforo por dimensión (% de trabajadores/as por nivel de riesgo)')}
                </h4>
                {results.result.dimensions.map((d) => (
                  <div key={d.dimensionId} data-testid={`ceal-dim-${d.dimensionId}`} className="space-y-1">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-xs text-secondary">{d.name}</span>
                      <span className="text-[10px] text-muted-token shrink-0">
                        {d.centerPoints > 0 ? `+${d.centerPoints}` : d.centerPoints} pts ·{' '}
                        {d.percentages.alto}% {t('ceal_sm.in_alto', 'en alto')}
                      </span>
                    </div>
                    <div className="h-2.5 w-full bg-elevated rounded-full overflow-hidden flex">
                      {(['bajo', 'medio', 'alto'] as const).map((level) => (
                        <div
                          key={level}
                          className={LEVEL_BAR[level]}
                          style={{ width: `${d.percentages[level]}%` }}
                          title={`${t(`ceal_sm.level_${level}`)}: ${d.percentages[level]}%`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Acciones que exige el protocolo */}
              <div data-testid="ceal-actions">
                <h4 className="text-[10px] font-black text-muted-token uppercase tracking-widest mb-2">
                  {t('protocols_minsal.mandated_action', 'Acción que exige el protocolo')}
                </h4>
                <ul className="space-y-2">
                  {results.result.requiredActions.map((action, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-secondary leading-relaxed">
                      <AlertTriangle className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" aria-hidden="true" />
                      {/* Engine actions are es-CL by design (Protocolo MINSAL). */}
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

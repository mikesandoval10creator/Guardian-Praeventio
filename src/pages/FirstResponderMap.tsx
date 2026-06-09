// Praeventio Guard — First Responder Map page (Phase 5 "make real" wiring).
//
// The FirstResponderDispatchPanel + its engine (firstResponderMap.ts), server
// route (/api/sprint-k/:pid/first-responder-map/*) and client hook
// (useFirstResponderMap) were all built but the panel had NO parent — users
// could never reach it. This page is that container:
//   • fetches the REAL responder feed (brigade roster + last-known position
//     pings, audited server-side) → live coverage gaps, always.
//   • lets a supervisor pick an incident kind and builds a dispatch plan from
//     the REAL responders at the site location (preparedness + live response).
//   • dispatch actions are REAL: notifying/promoting a responder posts an
//     audited note to the project emergency channel (emergency_chat, ruled
//     member-writable in #807); "call mutual" dials SAMU (131). No stubs.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HeartPulse, Loader2, RefreshCw, Radio } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { db, collection, addDoc, serverTimestamp } from '../services/firebase';
import {
  fetchFirstResponderFeed,
  buildFirstResponderDispatchPlan,
} from '../hooks/useFirstResponderMap';
import { FirstResponderDispatchPanel } from '../components/firstResponderMap/FirstResponderDispatchPanel';
import type {
  Responder,
  CoverageGap,
  DispatchPlan,
  DispatchCandidate,
  IncidentKind,
} from '../services/firstResponderMap/firstResponderMap';

const INCIDENT_KINDS: { value: IncidentKind; label: string }[] = [
  { value: 'medical_emergency', label: 'Emergencia médica' },
  { value: 'cardiac_arrest', label: 'Paro cardíaco' },
  { value: 'trauma_injury', label: 'Trauma' },
  { value: 'fall_from_height', label: 'Caída en altura' },
  { value: 'confined_space_rescue', label: 'Rescate confinado' },
  { value: 'electrical_injury', label: 'Lesión eléctrica' },
  { value: 'fire', label: 'Incendio' },
  { value: 'chemical_exposure', label: 'Exposición química' },
  { value: 'mass_casualty', label: 'Múltiples víctimas' },
];

export function FirstResponderMap() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { user } = useFirebase();

  const [responders, setResponders] = useState<Responder[]>([]);
  const [coverageGaps, setCoverageGaps] = useState<CoverageGap[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [incidentKind, setIncidentKind] = useState<IncidentKind>('medical_emergency');
  const [plan, setPlan] = useState<DispatchPlan | null>(null);
  const [building, setBuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const projectId = selectedProject?.id ?? null;
  const lat = selectedProject?.coordinates?.lat ?? -33.4489;
  const lng = selectedProject?.coordinates?.lng ?? -70.6693;

  const loadFeed = useCallback(async () => {
    if (!projectId) return;
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const res = await fetchFirstResponderFeed(projectId);
      setResponders(res.responders);
      setCoverageGaps(res.coverageGaps);
    } catch (err) {
      setFeedError((err as Error).message || 'feed_error');
      setResponders([]);
      setCoverageGaps([]);
    } finally {
      setLoadingFeed(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const responderNameByUid = useMemo(
    () => Object.fromEntries(responders.map((r) => [r.uid, r.name])),
    [responders],
  );

  const buildPlan = useCallback(async () => {
    if (!projectId) return;
    setBuilding(true);
    setNotice(null);
    try {
      const res = await buildFirstResponderDispatchPlan(projectId, {
        responders,
        incident: { kind: incidentKind, location: { lat, lng } },
      });
      setPlan(res.plan);
    } catch (err) {
      setNotice(`No se pudo construir el plan de despacho: ${(err as Error).message}`);
    } finally {
      setBuilding(false);
    }
  }, [projectId, responders, incidentKind, lat, lng]);

  // REAL dispatch action — persist an audited note to the project emergency
  // channel so the dispatched responder + supervisors see it. Never throws out
  // of the click handler (a failed write must not break the dispatch UI).
  const postDispatch = useCallback(
    async (text: string) => {
      if (!projectId) return;
      try {
        await addDoc(collection(db, `projects/${projectId}/emergency_chat`), {
          text,
          sender: user?.displayName ?? user?.email ?? 'Despacho',
          senderRole: 'first_responder_dispatch',
          isSystem: true,
          createdAt: serverTimestamp(),
        });
        setNotice(text);
      } catch (err) {
        setNotice(`No se pudo registrar el despacho: ${(err as Error).message}`);
      }
    },
    [projectId, user],
  );

  const dispatchResponder = useCallback(
    (c: DispatchCandidate) => {
      const name = responderNameByUid[c.responderUid] ?? c.responderUid;
      const eta = Number.isFinite(c.estimatedArrivalSeconds)
        ? ` — ETA ${Math.round(c.estimatedArrivalSeconds)}s`
        : '';
      void postDispatch(`🚑 Despacho: ${name} (${c.matchedRole}) asignado al incidente${eta}.`);
    },
    [postDispatch, responderNameByUid],
  );

  const callMutual = useCallback(() => {
    // Real external action: dial SAMU (131) when no eligible on-site responder.
    if (typeof window !== 'undefined') window.location.href = 'tel:131';
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
          <HeartPulse className="w-8 h-8 text-rose-500" />
          {t('firstResponder.pageTitle', 'Mapa de Primer Respondedor')}
        </h1>
        <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
          {t('firstResponder.pageSubtitle', 'Cobertura en vivo y despacho del respondedor más apto')}
        </p>
      </div>

      {!projectId ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-white/10 p-12 text-center text-zinc-500">
          <Radio className="w-10 h-10 mx-auto mb-4 opacity-40" />
          <p className="text-sm font-bold uppercase tracking-widest">
            {t('firstResponder.noProject', 'Selecciona un proyecto para ver la cobertura de respondedores.')}
          </p>
        </div>
      ) : (
        <>
          {/* Incident dispatch controls */}
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 p-4 flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="flex-1 text-xs font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
              {t('firstResponder.incidentKind', 'Tipo de incidente')}
              <select
                value={incidentKind}
                onChange={(e) => setIncidentKind(e.target.value as IncidentKind)}
                className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white focus:outline-none focus:border-rose-500/50"
              >
                {INCIDENT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void buildPlan()}
              disabled={building || loadingFeed}
              data-testid="build-dispatch-plan"
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black uppercase rounded-xl flex items-center justify-center gap-2 disabled:opacity-40 transition-colors min-h-[40px]"
            >
              {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <HeartPulse className="w-4 h-4" />}
              {t('firstResponder.buildPlan', 'Construir plan de despacho')}
            </button>
            <button
              type="button"
              onClick={() => void loadFeed()}
              disabled={loadingFeed}
              aria-label={t('firstResponder.refresh', 'Refrescar cobertura') as string}
              className="p-2 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-white disabled:opacity-40 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <RefreshCw className={`w-4 h-4 ${loadingFeed ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {feedError && (
            <p className="text-xs text-rose-600 dark:text-rose-400" data-testid="first-responder-feed-error">
              {t('firstResponder.feedError', 'No se pudo cargar la cobertura')}: {feedError}
            </p>
          )}

          {notice && (
            <p
              className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2"
              data-testid="first-responder-notice"
            >
              {notice}
            </p>
          )}

          {/* The panel itself: idle (coverage) when no plan, dispatch view when built. */}
          <FirstResponderDispatchPanel
            plan={plan}
            coverageGaps={coverageGaps}
            responderNameByUid={responderNameByUid}
            onDispatchPrimary={dispatchResponder}
            onPromoteBackup={dispatchResponder}
            onCallMutual={callMutual}
          />
        </>
      )}
    </div>
  );
}

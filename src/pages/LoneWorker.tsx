// Praeventio Guard — Sprint mobile FGS: LoneWorker worker check-in page.
//
// Worker-facing surface at `/lone-worker/check-in` (the supervisor monitor
// lives at `/lone-worker`, EmergencyRoutes). Two responsibilities:
//
//   1. Big-button check-in for the worker's OWN active lone-worker session,
//      rendered by `LoneWorkerCheckInWidget` (posts through the AUDITED server
//      routes `/api/sprint-k/{projectId}/lone-worker/{check-in,end-session}`,
//      which write `audit_logs`). The page persists the engine's returned
//      session to Firestore so the supervisor monitor's live subscription
//      reflects it.
//
//   2. Android foreground service: while the worker is on this screen Android
//      keeps the persistent "Guardian Activo" notification + process alive even
//      if the WebView hibernates. No-op (no error) on web/iOS.
//
// OLA 1 (2026-06-14): replaced the previous FABRICATED mock session — which
// fed a fake card and violated the no-invented-data directive — with the
// worker's REAL active session (subscribeActiveLoneWorkerSessions filtered to
// the caller). Honest empty-state when the worker has no active session, with
// a one-tap start.

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Power, PauseCircle, UserCheck, Loader2 } from 'lucide-react';
import { LoneWorkerCheckInWidget } from '../components/loneWorker/LoneWorkerCheckInWidget';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import {
  startLoneWorkerFgs,
  stopLoneWorkerFgs,
  isRunning,
  isAndroidNative,
} from '../services/mobile/foregroundServiceClient';
import {
  subscribeActiveLoneWorkerSessions,
  saveLoneWorkerSession,
  patchLoneWorkerSession,
} from '../services/loneWorker/loneWorkerStore';
import type { LoneWorkerSession } from '../services/loneWorker/loneWorkerService';
import { logger } from '../utils/logger';

const DEFAULT_INTERVAL_MIN = 15;

export function LoneWorker() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const workerUid = user?.uid ?? 'anonymous';
  const projectId = selectedProject?.id;

  const [fgsActive, setFgsActive] = useState<boolean>(false);
  const [fgsMessage, setFgsMessage] = useState<string>('');

  const [session, setSession] = useState<LoneWorkerSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [starting, setStarting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // ── Worker's OWN active session (real data, no mock) ──────────────────────
  // subscribeActiveLoneWorkerSessions returns the project's live (non-ended)
  // sessions; we keep only the caller's. This page is the worker's check-in
  // screen, so only their own session is actionable here.
  useEffect(() => {
    if (!projectId) {
      setSession(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeActiveLoneWorkerSessions(
      projectId,
      (list) => {
        const mine = list.find((s) => s.workerUid === workerUid) ?? null;
        setSession(mine);
        setLoading(false);
      },
      (err) => {
        logger.warn('lone_worker_checkin_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [projectId, workerUid]);

  // ── Android foreground service lifecycle ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await startLoneWorkerFgs({
        workerUid,
        checkInIntervalSec: DEFAULT_INTERVAL_MIN * 60,
      });
      if (cancelled) return;
      setFgsActive(isRunning());
      setFgsMessage(
        r.applied
          ? `FGS ${r.reason}.`
          : r.reason === 'not_native'
            ? t('lone_worker.fgs_not_native')
            : r.reason === 'no_plugin'
              ? t('lone_worker.fgs_no_plugin')
              : `FGS error: ${r.error ?? t('lone_worker.fgs_error_unknown')}`,
      );
    })();
    return () => {
      cancelled = true;
      void stopLoneWorkerFgs().then(() => {
        setFgsActive(false);
      });
    };
  }, [workerUid, t]);

  const handleManualStop = useCallback(async () => {
    const r = await stopLoneWorkerFgs();
    setFgsActive(isRunning());
    setFgsMessage(
      r.applied ? t('lone_worker.fgs_stopped_msg') : r.error ?? t('lone_worker.fgs_not_running'),
    );
  }, [t]);

  const handleManualStart = useCallback(async () => {
    const r = await startLoneWorkerFgs({
      workerUid,
      checkInIntervalSec: DEFAULT_INTERVAL_MIN * 60,
    });
    setFgsActive(isRunning());
    setFgsMessage(r.applied ? `FGS ${r.reason}.` : `FGS no aplica (${r.reason}).`);
  }, [workerUid]);

  // ── Optional geolocation for the starting session ─────────────────────────
  const requestLocation = useCallback(async (): Promise<{ lat: number; lng: number } | null> => {
    if (!('geolocation' in navigator)) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 60_000 },
      );
    });
  }, []);

  const handleStartSession = useCallback(async () => {
    if (!user || !projectId) {
      setFeedback(t('lone_worker.start_need_project', 'Seleccioná un proyecto para iniciar tu sesión.'));
      return;
    }
    setStarting(true);
    setFeedback(null);
    try {
      const startedAt = new Date().toISOString();
      const id = `lws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const loc = await requestLocation();
      const next: LoneWorkerSession = {
        id,
        workerUid: user.uid,
        startedAt,
        checkInIntervalMin: DEFAULT_INTERVAL_MIN,
        checkIns: [],
        status: 'active',
        ...(loc ? { lastKnownLocation: { ...loc, at: startedAt } } : {}),
      };
      await saveLoneWorkerSession(projectId, next);
      setSession(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('lone_worker_checkin_start_failed', { err: msg });
      setFeedback(msg);
    } finally {
      setStarting(false);
    }
  }, [user, projectId, requestLocation, t]);

  // Persist the engine's returned session (from the audited server route) so
  // the supervisor monitor's live subscription reflects the check-in/end.
  const handleSessionUpdated = useCallback(
    (next: LoneWorkerSession) => {
      setSession(next.status === 'ended' || next.endedAt ? null : next);
      if (!projectId) return;
      void patchLoneWorkerSession(projectId, next.id, {
        checkIns: next.checkIns,
        status: next.status,
        ...(next.lastKnownLocation ? { lastKnownLocation: next.lastKnownLocation } : {}),
        ...(next.endedAt ? { endedAt: next.endedAt } : {}),
      }).catch((err) => {
        logger.warn('lone_worker_checkin_persist_failed', { err: String(err) });
        setFeedback(
          t('lone_worker.persist_failed', 'No se pudo guardar el check-in. Reintentá.'),
        );
      });
    },
    [projectId, t],
  );

  return (
    <section
      className="p-4 space-y-4 max-w-xl mx-auto"
      data-testid="loneWorker.page"
      aria-label={t('lone_worker.title')}
    >
      <header className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-teal-600" aria-hidden="true" />
        <h1 className="text-lg font-bold">{t('lone_worker.title')}</h1>
      </header>

      {feedback && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          {feedback}
        </div>
      )}

      {/* Worker's own session: real check-in widget OR honest empty-state. */}
      {!projectId ? (
        <div
          className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-white/10 dark:bg-zinc-900/60"
          data-testid="loneWorker.noProject"
        >
          {t('lone_worker.select_project', 'Seleccioná un proyecto para usar el check-in de trabajo solitario.')}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500" data-testid="loneWorker.loading">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : session ? (
        <LoneWorkerCheckInWidget
          projectId={projectId}
          session={session}
          onSessionUpdated={handleSessionUpdated}
          onError={(message) => setFeedback(message)}
        />
      ) : (
        <div
          className="rounded-2xl border border-zinc-200 bg-white p-5 text-center space-y-3 dark:border-white/10 dark:bg-zinc-900/60"
          data-testid="loneWorker.empty"
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t('lone_worker.no_active_session', 'No tenés una sesión de trabajo solitario activa.')}
          </p>
          <button
            type="button"
            onClick={handleStartSession}
            disabled={starting}
            data-testid="loneWorker.start"
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
            {t('lone_worker.start_session', 'Iniciar sesión ({{min}} min)', { min: DEFAULT_INTERVAL_MIN })}
          </button>
        </div>
      )}

      {/* Android foreground service controls (process survival while solo). */}
      <div
        className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 dark:border-white/10 dark:bg-zinc-900/60"
        data-testid="loneWorker.fgs"
      >
        <header className="flex items-center gap-2">
          <Power className={`w-4 h-4 ${fgsActive ? 'text-teal-600' : 'text-slate-400'}`} aria-hidden="true" />
          <h2 className="text-sm font-bold">
            {fgsActive ? t('lone_worker.fgs_active') : t('lone_worker.fgs_stopped')}
          </h2>
        </header>
        <p className="text-[11px] text-slate-600 dark:text-slate-400" data-testid="loneWorker.fgs.message">
          {fgsMessage || t('lone_worker.fgs_starting')}
        </p>
        <p className="text-[11px] text-slate-500">
          {t('lone_worker.platform_label')}: {isAndroidNative() ? t('lone_worker.platform_android') : t('lone_worker.platform_web')}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleManualStart}
            disabled={fgsActive}
            className="rounded-md px-3 py-2 text-xs font-bold bg-teal-600 text-white disabled:bg-slate-200 disabled:text-slate-400"
            data-testid="loneWorker.fgs.start"
          >
            <Power className="w-3 h-3 inline mr-1" aria-hidden="true" /> {t('lone_worker.btn_start')}
          </button>
          <button
            type="button"
            onClick={handleManualStop}
            disabled={!fgsActive}
            className="rounded-md px-3 py-2 text-xs font-bold bg-rose-600 text-white disabled:bg-slate-200 disabled:text-slate-400"
            data-testid="loneWorker.fgs.stop"
          >
            <PauseCircle className="w-3 h-3 inline mr-1" aria-hidden="true" /> {t('lone_worker.btn_stop')}
          </button>
        </div>
      </div>
    </section>
  );
}

export default LoneWorker;

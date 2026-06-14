// Praeventio Guard — OLA 1 (2026-06-14): evacuation dashboard CONSOLIDATION.
//
// This page is a thin CONTAINER around the live, server-backed evacuation board
// (`components/evacuation/EvacuationDashboard.tsx`). It replaces the previous
// IndexedDB single-device implementation, which was dangerous for a real
// evacuation: a "marcar seguro" on one supervisor's phone was invisible to
// everyone else (no real-time sync, no audit trail). The live board subscribes
// to Firestore (`tenants/{tid}/projects/{pid}/evacuations/{drillId}` + scans)
// and mutates ONLY through the audited server routes (/api/evacuation/*).
//
// Two safety rules this container enforces (both from an adversarial review):
//
//   1. A headcount needs a ROSTER. "Who's missing" is only meaningful against a
//      denominator (who SHOULD be at the meeting point). With no attendance the
//      board would report "100% / 0 faltantes" — a false all-clear. So we only
//      let the supervisor START a drill when today's attendance yields a real
//      expected roster; otherwise we tell them to register attendance first.
//
//   2. RESUME is driven by a live query for the ACTIVE (non-ended) drill, NOT a
//      localStorage marker. A drill ended on another device / by an auto-trigger
//      stamps `endedAt` (the doc survives); a stale marker would resume onto the
//      dead drill and silently lock the supervisor out of starting a new count.
//      Querying for `!endedAt` can never resume a finished drill.
//
// Life-safety surface — free on every tier, never tier-gated. No fabricated data.

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Loader2, AlertTriangle, Info } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useTenantId } from '../hooks/useTenantId';
import { db, collection, query, where, getDocs } from '../services/firebase';
import type { EvacuationDrill } from '../services/evacuation/evacuationHeadcount';
import {
  buildEvacuationRoster,
  type AttendanceRecord,
} from '../services/evacuation/rosterFromAttendance';
import { EvacuationDashboard as LiveEvacuationDashboard } from '../components/evacuation/EvacuationDashboard';
import { logger } from '../utils/logger';

type RosterState = 'loading' | 'ready' | 'empty' | 'error';

export function EvacuationDashboard() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const { tenantId, loading: tenantLoading } = useTenantId();

  const [expectedWorkers, setExpectedWorkers] = useState<EvacuationDrill['expectedWorkers']>([]);
  const [rosterState, setRosterState] = useState<RosterState>('loading');
  // The currently-active (non-ended) drill, discovered by query — the resume
  // source of truth. `undefined` = still resolving; `null` = none active.
  const [activeDrillId, setActiveDrillId] = useState<string | null | undefined>(undefined);
  // If the active-drill lookup FAILS we must NOT silently fall through to a
  // startable board — that would let the supervisor double-start a concurrent
  // drill (the server now also guards this with a 409, but the UI blocks first).
  const [activeLookupError, setActiveLookupError] = useState(false);
  const [activeRetryKey, setActiveRetryKey] = useState(0);

  // Pre-populate the expected roster from TODAY's attendance (the headcount
  // denominator). Failure → 'error' (visible, retryable), empty → 'empty'.
  useEffect(() => {
    if (!projectId) {
      setRosterState('loading');
      setExpectedWorkers([]);
      return undefined;
    }
    let cancelled = false;
    setRosterState('loading');
    (async () => {
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const snap = await getDocs(
          query(
            collection(db, `projects/${projectId}/attendance`),
            where('timestamp', '>=', startOfDay.toISOString()),
          ),
        );
        if (cancelled) return;
        const records = snap.docs.map((d) => d.data() as AttendanceRecord);
        const roster = buildEvacuationRoster(records, [], new Date());
        const expected = roster.expected.map((w) => ({
          uid: w.uid,
          fullName: w.fullName,
          ...(w.lastKnownLocation ? { lastKnownLocation: w.lastKnownLocation } : {}),
        }));
        setExpectedWorkers(expected);
        setRosterState(expected.length === 0 ? 'empty' : 'ready');
      } catch (err) {
        if (cancelled) return;
        logger.error('evacuation_attendance_roster_failed', { err: String(err), projectId });
        setExpectedWorkers([]);
        setRosterState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Discover the ACTIVE (non-ended) drill so a supervisor who reloads
  // mid-evacuation resumes the SAME drill. Querying for !endedAt can never
  // resume a finished drill (no stale-marker lockout). Drills per project are
  // few, so a full read + client filter avoids a composite index.
  useEffect(() => {
    if (!projectId || !tenantId) {
      setActiveDrillId(undefined);
      return undefined;
    }
    let cancelled = false;
    setActiveDrillId(undefined);
    setActiveLookupError(false);
    (async () => {
      try {
        const snap = await getDocs(
          collection(db, `tenants/${tenantId}/projects/${projectId}/evacuations`),
        );
        if (cancelled) return;
        const active = snap.docs
          .map((d) => d.data() as EvacuationDrill)
          .filter((dr) => !dr.endedAt)
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
        setActiveDrillId(active.length > 0 ? active[0].id : null);
      } catch (err) {
        if (cancelled) return;
        // A failed lookup must NOT fall through to a startable board: we cannot
        // know whether a drill is already running, and starting would create a
        // concurrent duplicate. Surface a blocking, retryable error instead.
        logger.warn('evacuation_active_drill_lookup_failed', { err: String(err), projectId });
        setActiveLookupError(true);
        setActiveDrillId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, tenantId, activeRetryKey]);

  // The board reports its active drill id (id on start, null on end). We mirror
  // it into local state so that, IN-SESSION, ending a drill returns the
  // supervisor to the start screen instead of stranding them on the postmortem.
  const handleDrillIdChange = useCallback((drillId: string | null) => {
    setActiveDrillId(drillId);
  }, []);

  const showBoard = activeDrillId != null || rosterState === 'ready';
  const resolvingActive = activeDrillId === undefined;

  return (
    <section className="p-4 space-y-4" data-testid="evacDashboard.page" aria-label={t('evac_dashboard.title', 'Tablero de evacuación')}>
      <header className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-rose-600" aria-hidden="true" />
        <h1 className="text-lg font-bold">{t('evac_dashboard.title', 'Tablero de evacuación')}</h1>
      </header>

      {!projectId ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-white/10 dark:bg-zinc-900/60" data-testid="evacDashboard.noProject">
          {t('evac_dashboard.no_project', 'Seleccioná un proyecto para gestionar su evacuación.')}
        </div>
      ) : tenantLoading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500" data-testid="evacDashboard.loading">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : !tenantId ? (
        // Signed-in-without-tenant-claim / logged-out: terminal guidance, never
        // an indefinite spinner (the old IndexedDB page didn't need a tenant).
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200" data-testid="evacDashboard.noTenant">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'evac_dashboard.no_tenant',
              'Tu sesión no tiene una organización asignada. Iniciá sesión con tu cuenta de la empresa para gestionar la evacuación.',
            )}
          </span>
        </div>
      ) : rosterState === 'loading' || resolvingActive ? (
        <div className="flex items-center justify-center py-12 text-zinc-500" data-testid="evacDashboard.loading">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : activeLookupError ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-200" data-testid="evacDashboard.lookupError">
          <span className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            {t(
              'evac_dashboard.lookup_failed',
              'No se pudo verificar si hay una evacuación en curso. Reintentá antes de iniciar una nueva para no duplicar el conteo.',
            )}
          </span>
          <button
            type="button"
            onClick={() => setActiveRetryKey((k) => k + 1)}
            data-testid="evacDashboard.lookupRetry"
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-rose-500"
          >
            {t('evac_dashboard.retry', 'Reintentar')}
          </button>
        </div>
      ) : showBoard ? (
        <LiveEvacuationDashboard
          projectId={projectId}
          tenantId={tenantId}
          expectedWorkers={expectedWorkers}
          meetingPointId="meeting-point-main"
          initialDrillId={activeDrillId ?? undefined}
          onDrillIdChange={handleDrillIdChange}
        />
      ) : rosterState === 'error' ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-200" data-testid="evacDashboard.rosterError">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'evac_dashboard.attendance_error',
              'No se pudo cargar la asistencia de hoy. Reintentá; sin la nómina no se puede iniciar un conteo de evacuación confiable.',
            )}
          </span>
        </div>
      ) : (
        // rosterState === 'empty' and no active drill.
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200" data-testid="evacDashboard.noAttendance">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'evac_dashboard.no_attendance',
              'Sin asistencia registrada hoy. Un conteo de evacuación necesita la nómina presente para saber QUIÉN falta: registrá la asistencia (check-in) del turno y volvé a esta pantalla.',
            )}
          </span>
        </div>
      )}
    </section>
  );
}

export default EvacuationDashboard;

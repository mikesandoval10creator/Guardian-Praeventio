// Praeventio Guard — OLA 1 (2026-06-14): evacuation dashboard CONSOLIDATION.
//
// This page is now a thin CONTAINER around the live, server-backed evacuation
// board (`components/evacuation/EvacuationDashboard.tsx`). It replaces the
// previous IndexedDB single-device implementation, which was dangerous for a
// real evacuation: a "marcar seguro" on one supervisor's phone was invisible to
// everyone else (no real-time sync, no audit trail). The live board subscribes
// to Firestore (`tenants/{tid}/projects/{pid}/evacuations/{drillId}` + scans)
// and mutates ONLY through the audited server routes (/api/evacuation/*), so
// headcount is consistent across devices and every scan is auditable.
//
// What we KEEP from the old page: pre-populating `expectedWorkers` from TODAY's
// attendance (`projects/{id}/attendance` → buildEvacuationRoster) so the
// headcount is the NOMINAL who's-missing list, not a guess. What we ADD:
// resume-across-reload (the IDB page persisted the active drill; we keep that
// capability with a localStorage marker fed by the board's onDrillIdChange) so a
// supervisor who reloads mid-evacuation rejoins the SAME drill, never a duplicate.
//
// Life-safety surface — free on every tier, never tier-gated. No fabricated
// data: when there is no attendance, we say so honestly (workers self-scan).

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

const ACTIVE_DRILL_KEY = (projectId: string) => `praeventio:evac:active:${projectId}`;

type RosterState = 'loading' | 'ready' | 'empty' | 'error';

export function EvacuationDashboard() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const { tenantId, loading: tenantLoading } = useTenantId();

  const [expectedWorkers, setExpectedWorkers] = useState<EvacuationDrill['expectedWorkers']>([]);
  const [rosterState, setRosterState] = useState<RosterState>('loading');
  const [initialDrillId, setInitialDrillId] = useState<string | undefined>(undefined);

  // Pre-populate the expected roster from TODAY's attendance (kept from the old
  // page — the valuable part). Failure degrades to "self-scan" honestly.
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

  // Resume an active drill after a reload (the live board loses its in-memory
  // drillId otherwise → supervisor could start a duplicate during a real
  // evacuation). The board reports the active drill id via onDrillIdChange.
  useEffect(() => {
    if (!projectId) {
      setInitialDrillId(undefined);
      return;
    }
    try {
      const stored = window.localStorage.getItem(ACTIVE_DRILL_KEY(projectId));
      setInitialDrillId(stored ?? undefined);
    } catch {
      setInitialDrillId(undefined);
    }
  }, [projectId]);

  const handleDrillIdChange = useCallback(
    (drillId: string | null) => {
      if (!projectId) return;
      try {
        if (drillId) window.localStorage.setItem(ACTIVE_DRILL_KEY(projectId), drillId);
        else window.localStorage.removeItem(ACTIVE_DRILL_KEY(projectId));
      } catch {
        /* localStorage unavailable (private mode) — board still works in-session. */
      }
    },
    [projectId],
  );

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
      ) : tenantLoading || !tenantId ? (
        <div className="flex items-center justify-center py-12 text-zinc-500" data-testid="evacDashboard.loading">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : rosterState === 'loading' ? (
        <div className="flex items-center justify-center py-12 text-zinc-500" data-testid="evacDashboard.rosterLoading">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          {rosterState === 'empty' && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200" data-testid="evacDashboard.noAttendance">
              <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t(
                  'evac_dashboard.no_attendance',
                  'Sin asistencia registrada hoy — la nómina esperada está vacía. Iniciá igual: los trabajadores se cuentan al escanear en el punto de encuentro.',
                )}
              </span>
            </div>
          )}
          {rosterState === 'error' && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-200" data-testid="evacDashboard.rosterError">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t(
                  'evac_dashboard.attendance_error',
                  'No se pudo cargar la asistencia para la nómina esperada. Podés iniciar igual; los escaneos en el punto de encuentro se registran de todos modos.',
                )}
              </span>
            </div>
          )}
          <LiveEvacuationDashboard
            projectId={projectId}
            tenantId={tenantId}
            expectedWorkers={expectedWorkers}
            meetingPointId="meeting-point-main"
            initialDrillId={initialDrillId}
            onDrillIdChange={handleDrillIdChange}
          />
        </>
      )}
    </section>
  );
}

export default EvacuationDashboard;

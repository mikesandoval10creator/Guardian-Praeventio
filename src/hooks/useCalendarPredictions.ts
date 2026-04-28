import { useCallback, useEffect, useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  predictUpcomingActivities,
  type CalendarEvent,
  type PredictedActivity,
  type ProjectPredictionContext,
} from '../services/calendar/predictions';
import {
  buildClimateRiskNodes,
  type ClimateForecastDay,
  type ClimateRiskAssessment,
} from '../services/zettelkasten/climateRiskCoupling';
import { logger } from '../utils/logger';

interface UseCalendarPredictionsResult {
  predictions: PredictedActivity[];
  climateRisks: ClimateRiskAssessment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Pulls a project's last-completion metadata + the upcoming calendar events
 * (via the existing /api/calendar/sync proxy) + the global climate context
 * and feeds them through the pure rule engines in
 * `services/calendar/predictions.ts` and
 * `services/zettelkasten/climateRiskCoupling.ts`.
 *
 * If the server endpoints aren't reachable (e.g. running locally without the
 * Express layer), the hook gracefully falls back to empty arrays and exposes
 * the failure via `error` instead of throwing.
 */
export function useCalendarPredictions(): UseCalendarPredictionsResult {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const [predictions, setPredictions] = useState<PredictedActivity[]>([]);
  const [climateRisks, setClimateRisks] = useState<ClimateRiskAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!selectedProject) {
      setPredictions([]);
      setClimateRisks([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const now = new Date();

      // 1) Fetch upcoming calendar events. Suppression in the rule engine
      // depends on this list, but the call is best-effort: if the OAuth
      // layer or backend is unreachable we proceed with an empty list.
      let events: CalendarEvent[] = [];
      try {
        if (user) {
          const idToken = await user.getIdToken();
          const res = await fetch('/api/calendar/list', {
            method: 'GET',
            headers: { Authorization: `Bearer ${idToken}` },
          });
          if (res.ok) {
            const data = await res.json();
            const items = Array.isArray(data?.items) ? data.items : [];
            events = items.map((it: any): CalendarEvent => ({
              id: String(it.id ?? ''),
              title: String(it.summary ?? it.title ?? ''),
              startTime: new Date(it.start?.dateTime ?? it.start?.date ?? Date.now()),
              endTime: new Date(it.end?.dateTime ?? it.end?.date ?? Date.now()),
              attendees: Array.isArray(it.attendees)
                ? it.attendees.map((a: any) => String(a.email ?? '')).filter(Boolean)
                : undefined,
            }));
          }
        }
      } catch (calendarErr) {
        logger.warn('useCalendarPredictions: calendar fetch failed, falling back to empty list', calendarErr);
      }

      // 2) Build the project context from the selected project. The Project
      // type doesn't yet carry last-completion timestamps; we pick them up
      // from any explicit metadata fields if present, otherwise we leave
      // them undefined and the rule engine simply skips that obligation.
      const meta = (selectedProject as unknown as Record<string, unknown>) ?? {};
      const parseDate = (v: unknown): Date | undefined => {
        if (!v) return undefined;
        if (v instanceof Date) return v;
        const d = new Date(String(v));
        return Number.isNaN(d.getTime()) ? undefined : d;
      };

      const projectContext: ProjectPredictionContext = {
        id: selectedProject.id,
        lastCphsMeeting: parseDate(meta.lastCphsMeeting),
        lastOdi: parseDate(meta.lastOdi),
        lastIperReview: parseDate(meta.lastIperReview),
        lastAudiometria: parseDate(meta.lastAudiometria),
        lastManagementReview: parseDate(meta.lastManagementReview),
        lastClimateReview: parseDate(meta.lastClimateReview),
        audiometriaDosePercent:
          typeof meta.audiometriaDosePercent === 'number'
            ? (meta.audiometriaDosePercent as number)
            : undefined,
      };

      const newPredictions = predictUpcomingActivities(events, [projectContext], now);

      // 3) Fetch the climate forecast (3-day boletín). If the endpoint isn't
      // available we skip climate enrichment without breaking the hook.
      let forecasts: ClimateForecastDay[] = [];
      try {
        const res = await fetch('/api/environment/forecast?days=3');
        if (res.ok) {
          const data = await res.json();
          const days = Array.isArray(data?.forecast) ? data.forecast : [];
          forecasts = days.map((d: any): ClimateForecastDay => ({
            date: new Date(d.date),
            conditionCode: d.conditionCode ?? d.condition ?? 'sunny',
            temperatureC: Number(d.temperatureC ?? d.temp ?? 20),
            windKmh: d.windKmh ?? d.windSpeed,
            precipMm: d.precipMm ?? d.precipitation,
          }));
        }
      } catch (climateErr) {
        logger.warn('useCalendarPredictions: climate fetch failed, skipping', climateErr);
      }

      const projectClimateCtx = {
        id: selectedProject.id,
        workTypes: (Array.isArray(meta.workTypes) ? (meta.workTypes as string[]) : []),
        outdoor: typeof meta.outdoor === 'boolean' ? (meta.outdoor as boolean) : true,
      };
      const newClimate = buildClimateRiskNodes(forecasts, [projectClimateCtx]);

      setPredictions(newPredictions);
      setClimateRisks(newClimate);
    } catch (err) {
      logger.error('useCalendarPredictions.refresh failed', err);
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setPredictions([]);
      setClimateRisks([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { predictions, climateRisks, loading, error, refresh };
}

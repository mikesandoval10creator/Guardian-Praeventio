// Praeventio Guard — Sprint K wire UI (2026-05-23) — Charlas diarias.
//
// Page `/safety-talks`. Service `talkTopicSuggester.ts` (suggestTalks
// determinístico desde ContextSignals — catálogo de topics + triggers)
// + card `DailyTalkSuggestion.tsx` existían sin page.
//
// UX:
//   - Form simple para configurar signals del día (riesgos activos,
//     tareas hoy, incidentes recientes, condiciones clima, newWorkers).
//   - DailyTalkSuggestion renderiza top 3 sugerencias con rationale.
//   - Botón "Marcar dada" persiste a Firestore (audit trail).
//   - Historial reciente de charlas dadas.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageCircle,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { DailyTalkSuggestion } from '../components/safetyTalks/DailyTalkSuggestion';
import {
  type ContextSignals,
  type SafetyTalkSuggestion,
} from '../services/safetyTalks/talkTopicSuggester';
import {
  saveTalk,
  subscribeTalks,
  type SafetyTalkRecord,
} from '../services/safetyTalks/safetyTalksStore';
import { logger } from '../utils/logger';

const DEFAULT_SIGNALS: ContextSignals = {
  recentIncidents: [],
  activeRisks: [],
  todaysTaskCategories: [],
  openFindingsByCategory: {},
  newWorkersCount: 0,
  weather: { uvIndex: 5, temperatureC: 18, windSpeedKmh: 20, rainProbabilityPercent: 10 },
};

// Plan 2026-05-24 §Fase B.6 batch4 — i18n sweep SafetyTalks.
export function SafetyTalks() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [talks, setTalks] = useState<SafetyTalkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Signal form state (mantengo todos editables manualmente).
  const [activeRisksRaw, setActiveRisksRaw] = useState('altura, eléctrico');
  const [todaysTasksRaw, setTodaysTasksRaw] = useState('altura');
  const [recentIncidentsRaw, setRecentIncidentsRaw] = useState('');
  const [findingsRaw, setFindingsRaw] = useState('');
  const [newWorkersCount, setNewWorkersCount] = useState(0);
  const [uvIndex, setUvIndex] = useState(5);
  const [temperatureC, setTemperatureC] = useState(18);
  const [windKmh, setWindKmh] = useState(20);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setTalks([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeTalks(
      projectId,
      (list) => {
        setTalks(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('safety_talks_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  // Parser de signals desde inputs textuales.
  const signals = useMemo<ContextSignals>(() => {
    const activeRisks = activeRisksRaw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const todaysTaskCategories = todaysTasksRaw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const recentIncidents = recentIncidentsRaw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((kind) => ({ kind, severity: 'medium' as const }));
    const openFindingsByCategory: Record<string, number> = {};
    findingsRaw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .forEach((f) => {
        openFindingsByCategory[f] = (openFindingsByCategory[f] ?? 0) + 1;
      });
    return {
      recentIncidents,
      activeRisks,
      todaysTaskCategories,
      openFindingsByCategory,
      newWorkersCount,
      weather: {
        uvIndex,
        temperatureC,
        windSpeedKmh: windKmh,
        rainProbabilityPercent: 10,
      },
    };
  }, [activeRisksRaw, todaysTasksRaw, recentIncidentsRaw, findingsRaw, newWorkersCount, uvIndex, temperatureC, windKmh]);

  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const handleMarkGiven = useCallback(
    async (sug: SafetyTalkSuggestion) => {
      if (!user || !selectedProject) return;
      try {
        const record: SafetyTalkRecord = {
          id: `${todayKey}__${sug.topicId}`,
          date: todayKey,
          topicId: sug.topicId,
          topicTitle: sug.title,
          durationMinutes: sug.durationMinutes,
          givenByUid: user.uid,
          givenAt: new Date().toISOString(),
          attendeeUids: [],
          notes: sug.rationale.join(' · '),
        };
        await saveTalk(selectedProject.id, record);
        setFeedback(
          t('safety_talks.feedback.recorded', {
            defaultValue: 'Charla "{{title}}" registrada para {{date}}.',
            title: sug.title,
            date: todayKey,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedback(msg);
      }
    },
    [user, selectedProject, todayKey],
  );

  const todayTalks = useMemo(
    () => talks.filter((t) => t.date === todayKey),
    [talks, todayKey],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-black text-primary-token tracking-tight flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-sky-500" /> {t('safety_talks.title', 'Charlas de seguridad')}
          </h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            {t(
              'safety_talks.subtitle',
              'Sugeridor determinístico de tema diario según señales contextuales (riesgos activos, tareas del día, incidentes recientes, clima). Sin LLM — top 3 sugerencias con rationale citando los disparadores.',
            )}
          </p>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-default-token bg-elevated p-6 text-center text-sm text-zinc-500">
            {t('safety_talks.empty.select_project', 'Seleccioná un proyecto.')}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <>
            {feedback && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {/* Form de signals */}
            <section className="rounded-2xl border border-default-token bg-elevated p-4 space-y-3">
              <h2 className="text-sm font-black text-secondary-token uppercase tracking-widest flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-500" />
                {t('safety_talks.signals.heading', 'Señales contextuales')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">
                    {t('safety_talks.signals.active_risks', 'Riesgos activos (coma)')}
                  </span>
                  <input
                    type="text"
                    value={activeRisksRaw}
                    onChange={(e) => setActiveRisksRaw(e.target.value)}
                    placeholder={t('safety_talks.signals.active_risks_placeholder', 'altura, eléctrico, confinado, químico')}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">
                    {t('safety_talks.signals.todays_tasks', 'Tareas hoy (coma)')}
                  </span>
                  <input
                    type="text"
                    value={todaysTasksRaw}
                    onChange={(e) => setTodaysTasksRaw(e.target.value)}
                    placeholder={t('safety_talks.signals.todays_tasks_placeholder', 'altura, soldadura, izaje')}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">
                    {t('safety_talks.signals.recent_incidents', 'Incidentes recientes (coma)')}
                  </span>
                  <input
                    type="text"
                    value={recentIncidentsRaw}
                    onChange={(e) => setRecentIncidentsRaw(e.target.value)}
                    placeholder={t('safety_talks.signals.recent_incidents_placeholder', 'caida_altura, contacto_electrico')}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">
                    {t('safety_talks.signals.findings', 'Hallazgos abiertos (coma)')}
                  </span>
                  <input
                    type="text"
                    value={findingsRaw}
                    onChange={(e) => setFindingsRaw(e.target.value)}
                    placeholder={t('safety_talks.signals.findings_placeholder', 'orden_aseo, epp_faltante')}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <label className="space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">{t('safety_talks.signals.uv_index', 'UV Index')}</span>
                  <input
                    type="number"
                    min={0}
                    max={11}
                    value={uvIndex}
                    onChange={(e) => setUvIndex(parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">{t('safety_talks.signals.temp', 'Temp °C')}</span>
                  <input
                    type="number"
                    value={temperatureC}
                    onChange={(e) => setTemperatureC(parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">{t('safety_talks.signals.wind', 'Viento km/h')}</span>
                  <input
                    type="number"
                    min={0}
                    value={windKmh}
                    onChange={(e) => setWindKmh(parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">{t('safety_talks.signals.new_workers', 'Workers nuevos')}</span>
                  <input
                    type="number"
                    min={0}
                    value={newWorkersCount}
                    onChange={(e) => setNewWorkersCount(parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
              </div>
            </section>

            {/* Sugerencias del día */}
            <DailyTalkSuggestion signals={signals} limit={3} onPick={handleMarkGiven} />

            {/* Talks dadas hoy. */}
            {todayTalks.length > 0 && (
              <section className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/15 p-4 space-y-2">
                <h2 className="text-sm font-black text-emerald-700 dark:text-emerald-300 uppercase tracking-widest flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {t('safety_talks.today.heading', {
                    defaultValue: 'Charlas dadas hoy ({{date}})',
                    date: todayKey,
                  })}
                </h2>
                <ul className="space-y-1">
                  {todayTalks.map((t) => (
                    <li key={t.id} className="text-xs text-emerald-700 dark:text-emerald-300">
                      <strong>{t.topicTitle}</strong> · {t.durationMinutes}min ·{' '}
                      por {t.givenByUid.slice(0, 12)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Historial reciente */}
            {talks.length > todayTalks.length && (
              <section className="space-y-2">
                <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest">
                  {t('safety_talks.history.heading', 'Historial reciente')}
                </h2>
                <ul className="space-y-1">
                  {talks
                    .filter((t) => t.date !== todayKey)
                    .slice(0, 10)
                    .map((t) => (
                      <li
                        key={t.id}
                        className="rounded-lg border border-default-token bg-elevated p-2 text-xs flex items-center gap-2"
                      >
                        <span className="font-mono text-[10px] text-zinc-500">{t.date}</span>
                        <span className="text-secondary-token flex-1 truncate">
                          {t.topicTitle}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {t.durationMinutes}min
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default SafetyTalks;

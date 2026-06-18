// Praeventio Guard — Dashboard page (orchestrator).
//
// A11 R18 refactor: this file used to be 911 LOC of mixed JSX, gamification
// math, ICS generation and module taxonomy. It is now a thin orchestrator
// that:
//
//   1. Pulls data from React contexts and hooks (ProjectContext,
//      UniversalKnowledgeContext, useGamification, useRiskEngine, …).
//   2. Computes derived values (compliance %, completed counts) via the
//      pure helpers in `components/dashboard/challengeUtils.ts`.
//   3. Renders a sequence of focused sub-components, each of which lives
//      in `components/dashboard/`.
//
// Behaviour and visuals are intentionally identical to the pre-refactor
// version — no UX changes, no new deps, no relocated state.

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { get, set } from 'idb-keyval';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { cacheAIResponse, getCachedAIResponse } from '../utils/pwa-offline';
import { FastCheckModal } from '../components/FastCheckModal';
import { AIInsightsModal } from '../components/dashboard/AIInsightsModal';
import { ComplianceModal } from '../components/dashboard/ComplianceModal';
import { RealTimeStatusWidget } from '../components/dashboard/RealTimeStatusWidget';
import { PredictiveAlertWidget } from '../components/dashboard/PredictiveAlertWidget';
import { MorningCheckIn } from '../components/gamification/MorningCheckIn';
import { useGamification } from '../hooks/useGamification';
import { NodeType } from '../types';
import { logger } from '../utils/logger';
import {
  industryChallenges,
  isChallengeCompletedAt,
  buildDailyChallengesIcs,
  downloadTextFile,
  computeProjectCompliance,
  POINTS_BY_PERIOD,
  type ChallengePeriod,
} from '../components/dashboard/challengeUtils';
import { WeatherBulletin } from '../components/dashboard/WeatherBulletin';
import { WeatherSafetyRecommendations } from '../components/WeatherSafetyRecommendations';
import { SunTrackerContainer } from '../components/SunTrackerContainer';
import { ComplianceCard } from '../components/dashboard/ComplianceCard';
import { ComplianceTrafficLight } from '../components/compliance/ComplianceTrafficLight';
import { useComplianceTrafficLight } from '../hooks/useComplianceTrafficLight';
import { RubroBenchmarksCard } from '../components/dashboard/RubroBenchmarksCard';
import { DashboardQuickActions } from '../components/dashboard/DashboardQuickActions';
import { EPPRequiredWidget } from '../components/dashboard/EPPRequiredWidget';
import { ManDownSupervisorWidget } from '../components/dashboard/ManDownSupervisorWidget';
import { DashboardHero } from '../components/dashboard/DashboardHero';
import { AdviceBanner } from '../components/dashboard/AdviceBanner';
import { ModuleGroupsGrid } from '../components/dashboard/ModuleGroupsGrid';
import { PlannerModal } from '../components/dashboard/PlannerModal';
import { ExpirationsListPanel } from '../components/expirations/ExpirationsListPanel';
import { useExpirableItems } from '../hooks/useExpirableItems';

export function Dashboard() {
  const { t } = useTranslation();
  const { selectedProject, projects } = useProject();
  // B.9 expirations panel — REAL expirable items (server-assembled from project
  // subcollections). Renders only when there is something to surface.
  const { items: expirables } = useExpirableItems(selectedProject?.id ?? null);
  // F.2 compliance traffic light — REAL legal engine snapshot (server-computed).
  const { result: complianceLight } = useComplianceTrafficLight(
    selectedProject?.id ?? null,
  );
  const { stats, completeChallenge } = useGamification();
  const { environment } = useUniversalKnowledge();
  const weather = environment?.weather;
  const seismic = environment?.seismic;
  const loadingWeather = !environment;
  const [isFastCheckOpen, setIsFastCheckOpen] = useState(false);
  const [showMorningCheckIn, setShowMorningCheckIn] = useState(false);
  const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const [isAIInsightsOpen, setIsAIInsightsOpen] = useState(false);
  const [isComplianceModalOpen, setIsComplianceModalOpen] = useState(false);
  const [activePeriod, setActivePeriod] = useState<ChallengePeriod>('daily');
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [, setLoadingInsights] = useState(false);
  const { nodes } = useRiskEngine();
  const isOnline = useOnlineStatus();

  const handleMorningCheckInComplete = async () => {
    const today = new Date().toISOString().split('T')[0];
    await set('lastMorningCheckIn', today);
    setShowMorningCheckIn(false);
  };

  useEffect(() => {
    const checkCheckIn = async () => {
      try {
        const lastCheckIn = await get('lastMorningCheckIn');
        const today = new Date().toISOString().split('T')[0];
        if (lastCheckIn !== today) {
          setShowMorningCheckIn(true);
        }
      } catch (err) {
        logger.error('Error checking IDB checkin', err);
        setShowMorningCheckIn(true);
      }
    };
    checkCheckIn();
  }, []);

  useEffect(() => {
    const fetchInsights = async () => {
      if (nodes.length === 0) return;
      setLoadingInsights(true);
      try {
        if (!isOnline) {
          const cached = await getCachedAIResponse('dashboard-insights');
          if (cached) {
            setAiInsights(cached);
          }
          setLoadingInsights(false);
          return;
        }

        const { predictGlobalIncidents } = await import('../services/geminiService');
        const context = nodes.slice(0, 20).map(n => `${n.type}: ${n.title}`).join(', ');

        let envContext = '';
        if (weather) {
          envContext += `Clima: ${weather.temp}°C, Viento: ${weather.windSpeed} km/h, Condición: ${weather.condition}. `;
        }
        if (seismic) {
          envContext += `Último Sismo: ${seismic.magnitude} magnitud en ${seismic.location}.`;
        }

        const insights = await predictGlobalIncidents(context, envContext);
        setAiInsights(insights);
        await cacheAIResponse('dashboard-insights', insights);
      } catch (error) {
        logger.error('Error fetching AI insights', error);
        const cached = await getCachedAIResponse('dashboard-insights');
        if (cached) {
          setAiInsights(cached);
        }
      } finally {
        setLoadingInsights(false);
      }
    };

    // Defer until browser is idle so first paint isn't blocked
    const id: number | ReturnType<typeof setTimeout> = 'requestIdleCallback' in window
      ? window.requestIdleCallback(() => fetchInsights())
      : setTimeout(fetchInsights, 500);

    return () => {
      if ('cancelIdleCallback' in window) window.cancelIdleCallback(id as number);
      else clearTimeout(id as ReturnType<typeof setTimeout>);
    };
  }, [nodes.length, weather, seismic, isOnline]);

  const industry = selectedProject?.industry || 'General';
  const currentChallenges = industryChallenges[industry] || industryChallenges['General'];

  // Helper that closes over the user's gamification stats — defers to the
  // pure `isChallengeCompletedAt` for the date-window logic.
  const isChallengeCompleted = (challengeName: string, period: ChallengePeriod) => {
    if (!stats.completedChallenges) return false;
    return isChallengeCompletedAt(stats.completedChallenges[challengeName], period);
  };

  const getComplianceData = () => {
    const types = {
      FINDING: NodeType.FINDING,
      TASK: NodeType.TASK,
      TRAINING: NodeType.TRAINING,
    };
    if (selectedProject) {
      return {
        percentage: computeProjectCompliance(selectedProject.id, nodes, types),
        label: selectedProject.name,
      };
    }

    if (projects && projects.length > 0) {
      const total = projects.reduce(
        (acc, p) => acc + computeProjectCompliance(p.id, nodes, types),
        0,
      );
      return {
        percentage: Math.round(total / projects.length),
        label: t('dashboard.global_average'),
      };
    }

    return { percentage: 0, label: t('dashboard.no_projects') };
  };

  const complianceData = getComplianceData();

  // Automated Gamification Logic — auto-complete challenges when matching
  // node types are created today for the active project.
  useEffect(() => {
    if (!selectedProject || nodes.length === 0) return;

    const now = new Date();
    const todayStr = now.toDateString();

    const nodesToday = nodes.filter(n =>
      n.projectId === selectedProject.id &&
      new Date(n.createdAt).toDateString() === todayStr
    );

    const checkAndComplete = async (
      challengeName: string,
      condition: boolean,
      period: ChallengePeriod = 'daily',
    ) => {
      if (condition && !isChallengeCompleted(challengeName, period)) {
        await completeChallenge(challengeName, POINTS_BY_PERIOD[period]);
      }
    };

    const hasFindingToday = nodesToday.some(n => n.type === NodeType.FINDING);
    checkAndComplete('Reportar 1 Hallazgo', hasFindingToday);

    const hasEPPToday = nodesToday.some(n => n.type === NodeType.EPP);
    checkAndComplete('Check-in EPP', hasEPPToday);

    const hasTrainingToday = nodesToday.some(n => n.type === NodeType.TRAINING);
    checkAndComplete('Charla 5 min', hasTrainingToday);

    const hasInspectionToday = nodesToday.some(n => n.type === NodeType.INSPECTION);
    checkAndComplete('Inspección de Andamios', hasInspectionToday);
    checkAndComplete('Inspección de Grúas', hasInspectionToday, 'monthly');

    const hasEmergencyToday = nodesToday.some(n => n.type === NodeType.EMERGENCY);
    checkAndComplete('Simulacro de Evacuación', hasEmergencyToday, 'weekly');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, selectedProject, stats.completedChallenges]);

  const getCompletedCount = (period: ChallengePeriod) => {
    return currentChallenges[period].filter(c => isChallengeCompleted(c, period)).length;
  };

  const toggleObjective = async (challenge: string) => {
    if (isChallengeCompleted(challenge, activePeriod)) return;
    await completeChallenge(challenge, POINTS_BY_PERIOD[activePeriod]);
  };

  const handleSyncCalendar = () => {
    const ics = buildDailyChallengesIcs(currentChallenges.daily);
    downloadTextFile(ics, 'praeventio_tareas.ics');
  };

  return (
    <div data-testid="dashboard-page" className="flex-1 flex flex-col justify-start gap-1 sm:gap-4 pb-20 sm:pb-4 pt-1 sm:pt-4 px-2 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full min-h-[calc(100vh-4rem)]">

      {/* Hero greeting + morning check-in trigger */}
      <DashboardHero onMorningCheckIn={() => setShowMorningCheckIn(true)} />

      {/* F.2 compliance traffic light (compact). Real legal engine; renders
          only once the snapshot is computed — never a fabricated placeholder. */}
      {complianceLight && (
        <div data-testid="compliance-traffic-light" className="flex">
          <ComplianceTrafficLight result={complianceLight} variant="compact" />
        </div>
      )}

      {showMorningCheckIn && (
        <MorningCheckIn onComplete={handleMorningCheckInComplete} />
      )}

      {/* Predictive alerts (renders nothing when no alerts) */}
      <PredictiveAlertWidget />

      {/* B.9 expirations — real expirable items; shown only when there are
          items to surface (no false "all clear" on empty/error). */}
      {expirables.length > 0 && <ExpirationsListPanel items={expirables} />}

      {/* Quick Actions */}
      <DashboardQuickActions
        onFastCheck={() => setIsFastCheckOpen(true)}
        onPlanner={() => setIsPlannerOpen(true)}
      />

      {/* Boletín Climático + Cumplimiento */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 sm:gap-4">
        <WeatherBulletin weather={weather ?? undefined} loading={loadingWeather} />
        <ComplianceCard
          percentage={complianceData.percentage}
          label={complianceData.label}
          onClick={() => setIsComplianceModalOpen(true)}
        />
      </div>

      {/* Épica Rubros SII slice 4 — anonymous benchmarks vs the same SII
          rubro (k-anonymity enforced server-side). Renders nothing when the
          project has no rubro or the endpoint is unavailable. */}
      <RubroBenchmarksCard />

      {/* Recomendaciones SST contextuales — DS 594, Ley 16.744. Sprint A wire
          merged via PR #514. Gates on `!weather.unavailable` to avoid the
          false "Condiciones normales" branch when OPENWEATHER key is missing.
          Maps `weather.uv` → `uvIndex` (component reads uvIndex internally;
          environment.weather exposes it as `uv`). Altitude passed through
          for DS 594 §53 altitude-tier recommendations. */}
      {weather && !weather.unavailable && (
        <WeatherSafetyRecommendations
          weather={{
            temp: weather.temp,
            windSpeed: weather.windSpeed,
            humidity: weather.humidity,
            uvIndex: weather.uv ?? undefined,
            altitude: weather.altitude ?? undefined,
            description: weather.condition,
          }}
        />
      )}

      {/* Sun/moon ambient tracker — Sprint A PR #516 wire. Visual companion
          to the weather bulletin showing 24h solar state + lunar phase +
          solar elevation arc. Codex P2 3309059265 fix: reads
          `selectedProject.coordinates.lat` (canonical project geo field per
          types/index.ts:155 + ProjectContext:17 — also consumed by
          EmergenciaAvanzada and SiteMap). Santiago (-33.4489) is the safe
          fallback when no project is selected or project lacks coordinates. */}
      <SunTrackerContainer
        lat={selectedProject?.coordinates?.lat ?? -33.4489}
      />

      {/* Daily safety tip — industry-aware */}
      <AdviceBanner />

      {/* 4. Real-Time Status Widget */}
      <RealTimeStatusWidget />

      {/* Man Down supervisor alert — only renders when events exist */}
      <ManDownSupervisorWidget />

      {/* 5. EPP Widget */}
      <EPPRequiredWidget />

      {/* 6. Modules - Scrollable Grid */}
      <ModuleGroupsGrid />

      {/* Modals */}
      <FastCheckModal
        isOpen={isFastCheckOpen}
        onClose={() => setIsFastCheckOpen(false)}
      />

      <PlannerModal
        isOpen={isPlannerOpen}
        onClose={() => setIsPlannerOpen(false)}
        industry={industry}
        activePeriod={activePeriod}
        onPeriodChange={setActivePeriod}
        challenges={currentChallenges[activePeriod]}
        completedCount={getCompletedCount(activePeriod)}
        isChallengeCompleted={(c) => isChallengeCompleted(c, activePeriod)}
        onToggleObjective={toggleObjective}
        onSyncCalendar={handleSyncCalendar}
      />

      <AIInsightsModal
        isOpen={isAIInsightsOpen}
        onClose={() => setIsAIInsightsOpen(false)}
        insights={aiInsights}
      />
      <ComplianceModal
        isOpen={isComplianceModalOpen}
        onClose={() => setIsComplianceModalOpen(false)}
        percentage={complianceData.percentage}
        projectName={complianceData.label}
      />
    </div>
  );
}

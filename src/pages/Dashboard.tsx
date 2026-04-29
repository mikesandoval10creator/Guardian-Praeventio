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
import { Sun } from 'lucide-react';
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
import { ComplianceCard } from '../components/dashboard/ComplianceCard';
import { DashboardQuickActions } from '../components/dashboard/DashboardQuickActions';
import { EPPRequiredWidget } from '../components/dashboard/EPPRequiredWidget';
import { ModuleGroupsGrid } from '../components/dashboard/ModuleGroupsGrid';
import { PlannerModal } from '../components/dashboard/PlannerModal';

export function Dashboard() {
  const { selectedProject, projects } = useProject();
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

    fetchInsights();
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
        label: 'Promedio Global',
      };
    }

    return { percentage: 0, label: 'Sin proyectos' };
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
    <div className="flex-1 flex flex-col justify-start gap-1 sm:gap-4 pb-20 sm:pb-4 pt-1 sm:pt-4 px-2 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full min-h-[calc(100vh-4rem)]">

      {/* Quick Action Bar */}
      <div className="flex justify-end mb-1 sm:mb-2">
        <button
          onClick={() => setShowMorningCheckIn(true)}
          className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 rounded-full text-[10px] sm:text-xs font-bold transition-all border border-emerald-500/20 hover:scale-105"
        >
          <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          Despertar Matutino
        </button>
      </div>

      {showMorningCheckIn && (
        <MorningCheckIn onComplete={handleMorningCheckInComplete} />
      )}
      <PredictiveAlertWidget />

      {/* 1. Boletín Climático + Cumplimiento */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 sm:gap-4 mt-1 sm:mt-0">
        <WeatherBulletin weather={weather} loading={loadingWeather} />
        <ComplianceCard
          percentage={complianceData.percentage}
          label={complianceData.label}
          onClick={() => setIsComplianceModalOpen(true)}
        />
      </div>

      {/* 3. Quick Actions */}
      <DashboardQuickActions
        onFastCheck={() => setIsFastCheckOpen(true)}
        onPlanner={() => setIsPlannerOpen(true)}
      />

      {/* 4. Real-Time Status Widget */}
      <RealTimeStatusWidget />

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

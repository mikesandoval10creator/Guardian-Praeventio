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

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { get, set } from 'idb-keyval';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useReconciliationStatus } from '../hooks/useReconciliationStatus';
import { cacheAIResponse, getCachedAIResponse } from '../utils/pwa-offline';
import { FastCheckModal } from '../components/FastCheckModal';
import { AIInsightsModal } from '../components/dashboard/AIInsightsModal';
import { ComplianceModal } from '../components/dashboard/ComplianceModal';
import { RealTimeStatusWidget } from '../components/dashboard/RealTimeStatusWidget';
import { PredictiveAlertWidget } from '../components/dashboard/PredictiveAlertWidget';
import { MorningCheckIn } from '../components/gamification/MorningCheckIn';
import { useGamification } from '../hooks/useGamification';
import { useWorkPermits } from '../hooks/useWorkPermits';
import { subscribeActiveStoppages } from '../services/stoppage/stoppageStore';
import { listRestrictedZonesBySite } from '../hooks/useRestrictedZones';
import { FaenaStateBanner } from '../components/operationalState/FaenaStateBanner';
import type { FaenaStateInput } from '../services/operationalState/faenaStateEngine';
import type { Stoppage } from '../services/stoppage/stoppageEngine';
import type { RestrictedZone } from '../services/zones/restrictedZonesEngine';
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
import { EppSelector } from '../components/epp/EppSelector';
import { rubroIdForIndustry } from '../components/epp/eppSelectorData';
import { ManDownSupervisorWidget } from '../components/dashboard/ManDownSupervisorWidget';
import { DashboardHero } from '../components/dashboard/DashboardHero';
import { AdviceBanner } from '../components/dashboard/AdviceBanner';
import { ModuleGroupsGrid } from '../components/dashboard/ModuleGroupsGrid';
import { PlannerModal } from '../components/dashboard/PlannerModal';
import { ExpirationsListPanel } from '../components/expirations/ExpirationsListPanel';
import { useExpirableItems } from '../hooks/useExpirableItems';
import { SlaWatchPanel } from '../components/escalation/SlaWatchPanel';
import { useSlaWatchItems } from '../hooks/useSlaWatchItems';
import { buildRoleViewRemote } from '../hooks/useRoleViews';
import type { RoleCard } from '../hooks/useRoleViews';
import { RoleViewCards } from '../components/roleViews/RoleViewCards';
import type { UserRole } from '../services/roleViews/roleViewBuilder';
import { KpiRow, type KpiItem } from '../components/dashboard/KpiRow';
import { DensityToggle } from '../components/shared/DensityToggle';
import { useDensityStore } from '../store/densityStore';
import { GuardianMascot } from '../components/shared/GuardianMascot';
import { guardianMood } from '../components/guardian/guardianMood';
import { ShieldCheck, FileCheck, Clock3, AlertOctagon } from 'lucide-react';

export function Dashboard() {
  const { t } = useTranslation();
  const { selectedProject, projects } = useProject();
  // B.9 expirations panel — REAL expirable items (server-assembled from project
  // subcollections). Renders only when there is something to surface.
  const { items: expirables } = useExpirableItems(selectedProject?.id ?? null);
  // SLA Watch — real corrective actions + work permits assessed for SLA compliance.
  const { items: slaItems } = useSlaWatchItems(selectedProject?.id ?? null);
  // F.2 compliance traffic light — REAL legal engine snapshot (server-computed).
  const { result: complianceLight } = useComplianceTrafficLight(
    selectedProject?.id ?? null,
  );
  const density = useDensityStore((s) => s.density);
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
  const { lastStats, running } = useReconciliationStatus();
  const { data: workPermitsData } = useWorkPermits(selectedProject?.id ?? null, { status: 'active' });
  const [activeStoppages, setActiveStoppages] = useState<Stoppage[]>([]);
  const [restrictedZones, setRestrictedZones] = useState<RestrictedZone[]>([]);
  const [roleCards, setRoleCards] = useState<RoleCard[]>([]);
  const { userRole: fbRole } = useFirebase();
  const ROLE_MAP: Record<string, UserRole> = {
    operario: 'worker',
    worker: 'worker',
    supervisor: 'site_chief',
    prevencionista: 'prevention',
    admin: 'management',
    management: 'management',
  };
  const mappedRole = ROLE_MAP[fbRole] ?? 'worker';

  useEffect(() => {
    if (!selectedProject?.id) return;
    const unsub = subscribeActiveStoppages(selectedProject.id, (stoppages) => {
      setActiveStoppages(stoppages);
    });
    return unsub;
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject?.id) return;
    let cancelled = false;
    listRestrictedZonesBySite(selectedProject.id)
      .then((res) => {
        if (cancelled) return;
        const now = Date.now();
        setRestrictedZones(
          res.zones.filter((z) => {
            if (Date.parse(z.activeFrom) > now) return false;
            if (z.activeUntil && Date.parse(z.activeUntil) < now) return false;
            return true;
          }),
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProject?.id]);

  const faenaInput = useMemo<FaenaStateInput>(() => {
    const projectNodes = selectedProject
      ? nodes.filter((n) => n.projectId === selectedProject.id)
      : nodes;

    const activeEmergencyIncidents = projectNodes.filter(
      (n) =>
        (n.type === NodeType.EMERGENCY || n.type === NodeType.INCIDENT) &&
        (n.metadata?.status === 'active' || n.metadata?.estado === 'Abierto'),
    ).length;

    const openCriticalFindings = projectNodes.filter(
      (n) =>
        n.type === NodeType.FINDING &&
        (
          n.metadata?.severity === 'critical' ||
          n.metadata?.severity === 'Crítica' ||
          n.metadata?.criticidad === 'Crítica' ||
          n.metadata?.criticidad === 'critical'
        ) &&
        n.metadata?.status !== 'closed' &&
        n.metadata?.status !== 'resolved' &&
        n.metadata?.estado !== 'Cerrado',
    ).length;

    const criticalEquipmentDown = projectNodes
      .filter(
        (n) =>
          n.type === NodeType.MACHINE &&
          (
            n.metadata?.status === 'out_of_service' ||
            n.metadata?.status === 'Fuera de servicio' ||
            n.metadata?.operational === false
          ),
      )
      .map((n) => ({ id: n.id, label: n.title }));

    return {
      activeEmergencyIncidents,
      activeStoppages: activeStoppages.map((s) => ({
        id: s.id,
        reason: s.reason,
        sinceIso: s.declaredAt,
      })),
      restrictedZones: restrictedZones.map((z) => ({
        id: z.id,
        reason: z.name,
      })),
      criticalEquipmentDown,
      openCriticalFindings,
      activeWorkPermits: workPermitsData?.permits?.length ?? 0,
    };
  }, [nodes, selectedProject, activeStoppages, restrictedZones, workPermitsData]);

  useEffect(() => {
    if (!selectedProject?.id) return;
    let cancelled = false;
    const userRole = mappedRole;
    const projectNodes = nodes.filter((n) => n.projectId === selectedProject.id);
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const todayStr = new Date().toDateString();
    const faenaState: 'operativa' | 'restringida' | 'parcialmente_detenida' | 'detenida' | 'emergencia' =
      faenaInput.activeEmergencyIncidents > 0
        ? 'emergencia'
        : activeStoppages.length > 0
          ? 'detenida'
          : restrictedZones.length > 0
            ? 'restringida'
            : 'operativa';
    buildRoleViewRemote(selectedProject.id, {
      state: {
        userRole,
        overdueActions: projectNodes.filter(
          (n) =>
            n.type === NodeType.FINDING &&
            n.metadata?.status !== 'closed' &&
            n.metadata?.status !== 'resolved' &&
            n.metadata?.status !== 'Cerrado',
        ).length,
        pendingApprovals: 0,
        todaysTasks: projectNodes.filter(
          (n) => n.type === NodeType.TASK && new Date(n.createdAt).toDateString() === todayStr,
        ).length,
        myEppExpiringSoon: expirables.filter((e) => e.kind === 'epp').length,
        myTrainingExpiringSoon: expirables.filter((e) => e.kind === 'training').length,
        myUnreadDocuments: 0,
        criticalIncidentsLast7d: projectNodes.filter(
          (n) =>
            (n.type === NodeType.EMERGENCY || n.type === NodeType.INCIDENT) &&
            Date.parse(n.createdAt) > sevenDaysAgo,
        ).length,
        faenaState,
        complianceScore: complianceLight?.score ?? undefined,
      },
    })
      .then((res) => {
        if (!cancelled) setRoleCards(res.cards);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProject?.id, mappedRole, nodes, faenaInput, activeStoppages, restrictedZones, expirables, complianceLight]);

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

  const kpiItems: KpiItem[] = [
    {
      id: 'compliance',
      label: t('dashboard.kpi.compliance', 'Cumplimiento'),
      value: `${complianceData.percentage}%`,
      sub: complianceLight
        ? t('dashboard.kpi.sourced', '{{n}} de {{m}} fuentes', {
            n: complianceLight.sourcedCount, m: complianceLight.totalCount,
          })
        : complianceData.label,
      tone: complianceData.percentage >= 90 ? 'success' : complianceData.percentage >= 70 ? 'brand' : 'attention',
      icon: ShieldCheck,
    },
    {
      id: 'permits',
      label: t('dashboard.kpi.permits', 'Permisos activos'),
      value: workPermitsData?.permits?.length ?? 0,
      sub: t('dashboard.kpi.permits_sub', 'PT vigentes'),
      icon: FileCheck,
    },
    {
      id: 'expirations',
      label: t('dashboard.kpi.expirations', 'Próx. vencimientos'),
      value: expirables.length,
      sub: t('dashboard.kpi.expirations_sub', 'EPP, exámenes, capacit.'),
      tone: expirables.length > 0 ? 'attention' : 'neutral',
      icon: Clock3,
    },
    {
      id: 'critical',
      label: t('dashboard.kpi.critical', 'Hallazgos críticos'),
      value: faenaInput.openCriticalFindings,
      sub: t('dashboard.kpi.critical_sub', 'abiertos'),
      tone: faenaInput.openCriticalFindings > 0 ? 'alert' : 'success',
      icon: AlertOctagon,
    },
  ];

  const mascotMood = guardianMood({
    emergencyActive: faenaInput.activeEmergencyIncidents > 0,
    openIncidents: faenaInput.activeEmergencyIncidents,
    pendingActions: expirables.length,
  });

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
    <div data-testid="dashboard-page" data-density={density} className="flex-1 flex flex-col justify-start gap-1 sm:gap-4 pb-20 sm:pb-4 pt-1 sm:pt-4 px-2 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full min-h-[calc(100vh-4rem)]">

      {/* Hero greeting + morning check-in trigger */}
      <DashboardHero onMorningCheckIn={() => setShowMorningCheckIn(true)} />

      {/* Guardian mascot — mood reflects real operational state */}
      <div className="flex justify-center sm:justify-end">
        <GuardianMascot mood={mascotMood} size="sm" />
      </div>

      {/* Density control */}
      <div className="flex justify-end">
        <DensityToggle />
      </div>

      {/* KPI row — real derived metrics */}
      <KpiRow items={kpiItems} density={density} />

      {/* F.2 compliance traffic light (compact). Real legal engine; renders
          only once the snapshot is computed — never a fabricated placeholder. */}
      {complianceLight && (
        <div data-testid="compliance-traffic-light" className="flex">
          <ComplianceTrafficLight result={complianceLight} variant="compact" />
        </div>
      )}

      <FaenaStateBanner input={faenaInput} />

      {lastStats && (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-1.5">
          {running ? (
            <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
          ) : (
            <span className={`inline-block h-2 w-2 rounded-full ${lastStats.failed > 0 ? 'bg-red-400' : 'bg-green-400'}`} />
          )}
          <span>
            {running
              ? t('dashboard.reconciliation.running', 'Sincronizando…')
              : t('dashboard.reconciliation.last', { defaultValue: '{{succeeded}}/{{attempted}} sincronizados', succeeded: lastStats.succeeded, attempted: lastStats.attempted })}
          </span>
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

      {roleCards.length > 0 && (
        <RoleViewCards
          role={mappedRole}
          cards={roleCards}
          onAction={(card) => {
            if (card.primaryAction?.route) {
              window.location.href = card.primaryAction.route;
            }
          }}
        />
      )}

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

      {/* SLA Watch — real corrective actions + work permits assessed for SLA compliance */}
      {slaItems.length > 0 && <SlaWatchPanel items={slaItems} hideHealthy />}

      {/* Man Down supervisor alert — only renders when events exist */}
      <ManDownSupervisorWidget />

      {/* 5. EPP context-aware (2026-06-28): UN solo widget para todos. EppSelector
          muestra la mascota + el EPP del rubro, auto-detectado del contexto del
          proyecto (faena demo para invitados; rubro real con sesión). Consolida
          el duplicado EPPRequiredWidget. */}
      <EppSelector initialRubroId={rubroIdForIndustry(selectedProject?.industry)} />

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

// perf(landing): Firebase SDK is deferred off the anonymous landing critical
// path. This file is the lazy boundary — it owns FirebaseProvider and every
// Firebase-dependent import. It is React.lazy()'d from App.tsx, so the
// vendor-firebase chunk only downloads when the user clicks "Entrar" or
// navigates to a skipLanding path (/login, /invite, /demo, etc.).
//
// App.tsx renders <LandingPage> independently (no Firebase) and only mounts
// this component once `hasEntered || skipLanding` is true.

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useState, useEffect } from 'react';
import { RootLayout } from "./components/layout/RootLayout";
import { FirebaseProvider, useFirebase } from "./contexts/FirebaseContext";
import { LanguageProvider } from "./contexts/LanguageProvider";
import { AppProviders } from "./providers/AppProviders";
import { NormativaProvider } from "./components/normativa/NormativaSwitch";
import { ConsciousnessLoader } from "./components/shared/ConsciousnessLoader";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { useAutoLogout } from "./hooks/useAutoLogout";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { EmergencyOverlay } from "./components/shared/EmergencyOverlay";
import { GeolocationTracker } from "./components/GeolocationTracker";
import { GeofenceAlert } from "./components/emergency/GeofenceAlert";
import { SosDeadLetterBanner } from "./components/emergency/SosDeadLetterBanner";
const GuardianVoiceAssistant = lazy(() => import('./components/ai/GuardianVoiceAssistant').then(m => ({ default: m.GuardianVoiceAssistant })));
const OfflineSyncManager = lazy(() => import('./components/OfflineSyncManager').then(m => ({ default: m.OfflineSyncManager })));
const SyncQueueIndicator = lazy(() => import('./components/syncStatus/SyncQueueIndicator').then(m => ({ default: m.SyncQueueIndicator })));
const SurvivalPing = lazy(() => import('./components/SurvivalPing').then(m => ({ default: m.SurvivalPing })));
const FallDetectionMonitor = lazy(() => import('./components/emergency/FallDetectionMonitor').then(m => ({ default: m.FallDetectionMonitor })));
const DrivingSuggestion = lazy(() => import('./components/driving/DrivingSuggestion').then(m => ({ default: m.DrivingSuggestion })));
const PWAUpdateToast = lazy(() => import('./components/shared/PWAUpdateToast').then(m => ({ default: m.PWAUpdateToast })));
const WisdomCapsuleWatcher = lazy(() => import('./components/shared/WisdomCapsuleWatcher').then(m => ({ default: m.WisdomCapsuleWatcher })));
const DeepLinkHandler = lazy(() => import('./components/shared/DeepLinkHandler').then(m => ({ default: m.DeepLinkHandler })));
const ConsentBanner = lazy(() => import('./components/compliance/ConsentBanner').then(m => ({ default: m.ConsentBanner })));

// Import Route Groups
import { EmergencyRoutes } from "./routes/EmergencyRoutes";
import { TrainingRoutes } from "./routes/TrainingRoutes";
import { OperationsRoutes } from "./routes/OperationsRoutes";
import { RiskRoutes } from "./routes/RiskRoutes";
import { HealthRoutes } from "./routes/HealthRoutes";
import { ComplianceRoutes } from "./routes/ComplianceRoutes";
import { AIRoutes } from "./routes/AIRoutes";

// Sprint 54 — perf: Dashboard was the last eager page import, dragging
// idb-keyval + AIInsightsModal + ComplianceModal + 22 sibling components
// into the cold-start chunk even on /login and /landing. Lazy-load it
// so the shell (root layout + providers) renders in <1s; the dashboard
// chunk only downloads when the authenticated user lands on `/`.
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));

const LandingPage = lazy(() => import('./pages/LandingPage').then(module => ({ default: module.LandingPage })));

// Other Lazy Loaded Routes
const History = lazy(() => import('./pages/History').then(module => ({ default: module.History })));
const Notifications = lazy(() => import('./pages/Notifications').then(module => ({ default: module.Notifications })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const SystemHealth = lazy(() => import('./pages/SystemHealth').then(module => ({ default: module.SystemHealth })));
const Help = lazy(() => import('./pages/Help').then(module => ({ default: module.Help })));
const PublicNodeView = lazy(() => import('./pages/PublicNodeView').then(module => ({ default: module.PublicNodeView })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Projects = lazy(() => import('./pages/Projects').then(module => ({ default: module.Projects })));
const Login = lazy(() => import('./pages/Login'));
const Splash = lazy(() => import('./pages/Splash').then(module => ({ default: module.Splash })));
const SafetyFeed = lazy(() => import('./pages/SafetyFeed').then(module => ({ default: module.SafetyFeed })));
const Analytics = lazy(() => import('./pages/Analytics').then(module => ({ default: module.Analytics })));
const CorrectiveActions = lazy(() => import('./pages/CorrectiveActions').then(module => ({ default: module.CorrectiveActions })));
// Sprint K §131-138
const ProjectClosure = lazy(() => import('./pages/ProjectClosure').then(module => ({ default: module.ProjectClosure })));
// Sprint K §195-200
const PdcaModule = lazy(() => import('./pages/PdcaModule').then(module => ({ default: module.PdcaModule })));
// Sprint K §291-295
const AnnualReview = lazy(() => import('./pages/AnnualReview').then(module => ({ default: module.AnnualReview })));
// Sprint K §296-301
const ResidualRisk = lazy(() => import('./pages/ResidualRisk').then(module => ({ default: module.ResidualRisk })));
// Sprint K §104
const DataConfidence = lazy(() => import('./pages/DataConfidence').then(module => ({ default: module.DataConfidence })));
// Sprint K §74-78
const EmergencyBrigade = lazy(() => import('./pages/EmergencyBrigade').then(module => ({ default: module.EmergencyBrigade })));
// Sprint K §214-215
const PositiveObservations = lazy(() => import('./pages/PositiveObservations').then(module => ({ default: module.PositiveObservations })));
// Sprint 42 Fase F.6
const OfflineInspection = lazy(() => import('./pages/OfflineInspection').then(module => ({ default: module.OfflineInspection })));
// §42-44
const EngineeringControls = lazy(() => import('./pages/EngineeringControls').then(module => ({ default: module.EngineeringControls })));
// Sprint K §61-63
const CulturePulse = lazy(() => import('./pages/CulturePulse').then(module => ({ default: module.CulturePulse })));
// Sprint 40 Fase F.5
const QrSignature = lazy(() => import('./pages/QrSignature').then(module => ({ default: module.QrSignature })));
// Sprint 41 Fase F.26
const MaturityIndicator = lazy(() => import('./pages/MaturityIndicator').then(module => ({ default: module.MaturityIndicator })));
// Sprint 42 Fase F.15
const WorkPermits = lazy(() => import('./pages/WorkPermits').then(module => ({ default: module.WorkPermits })));
// Sprint 40 Fase F.12
const LessonsLearned = lazy(() => import('./pages/LessonsLearned').then(module => ({ default: module.LessonsLearned })));
// Sprint 40 Fase F.13
const RepeatingRisks = lazy(() => import('./pages/RepeatingRisks').then(module => ({ default: module.RepeatingRisks })));
// Sprint 41 Fase F.20
const DrillsManager = lazy(() => import('./pages/DrillsManager').then(module => ({ default: module.DrillsManager })));
const Inbox = lazy(() => import('./pages/Inbox').then(module => ({ default: module.Inbox })));
const IncidentBundle = lazy(() => import('./pages/IncidentBundle').then(module => ({ default: module.IncidentBundle })));
// Sprint 33 wire W4
const IncidentReport = lazy(() => import('./pages/IncidentReport').then(module => ({ default: module.IncidentReport })));
// Sprint 40 Fase F.21
const PreShiftRisk = lazy(() => import('./pages/PreShiftRisk').then(module => ({ default: module.PreShiftRisk })));
// Sprint 41 Fase F.16
const WorkerReadiness = lazy(() => import('./pages/WorkerReadiness').then(module => ({ default: module.WorkerReadiness })));
// Sprint K §276-277
const LeadershipDecisions = lazy(() => import('./pages/LeadershipDecisions').then(module => ({ default: module.LeadershipDecisions })));
// Sprint K §69-71
const SafeDriving = lazy(() => import('./pages/SafeDriving').then(module => ({ default: module.SafeDriving })));
// Sprint K §211-213
const ConfidentialReports = lazy(() => import('./pages/ConfidentialReports').then(module => ({ default: module.ConfidentialReports })));
// F.29
const IncidentTrends = lazy(() => import('./pages/IncidentTrends').then(module => ({ default: module.IncidentTrends })));
// Sprint K §244-250
const Apprenticeship = lazy(() => import('./pages/Apprenticeship').then(module => ({ default: module.Apprenticeship })));
const ProjectSetup = lazy(() => import('./pages/ProjectSetup').then(module => ({ default: module.ProjectSetup })));
// Sprint 42 Fase F.18
const WorkerPortableHistory = lazy(() => import('./pages/WorkerPortableHistory').then(module => ({ default: module.WorkerPortableHistory })));
// Sprint K §90-91
const SupplierQuality = lazy(() => import('./pages/SupplierQuality').then(module => ({ default: module.SupplierQuality })));
// Sprint K §185-190
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase').then(module => ({ default: module.KnowledgeBase })));
// Sprint K §23-24
const Visitors = lazy(() => import('./pages/Visitors').then(module => ({ default: module.Visitors })));
// Sprint K §106-108
const ImportData = lazy(() => import('./pages/ImportData').then(module => ({ default: module.ImportData })));
const GoogleDriveIntegrationManager = lazy(() => import('./pages/GoogleDriveIntegrationManager').then(module => ({ default: module.GoogleDriveIntegrationManager })));
const ImmutableRender = lazy(() => import('./pages/ImmutableRender').then(module => ({ default: module.ImmutableRender })));
const WearablesIntegration = lazy(() => import('./pages/WearablesIntegration').then(module => ({ default: module.WearablesIntegration })));
const IoTEdgeFiltering = lazy(() => import('./pages/IoTEdgeFiltering').then(module => ({ default: module.IoTEdgeFiltering })));
const SSOConfig = lazy(() => import('./pages/SSOConfig').then(module => ({ default: module.SSOConfig })));
const CQRSArchitecture = lazy(() => import('./pages/CQRSArchitecture').then(module => ({ default: module.CQRSArchitecture })));
const Pricing = lazy(() => import('./pages/Pricing').then(module => ({ default: module.Pricing })));
// Sprint K §171-179
const PricingCalculator = lazy(() => import('./pages/PricingCalculator').then(module => ({ default: module.PricingCalculator })));
const PricingSimulatorPage = lazy(() => import('./pages/PricingSimulatorPage').then(module => ({ default: module.PricingSimulatorPage })));
const OcSugerida = lazy(() => import('./pages/OcSugerida').then(module => ({ default: module.OcSugerida })));
const Transparencia = lazy(() => import('./pages/Transparencia').then(module => ({ default: module.Transparencia })));
const WebXR = lazy(() => import('./pages/WebXR').then(module => ({ default: module.default })));
const SafeDrivingMode = lazy(() => import('./pages/SafeDrivingMode').then(module => ({ default: module.SafeDrivingMode })));
const Driving = lazy(() => import('./pages/Driving').then(module => ({ default: module.Driving })));
const ExecutiveDashboard = lazy(() => import('./pages/ExecutiveDashboard').then(module => ({ default: module.ExecutiveDashboard })));
const InviteAccept = lazy(() => import('./pages/InviteAccept').then(module => ({ default: module.InviteAccept })));
const RefereeAccept = lazy(() => import('./pages/RefereeAccept').then(module => ({ default: module.RefereeAccept })));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy').then(module => ({ default: module.PrivacyPolicy })));
const SunTracker = lazy(() => import('./pages/SunTracker').then(module => ({ default: module.SunTracker })));
const SafetyCoach = lazy(() => import('./pages/SafetyCoach').then(module => ({ default: module.SafetyCoach })));
const Terms = lazy(() => import('./pages/Terms').then(module => ({ default: module.Terms })));
const CuadrillasDashboard = lazy(() => import('./pages/CuadrillasDashboard').then(module => ({ default: module.CuadrillasDashboard })));
// Sprint 23 Bucket CC
const B2dAdminPanel = lazy(() => import('./pages/B2dAdminPanel').then(module => ({ default: module.B2dAdminPanel })));
// Sprint 24 Bucket MM.3
const SloErrorBudget = lazy(() => import('./pages/SloErrorBudget'));
// Sprint 23 Bucket FF
const MyData = lazy(() => import('./pages/MyData').then(module => ({ default: module.MyData })));
// Sprint 24 Bucket KK
const Onboarding = lazy(() => import('./pages/Onboarding').then(module => ({ default: module.Onboarding })));
// Sprint 24 Bucket II
const MiningContractors = lazy(() => import('./pages/MiningContractors').then(module => ({ default: module.MiningContractors })));
// Sprint 26 Bucket VV
const HealthVaultShare = lazy(() => import('./pages/HealthVaultShare').then(module => ({ default: module.HealthVaultShare })));
const HealthVaultViewer = lazy(() => import('./pages/HealthVaultViewer').then(module => ({ default: module.HealthVaultViewer })));
// Sprint 30 Bucket LL
const PublicDemo = lazy(() => import('./pages/PublicDemo').then(module => ({ default: module.PublicDemo })));
const VerificarFolio = lazy(() => import('./pages/VerificarFolio').then(module => ({ default: module.VerificarFolio })));
// Sprint 55 Fase F.14
const FindingsHeatMap = lazy(() => import('./pages/FindingsHeatMap').then(module => ({ default: module.FindingsHeatMap })));
// Sprint 55 Fase F.17
const SoftBlocks = lazy(() => import('./pages/SoftBlocks').then(module => ({ default: module.SoftBlocks })));
// Sprint 55 Fase F.24
const CustodyChain = lazy(() => import('./pages/CustodyChain').then(module => ({ default: module.CustodyChain })));
// Sprint 55 Fase F.27
const ProjectsCompare = lazy(() => import('./pages/ProjectsCompare').then(module => ({ default: module.ProjectsCompare })));
// Sprint K §139-145
const Accessibility = lazy(() => import('./pages/Accessibility').then(module => ({ default: module.Accessibility })));

// Sprint 24 Bucket KK.4 — onboarded-flag hook
import { useOnboardingStatus } from './components/onboarding/useOnboardingStatus';

// AppRoutesProps — receives hasEntered/setHasEntered from App so the landing
// early-return in AppRoutes can still set the flag when the user clicks "Entrar"
// from inside the authenticated tree (e.g. Splash). App.tsx holds the state
// so LandingPage can read it without Firebase.
interface AppRoutesInnerProps {
  hasEntered: boolean;
  setHasEntered: (v: boolean) => void;
  skipLanding: boolean;
}

function AppRoutesInner({ hasEntered, setHasEntered, skipLanding }: AppRoutesInnerProps) {
  const { user, loading } = useFirebase();
  const onboarded = useOnboardingStatus(user?.uid);

  // Initialize auto-logout for enterprise security
  useAutoLogout();

  // DEMO MODE — bypass auth for screenshot/preview purposes
  const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';
  if (isDemo) {
    return (
      <AppProviders>
        <Suspense fallback={<ConsciousnessLoader />}>
          <Routes>
            <Route path="/" element={<RootLayout />}>
              <Route index element={<Dashboard />} />
              {EmergencyRoutes}
              {TrainingRoutes}
              {OperationsRoutes}
              {RiskRoutes}
              {HealthRoutes}
              {ComplianceRoutes}
              {AIRoutes}
              <Route path="safe-driving" element={<SafeDrivingMode />} />
              <Route path="driving" element={<Driving />} />
              <Route path="settings" element={<Settings />} />
              <Route path="settings/system-health" element={<SystemHealth />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="corrective-actions" element={<CorrectiveActions />} />
              <Route path="closure" element={<ProjectClosure />} />
              <Route path="pdca" element={<PdcaModule />} />
              <Route path="annual-review" element={<AnnualReview />} />
              <Route path="residual-risk" element={<ResidualRisk />} />
              <Route path="data-confidence" element={<DataConfidence />} />
              <Route path="emergency-brigade" element={<EmergencyBrigade />} />
              <Route path="positive-observations" element={<PositiveObservations />} />
              <Route path="inspections" element={<OfflineInspection />} />
              <Route path="engineering-controls" element={<EngineeringControls />} />
              <Route path="culture-pulse" element={<CulturePulse />} />
              <Route path="qr-signature" element={<QrSignature />} />
              <Route path="maturity-index" element={<MaturityIndicator />} />
              <Route path="work-permits" element={<WorkPermits />} />
              <Route path="lessons" element={<LessonsLearned />} />
              <Route path="repeating-risks" element={<RepeatingRisks />} />
              <Route path="drills" element={<DrillsManager />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="incidents/:incidentId/bundle" element={<IncidentBundle />} />
              <Route path="incidents/report" element={<IncidentReport />} />
              <Route path="pre-shift-risk" element={<PreShiftRisk />} />
              <Route path="worker-readiness" element={<WorkerReadiness />} />
              <Route path="leadership-decisions" element={<LeadershipDecisions />} />
              <Route path="driving-safety" element={<SafeDriving />} />
              <Route path="confidential-reports" element={<ConfidentialReports />} />
              <Route path="incident-trends" element={<IncidentTrends />} />
              <Route path="apprenticeship" element={<Apprenticeship />} />
              <Route path="portable-history" element={<WorkerPortableHistory />} />
              <Route path="suppliers" element={<SupplierQuality />} />
              <Route path="knowledge-base" element={<KnowledgeBase />} />
              <Route path="visitors" element={<Visitors />} />
              <Route path="import-data" element={<ImportData />} />
              <Route path="project-setup" element={<ProjectSetup />} />
              {/* Sprint 55 — F.14/F.17/F.24/F.27 wire UI. */}
              <Route path="findings-heatmap" element={<FindingsHeatMap />} />
              <Route path="soft-blocks" element={<SoftBlocks />} />
              <Route path="custody-chain" element={<CustodyChain />} />
              <Route path="projects-compare" element={<ProjectsCompare />} />
              <Route path="accessibility" element={<Accessibility />} />
              <Route path="*" element={<Dashboard />} />
            </Route>
          </Routes>
        </Suspense>
      </AppProviders>
    );
  }

  if (loading) {
    return <ConsciousnessLoader />;
  }

  // Sprint 24 Bucket KK.4 — auto-redirect freshly-signed-up users to the
  // self-service wizard. We wait for `onboarded` to be loaded (non-null)
  // to avoid flashing /onboarding for returning users while the user
  // doc is still in-flight.
  const needsOnboarding =
    !!user && onboarded === false &&
    !window.location.pathname.startsWith('/onboarding') &&
    !window.location.pathname.startsWith('/invite') &&
    !window.location.pathname.startsWith('/login');

  if (!hasEntered && !skipLanding && !needsOnboarding) {
    // Show landing page first; after "Entrar" briefly show splash then the app.
    // Note: we arrive here only when AppRoutesInner mounts (firebase is loaded),
    // so `user` is available. For the truly anonymous first load this branch
    // is rendered by App.tsx BEFORE this component ever mounts.
    if (!user) {
      return (
        <Suspense fallback={<ConsciousnessLoader />}>
          <LandingPage onEnter={() => setHasEntered(true)} />
        </Suspense>
      );
    }
    return <Splash onEnter={() => setHasEntered(true)} />;
  }

  // Sprint 24 Bucket KK.4 — gate authenticated-but-not-onboarded users
  // before any normal routing kicks in.
  if (needsOnboarding) {
    return (
      <AppProviders>
        <Suspense fallback={<ConsciousnessLoader />}>
          <Onboarding />
        </Suspense>
      </AppProviders>
    );
  }

  return (
    <AppProviders>
      <GeolocationTracker />
      <EmergencyOverlay />
      {/* Sprint 36 audit P1 §1.4 — lazy companions; null fallback because
          they render off-screen overlays/listeners. Reduces main entry. */}
      <Suspense fallback={null}>
        <FallDetectionMonitor />
        <DrivingSuggestion />
        <WisdomCapsuleWatcher />
      </Suspense>
      <GeofenceAlert />
      <SosDeadLetterBanner />
      <Suspense fallback={<ConsciousnessLoader />}>
      <Routes>
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/" />}
        />
                  <Route path="/invite" element={<InviteAccept />} />
                  <Route path="/onboarding" element={<Onboarding />} />
                  <Route path="/curriculum/referee/:token" element={<RefereeAccept />} />
                  <Route path="/vault/share/:tokenId/:secret" element={<HealthVaultViewer />} />
                  {/* Public SUSESO folio verifier (no auth): the QR printed on
                      a DIAT/DIEP points here. A fiscalizador has no account,
                      and previously the QR opened the raw JSON API response. */}
                  <Route path="/verificar/:folio" element={<VerificarFolio />} />
                  {/* Sprint 30 Bucket LL — public demo (no auth). */}
                  <Route path="/demo" element={<PublicDemo />} />
                  <Route
                    path="/public/node/:nodeId"
                    element={<PublicNodeView />}
                  />
                  <Route path="/privacidad" element={<PrivacyPolicy />} />
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/" element={<RootLayout />}>
                    <Route index element={<Dashboard />} />

                    {/* Route Groups */}
                    {EmergencyRoutes}
                    {TrainingRoutes}
                    {OperationsRoutes}
                    {RiskRoutes}
                    {HealthRoutes}
                    {ComplianceRoutes}
                    {AIRoutes}

                    {/* Other Routes */}
                    <Route path="safe-driving" element={<SafeDrivingMode />} />
              <Route path="driving" element={<Driving />} />
                    <Route path="webxr" element={<WebXR />} />
                    <Route path="history" element={<History />} />
                    <Route path="pricing" element={<Pricing />} />
                    <Route path="pricing/success" element={<Pricing />} />
                    <Route path="pricing/failed" element={<Pricing />} />
                    <Route path="pricing/retry" element={<Pricing />} />
                    {/* Sprint K §171-179 — Pricing Calculator + OC sugerida (lazy). */}
                    <Route path="pricing-calculator" element={<PricingCalculator />} />
                    <Route path="pricing-simulator" element={<PricingSimulatorPage />} />
                    <Route path="oc-sugerida" element={<OcSugerida />} />
                    <Route path="transparencia" element={<Transparencia />} />
                    <Route path="google-drive" element={<GoogleDriveIntegrationManager />} />
                    <Route path="immutable-render" element={<ImmutableRender />} />
                    <Route path="wearables" element={<WearablesIntegration />} />
                    <Route path="iot-edge" element={<IoTEdgeFiltering />} />
                    <Route path="sso-config" element={<SSOConfig />} />
                    <Route path="cqrs-architecture" element={<CQRSArchitecture />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="settings/system-health" element={<SystemHealth />} />
                    <Route path="help" element={<Help />} />
                    <Route path="safety-feed" element={<SafetyFeed />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route path="corrective-actions" element={<CorrectiveActions />} />
                    <Route path="closure" element={<ProjectClosure />} />
                    <Route path="pdca" element={<PdcaModule />} />
                    <Route path="annual-review" element={<AnnualReview />} />
                    <Route path="residual-risk" element={<ResidualRisk />} />
                    <Route path="data-confidence" element={<DataConfidence />} />
                    <Route path="emergency-brigade" element={<EmergencyBrigade />} />
                    <Route path="positive-observations" element={<PositiveObservations />} />
                    <Route path="inspections" element={<OfflineInspection />} />
                    <Route path="engineering-controls" element={<EngineeringControls />} />
                    <Route path="culture-pulse" element={<CulturePulse />} />
                    <Route path="qr-signature" element={<QrSignature />} />
                    <Route path="maturity-index" element={<MaturityIndicator />} />
                    <Route path="work-permits" element={<WorkPermits />} />
                    <Route path="lessons" element={<LessonsLearned />} />
                    <Route path="repeating-risks" element={<RepeatingRisks />} />
                    <Route path="drills" element={<DrillsManager />} />
                    <Route path="inbox" element={<Inbox />} />
              <Route path="incidents/:incidentId/bundle" element={<IncidentBundle />} />
              <Route path="incidents/report" element={<IncidentReport />} />
              <Route path="pre-shift-risk" element={<PreShiftRisk />} />
                    <Route path="worker-readiness" element={<WorkerReadiness />} />
                    <Route path="leadership-decisions" element={<LeadershipDecisions />} />
                    <Route path="driving-safety" element={<SafeDriving />} />
                    <Route path="confidential-reports" element={<ConfidentialReports />} />
                    <Route path="incident-trends" element={<IncidentTrends />} />
                    <Route path="apprenticeship" element={<Apprenticeship />} />
                    <Route path="portable-history" element={<WorkerPortableHistory />} />
                    <Route path="suppliers" element={<SupplierQuality />} />
                    <Route path="knowledge-base" element={<KnowledgeBase />} />
                    <Route path="visitors" element={<Visitors />} />
                    <Route path="import-data" element={<ImportData />} />
                    <Route path="projects" element={<Projects />} />
                    <Route path="project-setup" element={<ProjectSetup />} />
                    {/* Sprint 55 — F.14/F.17/F.24/F.27 wire UI. */}
                    <Route path="findings-heatmap" element={<FindingsHeatMap />} />
                    <Route path="soft-blocks" element={<SoftBlocks />} />
                    <Route path="custody-chain" element={<CustodyChain />} />
                    <Route path="projects-compare" element={<ProjectsCompare />} />
                    {/* Sprint K §139-145 — Modos accesibles. */}
                    <Route path="accessibility" element={<Accessibility />} />
                    <Route path="executive-dashboard" element={<ExecutiveDashboard />} />
                    <Route path="admin/b2d" element={<B2dAdminPanel />} />
                    <Route path="admin/slo" element={<SloErrorBudget />} />
                    <Route path="my-data" element={<MyData />} />
                    <Route path="my-data/share" element={<HealthVaultShare />} />
                    <Route path="cuadrillas" element={<CuadrillasDashboard />} />
                    <Route path="mining-contractors" element={<MiningContractors />} />
                    <Route path="sun-tracker" element={<SunTracker />} />
                    <Route path="safety-coach" element={<SafetyCoach />} />
                    <Route
                      path="profile"
                      element={user ? <Profile /> : <Navigate to="/login" />}
                    />
                  </Route>
                </Routes>
              </Suspense>
              <Suspense fallback={null}>
                {user && <GuardianVoiceAssistant />}
                {user && <ConsentBanner />}
              </Suspense>
    </AppProviders>
  );
}

// AppRoutesProps — the shape App.tsx passes via React.lazy
export interface AppRoutesProps {
  hasEntered: boolean;
  setHasEntered: (v: boolean) => void;
  skipLanding: boolean;
}

/**
 * AppRoutes — full Firebase-aware routing tree.
 *
 * Owns FirebaseProvider, BrowserRouter, LanguageProvider, NormativaProvider,
 * and all Firebase-dependent hooks (useAutoLogout, useOnboardingStatus).
 * Lazy-imported by App.tsx so vendor-firebase only loads after the user
 * interacts with the landing page or navigates to a skipLanding path.
 */
export default function AppRoutes({ hasEntered, setHasEntered, skipLanding }: AppRoutesProps) {
  return (
    <FirebaseProvider>
      <LanguageProvider>
        <NormativaProvider>
          <BrowserRouter>
            <Suspense fallback={null}>
              <DeepLinkHandler />
            </Suspense>
            <OfflineIndicator />
            <Suspense fallback={null}>
              <OfflineSyncManager />
              <SyncQueueIndicator />
              <SurvivalPing />
              <PWAUpdateToast />
            </Suspense>
            <AppRoutesInner
              hasEntered={hasEntered}
              setHasEntered={setHasEntered}
              skipLanding={skipLanding}
            />
          </BrowserRouter>
        </NormativaProvider>
      </LanguageProvider>
    </FirebaseProvider>
  );
}

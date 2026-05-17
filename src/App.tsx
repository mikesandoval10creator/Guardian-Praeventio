import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useState, useEffect } from 'react';
import { initAdMob } from './services/adService';
import { preWarmHealthConnect } from './services/health/healthConnectAdapter';
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
// Sprint 36 — bundle audit P1 §1.4: heavy non-critical companions (voice
// assistant, offline sync, consent banner, fall detection, driving
// suggestion, wisdom watcher, deep-link handler, PWA toast, survival
// ping) used to be eagerly imported, dragging gemini/jspdf/firestore-
// listeners into the main entry. They are now React.lazy so the cold-
// start (Play Store / iOS critical path) only ships the shell.
// Resolves the size-limit creep: Sprint 34 bumped 340→380KB and Sprint
// 35 was about to bump 380→420KB; this code-split holds 380.
const GuardianVoiceAssistant = lazy(() => import('./components/ai/GuardianVoiceAssistant').then(m => ({ default: m.GuardianVoiceAssistant })));
const OfflineSyncManager = lazy(() => import('./components/OfflineSyncManager').then(m => ({ default: m.OfflineSyncManager })));
const SurvivalPing = lazy(() => import('./components/SurvivalPing').then(m => ({ default: m.SurvivalPing })));
const FallDetectionMonitor = lazy(() => import('./components/emergency/FallDetectionMonitor').then(m => ({ default: m.FallDetectionMonitor })));
const DrivingSuggestion = lazy(() => import('./components/driving/DrivingSuggestion').then(m => ({ default: m.DrivingSuggestion })));
const PWAUpdateToast = lazy(() => import('./components/shared/PWAUpdateToast').then(m => ({ default: m.PWAUpdateToast })));
const WisdomCapsuleWatcher = lazy(() => import('./components/shared/WisdomCapsuleWatcher').then(m => ({ default: m.WisdomCapsuleWatcher })));
const DeepLinkHandler = lazy(() => import('./components/shared/DeepLinkHandler').then(m => ({ default: m.DeepLinkHandler })));
// Sprint 23 Bucket FF — Ley 19.628 first-time consent banner.
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
const Login = lazy(() => import('./pages/Login'));
const Splash = lazy(() => import('./pages/Splash').then(module => ({ default: module.Splash })));
const SafetyFeed = lazy(() => import('./pages/SafetyFeed').then(module => ({ default: module.SafetyFeed })));
const Analytics = lazy(() => import('./pages/Analytics').then(module => ({ default: module.Analytics })));
const CorrectiveActions = lazy(() => import('./pages/CorrectiveActions').then(module => ({ default: module.CorrectiveActions })));
// Sprint K §131-138 — Cierre de Proyecto + Lecciones Transferibles +
// Decisiones Críticas + Resúmenes Multi-Rol. Cierra el ciclo completo:
// cuando un proyecto termina, NO desaparece su data — extrae lecciones
// publicables al library F.12 con scope='industry', registra decisiones
// críticas con outcome retroactivo, y genera resúmenes adaptados al rol.
const ProjectClosure = lazy(() => import('./pages/ProjectClosure').then(module => ({ default: module.ProjectClosure })));
// Sprint K §195-200 — Módulo PDCA + No Conformidades (ISO 45001 §10.2).
// Kanban Plan/Do/Check/Act sobre ciclos vinculados a NCs. El motor
// (`services/pdca/pdcaCycleEngine.ts` + `pdcaCycle.ts`) ya existía;
// este lazy cierra el wire navegable.
const PdcaModule = lazy(() => import('./pages/PdcaModule').then(module => ({ default: module.PdcaModule })));
// Sprint K §291-295 — Revisión Anual del SGI (ISO 45001 §9.3 + DS 76).
// Snapshot anual con objetivos preventivos + evidencias + conclusiones
// firmadas. Cierra el ciclo PDCA a nivel anual.
const AnnualReview = lazy(() => import('./pages/AnnualReview').then(module => ({ default: module.AnnualReview })));
// Sprint K §296-301 — Riesgo Residual + Aceptación Formal + Criticidad
// Sospechosa. ISO 31000 / ISO 45001 §6.1.2.2 — endpoint + hook + page wired.
const ResidualRisk = lazy(() => import('./pages/ResidualRisk').then(module => ({ default: module.ResidualRisk })));
// Sprint K §74-78 — Brigada de Emergencia + Recursos (extintores, AED,
// eyewash, kits, etc.). Service + panel ya existían; este wire cierra
// el end-to-end con endpoint + hook + page navegable.
const EmergencyBrigade = lazy(() => import('./pages/EmergencyBrigade').then(module => ({ default: module.EmergencyBrigade })));
// Sprint K §214-215 — Observaciones Positivas + Balance Positivo/Correctivo.
// Cierra el contrapunto cultural: las CA capturan lo que falla, las
// observaciones positivas capturan lo que vale la pena reconocer. El
// widget de balance (verde/amber/rojo) hace visible la salud cultural.
const PositiveObservations = lazy(() => import('./pages/PositiveObservations').then(module => ({ default: module.PositiveObservations })));
// Sprint 42 Fase F.6 — Modo Sin Señal para Inspecciones (offline-first daily ops).
// Distinto del SOS de emergencia: inspector/supervisor captura hallazgos
// de terreno sin conexión, sync diferido cuando vuelve la red.
const OfflineInspection = lazy(() => import('./pages/OfflineInspection').then(module => ({ default: module.OfflineInspection })));
// §42-44 — Inventario Controles de Ingeniería + Jerarquía ISO 31000.
// Service `engineeringControlsInventory` ya existía; este page wrapper
// + endpoint cierra el wire end-to-end.
const EngineeringControls = lazy(() => import('./pages/EngineeringControls').then(module => ({ default: module.EngineeringControls })));
// Sprint K §61-63 — Encuesta de Percepción + Índice de Cultura Preventiva.
// Service `safetyCulturePulse` + endpoint + hook ya existían; este lazy
// import cierra el wire end-to-end haciendo navegable el pulso de cultura.
const CulturePulse = lazy(() => import('./pages/CulturePulse').then(module => ({ default: module.CulturePulse })));
// Sprint 40 Fase F.5 — Firma QR de Recepción (EPP, charlas, docs, capacitaciones).
// Service + modal + HMAC engine ya existían; este page wire cierra el wire end-to-end.
const QrSignature = lazy(() => import('./pages/QrSignature').then(module => ({ default: module.QrSignature })));
// Sprint 41 Fase F.26 — Indicador de Madurez Preventiva (1..5).
const MaturityIndicator = lazy(() => import('./pages/MaturityIndicator').then(module => ({ default: module.MaturityIndicator })));
// Sprint 42 Fase F.15 — Centro de Permisos de Trabajo (LOTO/altura/caliente/confinado/excavación/izaje).
const WorkPermits = lazy(() => import('./pages/WorkPermits').then(module => ({ default: module.WorkPermits })));
// Sprint 40 Fase F.12 — Biblioteca de Lecciones Aprendidas (page wrapper).
// Service + adapter + endpoint + hook ya existían; este lazy import
// cierra el último eslabón haciéndola navegable.
const LessonsLearned = lazy(() => import('./pages/LessonsLearned').then(module => ({ default: module.LessonsLearned })));
// Sprint 40 Fase F.13 — Radar de Riesgos Repetidos (patrones determinísticos
// sobre incidentes, sin ML). Lazy para que el chunk solo se descargue al
// entrar a /repeating-risks.
const RepeatingRisks = lazy(() => import('./pages/RepeatingRisks').then(module => ({ default: module.RepeatingRisks })));
// Sprint 41 Fase F.20 — Gestor de Simulacros (DS 132 / DS 594).
const DrillsManager = lazy(() => import('./pages/DrillsManager').then(module => ({ default: module.DrillsManager })));
const Inbox = lazy(() => import('./pages/Inbox').then(module => ({ default: module.Inbox })));
const IncidentBundle = lazy(() => import('./pages/IncidentBundle').then(module => ({ default: module.IncidentBundle })));
// Sprint 33 wire W4 — formulario minimalista para reportar near-miss /
// incident / post-mortem desde mobile. Wire al endpoint canónico
// POST /api/incidents/report (verifyAuth + idempotencyKey + Zod).
const IncidentReport = lazy(() => import('./pages/IncidentReport').then(module => ({ default: module.IncidentReport })));
// Sprint 40 Fase F.21 — Panel de Riesgo por Turno (pre-turno). Visible
// para el supervisor antes de iniciar el turno; compone 7 fuentes
// determinísticas en un score 0-100 + recomendaciones priorizadas.
const PreShiftRisk = lazy(() => import('./pages/PreShiftRisk').then(module => ({ default: module.PreShiftRisk })));
// Sprint 41 Fase F.16 — Score de Preparación del Trabajador (asistente
// no-bloqueante). Lazy-loaded; chunked away from the cold-start shell.
const WorkerReadiness = lazy(() => import('./pages/WorkerReadiness').then(module => ({ default: module.WorkerReadiness })));
// Sprint K §276-277 — Bitácora de Decisiones de Supervisión + Ranking
// de Impacto. Liderazgo preventivo trazable (no castiga, mide).
const LeadershipDecisions = lazy(() => import('./pages/LeadershipDecisions').then(module => ({ default: module.LeadershipDecisions })));
// Sprint K §69-71 — Conducción Segura + Rutas Críticas + Alertas Ruta.
// Service `drivingSafety/drivingSafetyService` (score conductor + score
// ruta + matching) ya existía; este lazy cierra el wire end-to-end con
// endpoint + hook + page navegable.
const DrivingSafety = lazy(() => import('./pages/DrivingSafety').then(module => ({ default: module.DrivingSafety })));
// Sprint K §211-213 — Reportes Confidenciales (Ley Karin 21.643) +
// Canal de Denuncias + Detector de Represalias. Privacy-by-design:
// anónimo por defecto, hash one-way del reporter para retaliation
// detection que jamás de-anonimiza.
const ConfidentialReports = lazy(() => import('./pages/ConfidentialReports').then(module => ({ default: module.ConfidentialReports })));
// Sprint K §90-91 — Calidad de Proveedores + Ranking de Riesgo.
// Motor determinístico (supplierScoring 4-dim) ya vivía; este lazy
// expone el ranking para decisiones de adjudicación.
const SupplierQuality = lazy(() => import('./pages/SupplierQuality').then(module => ({ default: module.SupplierQuality })));
// Sprint K §185-190 — Base de Conocimiento + Curador + Detector de
// Obsolescencia. Service determinístico ya existía; este lazy import
// cierra el último eslabón haciéndola navegable desde la sidebar IA.
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase').then(module => ({ default: module.KnowledgeBase })));
// Sprint K §23-24 — Control de Visitas + Inducción Express QR. Servicio
// puro `visitorControl/visitorRegistry` + ruta server `visitors.ts`
// + esta página que cierra el wire end-to-end.
const Visitors = lazy(() => import('./pages/Visitors').then(module => ({ default: module.Visitors })));
// Sprint K §106-108 — Wizard para importar planillas Excel de PYMEs
// (trabajadores, EPP, capacitaciones, incidentes). El service
// `excelImporter` valida con Zod y deduplica; este page lo expone.
const ImportData = lazy(() => import('./pages/ImportData').then(module => ({ default: module.ImportData })));
const GoogleDriveIntegrationManager = lazy(() => import('./pages/GoogleDriveIntegrationManager').then(module => ({ default: module.GoogleDriveIntegrationManager })));
const ImmutableRender = lazy(() => import('./pages/ImmutableRender').then(module => ({ default: module.ImmutableRender })));
const WearablesIntegration = lazy(() => import('./pages/WearablesIntegration').then(module => ({ default: module.WearablesIntegration })));
const IoTEdgeFiltering = lazy(() => import('./pages/IoTEdgeFiltering').then(module => ({ default: module.IoTEdgeFiltering })));
const SSOConfig = lazy(() => import('./pages/SSOConfig').then(module => ({ default: module.SSOConfig })));
const CQRSArchitecture = lazy(() => import('./pages/CQRSArchitecture').then(module => ({ default: module.CQRSArchitecture })));
const Pricing = lazy(() => import('./pages/Pricing').then(module => ({ default: module.Pricing })));
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
// Sprint 23 Bucket CC — B2D admin panel (key management + MRR/ARR/churn).
const B2dAdminPanel = lazy(() => import('./pages/B2dAdminPanel').then(module => ({ default: module.B2dAdminPanel })));
// Sprint 23 Bucket FF — Ley 19.628 data-subject control center.
const MyData = lazy(() => import('./pages/MyData').then(module => ({ default: module.MyData })));
// Sprint 24 Bucket KK — self-service onboarding wizard.
const Onboarding = lazy(() => import('./pages/Onboarding').then(module => ({ default: module.Onboarding })));
// Sprint 24 Bucket II — DS 76 mining contractors page.
const MiningContractors = lazy(() => import('./pages/MiningContractors').then(module => ({ default: module.MiningContractors })));
// Sprint 26 Bucket VV — HealthVault QR sharing.
const HealthVaultShare = lazy(() => import('./pages/HealthVaultShare').then(module => ({ default: module.HealthVaultShare })));
const HealthVaultViewer = lazy(() => import('./pages/HealthVaultViewer').then(module => ({ default: module.HealthVaultViewer })));
// Sprint 30 Bucket LL — public Day-1 demo page (no auth wall).
const PublicDemo = lazy(() => import('./pages/PublicDemo').then(module => ({ default: module.PublicDemo })));

// Sprint 24 Bucket KK.4 — onboarded-flag hook (self-contained, does not
// touch FirebaseContext to keep that file's surface area small).
import { useOnboardingStatus } from './components/onboarding/useOnboardingStatus';

function AppRoutes() {
  const { user, loading } = useFirebase();
  const onboarded = useOnboardingStatus(user?.uid);
  const [hasEntered, setHasEntered] = useState(false);

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
              <Route path="driving-safety" element={<DrivingSafety />} />
              <Route path="confidential-reports" element={<ConfidentialReports />} />
              <Route path="suppliers" element={<SupplierQuality />} />
              <Route path="knowledge-base" element={<KnowledgeBase />} />
              <Route path="visitors" element={<Visitors />} />
              <Route path="import-data" element={<ImportData />} />
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

  // Skip landing/splash for direct deep-links (invite, public node,
  // curriculum referee co-sign — Round 14 R5).
  const skipLanding = window.location.pathname.startsWith('/invite') ||
    window.location.pathname.startsWith('/public') ||
    window.location.pathname.startsWith('/curriculum/referee') ||
    window.location.pathname.startsWith('/vault/share') ||
    window.location.pathname.startsWith('/onboarding') ||
    // Sprint 30 Bucket LL — public demo page accessible without auth.
    window.location.pathname.startsWith('/demo');

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
    // Show landing page first; after "Entrar" briefly show splash then the app
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
  // before any normal routing kicks in. We render `<Onboarding>` directly
  // (rather than `<Navigate>`) because Navigate inside the routes tree
  // would still let other route paths flicker first.
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
                    <Route path="driving-safety" element={<DrivingSafety />} />
                    <Route path="confidential-reports" element={<ConfidentialReports />} />
                    <Route path="suppliers" element={<SupplierQuality />} />
                    <Route path="knowledge-base" element={<KnowledgeBase />} />
                    <Route path="visitors" element={<Visitors />} />
                    <Route path="import-data" element={<ImportData />} />
                    <Route path="executive-dashboard" element={<ExecutiveDashboard />} />
                    <Route path="admin/b2d" element={<B2dAdminPanel />} />
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

export default function App() {
  useEffect(() => {
    initAdMob();
    // Pre-warm the Health Connect availability probe so a user tapping
    // "Connect" on the Telemetry page within ~50ms of boot doesn't race
    // the cached probe and see a false negative. Errors are swallowed
    // by `preWarmHealthConnect` (cache resolves to `NotSupported`).
    void preWarmHealthConnect();
  }, []);

  return (
    <ErrorBoundary>
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
                <SurvivalPing />
                <PWAUpdateToast />
              </Suspense>
              <AppRoutes />
            </BrowserRouter>
          </NormativaProvider>
        </LanguageProvider>
      </FirebaseProvider>
    </ErrorBoundary>
  );
}

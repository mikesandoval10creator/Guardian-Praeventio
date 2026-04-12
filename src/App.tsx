import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from 'react';
import { Dashboard } from './pages/Dashboard';
const Workers = lazy(() => import('./pages/Workers').then(module => ({ default: module.Workers })));
const History = lazy(() => import('./pages/History').then(module => ({ default: module.History })));
const Risks = lazy(() => import('./pages/Risks').then(module => ({ default: module.Risks })));
const Emergency = lazy(() => import('./pages/Emergency').then(module => ({ default: module.Emergency })));
const EmergencyGenerator = lazy(() => import('./pages/EmergencyGenerator').then(module => ({ default: module.EmergencyGenerator })));
const Matrix = lazy(() => import('./pages/Matrix').then(module => ({ default: module.Matrix })));
const Training = lazy(() => import('./pages/Training').then(module => ({ default: module.Training })));
const Normatives = lazy(() => import('./pages/Normatives').then(module => ({ default: module.Normatives })));
const Hygiene = lazy(() => import('./pages/Hygiene').then(module => ({ default: module.Hygiene })));
const Medicine = lazy(() => import('./pages/Medicine').then(module => ({ default: module.Medicine })));
const Ergonomics = lazy(() => import('./pages/Ergonomics').then(module => ({ default: module.Ergonomics })));
const Psychosocial = lazy(() => import('./pages/Psychosocial').then(module => ({ default: module.Psychosocial })));
const Notifications = lazy(() => import('./pages/Notifications').then(module => ({ default: module.Notifications })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const Help = lazy(() => import('./pages/Help').then(module => ({ default: module.Help })));
const Evacuation = lazy(() => import('./pages/Evacuation').then(module => ({ default: module.Evacuation })));
const RiskNetwork = lazy(() => import('./pages/RiskNetwork').then(module => ({ default: module.RiskNetwork })));
const Findings = lazy(() => import('./pages/Findings').then(module => ({ default: module.Findings })));
const Audits = lazy(() => import('./pages/Audits').then(module => ({ default: module.Audits })));
const Projects = lazy(() => import('./pages/Projects').then(module => ({ default: module.Projects })));
const Documents = lazy(() => import('./pages/Documents').then(module => ({ default: module.Documents })));
const DocumentViewer = lazy(() => import('./pages/DocumentViewer').then(module => ({ default: module.DocumentViewer })));
const Calendar = lazy(() => import('./pages/Calendar').then(module => ({ default: module.Calendar })));
const EPP = lazy(() => import('./pages/EPP').then(module => ({ default: module.EPP })));
const PTSGenerator = lazy(() => import('./pages/PTSGenerator').then(module => ({ default: module.PTSGenerator })));
const BioAnalysis = lazy(() => import('./pages/BioAnalysis').then(module => ({ default: module.BioAnalysis })));
const NormativeDetail = lazy(() => import('./pages/NormativeDetail').then(module => ({ default: module.NormativeDetail })));
const Assets = lazy(() => import('./pages/Assets').then(module => ({ default: module.Assets })));
const PublicNodeView = lazy(() => import('./pages/PublicNodeView').then(module => ({ default: module.PublicNodeView })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Splash = lazy(() => import('./pages/Splash').then(module => ({ default: module.Splash })));
const AIHub = lazy(() => import('./pages/AIHub').then(module => ({ default: module.AIHub })));
const ModuleHub = lazy(() => import('./pages/ModuleHub').then(module => ({ default: module.ModuleHub })));
const SafetyFeed = lazy(() => import('./pages/SafetyFeed').then(module => ({ default: module.SafetyFeed })));
const PredictiveGuard = lazy(() => import('./pages/PredictiveGuard').then(module => ({ default: module.PredictiveGuard })));
const Attendance = lazy(() => import('./pages/Attendance').then(module => ({ default: module.Attendance })));
const SafeDriving = lazy(() => import('./pages/SafeDriving').then(module => ({ default: module.SafeDriving })));
const Telemetry = lazy(() => import('./pages/Telemetry').then(module => ({ default: module.Telemetry })));
const SiteMap = lazy(() => import('./pages/SiteMap').then(module => ({ default: module.SiteMap })));
const Gamification = lazy(() => import('./pages/Gamification').then(module => ({ default: module.Gamification })));
const KnowledgeIngestion = lazy(() => import('./pages/KnowledgeIngestion').then(module => ({ default: module.KnowledgeIngestion })));
const Analytics = lazy(() => import('./pages/Analytics').then(module => ({ default: module.Analytics })));
const SusesoReports = lazy(() => import('./pages/SusesoReports').then(module => ({ default: module.SusesoReports })));
const Glossary = lazy(() => import('./pages/Glossary').then(module => ({ default: module.Glossary })));
const Diagnostico = lazy(() => import('./pages/Diagnostico').then(module => ({ default: module.Diagnostico })));
const MuralDinamico = lazy(() => import('./pages/MuralDinamico').then(module => ({ default: module.MuralDinamico })));
const DEAZones = lazy(() => import('./pages/DEAZones').then(module => ({ default: module.DEAZones })));
const InhospitableGuide = lazy(() => import('./pages/InhospitableGuide').then(module => ({ default: module.InhospitableGuide })));
const ControlsAndMaterials = lazy(() => import('./pages/ControlsAndMaterials').then(module => ({ default: module.ControlsAndMaterials })));
const AcademicProcessor = lazy(() => import('./pages/AcademicProcessor').then(module => ({ default: module.AcademicProcessor })));
const VolcanicEruptionMap = lazy(() => import('./pages/VolcanicEruptionMap').then(module => ({ default: module.VolcanicEruptionMap })));
const HazmatMap = lazy(() => import('./pages/HazmatMap').then(module => ({ default: module.HazmatMap })));
const HazmatStorage = lazy(() => import('./pages/HazmatStorage').then(module => ({ default: module.HazmatStorage })));
const SunTracker = lazy(() => import('./pages/SunTracker').then(module => ({ default: module.SunTracker })));
const MountainRefuges = lazy(() => import('./pages/MountainRefuges').then(module => ({ default: module.MountainRefuges })));
const NationalParksEmergency = lazy(() => import('./pages/NationalParksEmergency').then(module => ({ default: module.NationalParksEmergency })));
const ClimateRoutes = lazy(() => import('./pages/ClimateRoutes').then(module => ({ default: module.ClimateRoutes })));
const ArcadeGames = lazy(() => import('./pages/ArcadeGames').then(module => ({ default: module.ArcadeGames })));
const DocumentOCRManager = lazy(() => import('./pages/DocumentOCRManager').then(module => ({ default: module.DocumentOCRManager })));
const HumanBodyViewer = lazy(() => import('./pages/HumanBodyViewer').then(module => ({ default: module.HumanBodyViewer })));
const EvacuationRoutes = lazy(() => import('./pages/EvacuationRoutes').then(module => ({ default: module.EvacuationRoutes })));
const GoogleDriveIntegrationManager = lazy(() => import('./pages/GoogleDriveIntegrationManager').then(module => ({ default: module.GoogleDriveIntegrationManager })));
const SecurityShield = lazy(() => import('./pages/SecurityShield').then(module => ({ default: module.SecurityShield })));
const AuditTrail = lazy(() => import('./pages/AuditTrail').then(module => ({ default: module.AuditTrail })));
const ImmutableRender = lazy(() => import('./pages/ImmutableRender').then(module => ({ default: module.ImmutableRender })));
const AutoCADViewer = lazy(() => import('./pages/AutoCADViewer').then(module => ({ default: module.AutoCADViewer })));
const LightPollutionAudit = lazy(() => import('./pages/LightPollutionAudit').then(module => ({ default: module.LightPollutionAudit })));
const WearablesIntegration = lazy(() => import('./pages/WearablesIntegration').then(module => ({ default: module.WearablesIntegration })));
const IoTEdgeFiltering = lazy(() => import('./pages/IoTEdgeFiltering').then(module => ({ default: module.IoTEdgeFiltering })));
const ERPIntegration = lazy(() => import('./pages/ERPIntegration').then(module => ({ default: module.ERPIntegration })));
const SSOConfig = lazy(() => import('./pages/SSOConfig').then(module => ({ default: module.SSOConfig })));
const CQRSArchitecture = lazy(() => import('./pages/CQRSArchitecture').then(module => ({ default: module.CQRSArchitecture })));
const BlueprintViewer = lazy(() => import('./pages/BlueprintViewer').then(module => ({ default: module.BlueprintViewer })));
const EmergenciaAvanzada = lazy(() => import('./pages/EmergenciaAvanzada').then(module => ({ default: module.EmergenciaAvanzada })));
const CoastalEmergencyMap = lazy(() => import('./pages/CoastalEmergencyMap').then(module => ({ default: module.CoastalEmergencyMap })));
const MinsalProtocols = lazy(() => import('./pages/MinsalProtocols').then(module => ({ default: module.MinsalProtocols })));
const PortableCurriculum = lazy(() => import('./pages/PortableCurriculum').then(module => ({ default: module.PortableCurriculum })));
const ComiteParitario = lazy(() => import('./pages/ComiteParitario').then(module => ({ default: module.ComiteParitario })));
const Pricing = lazy(() => import('./pages/Pricing').then(module => ({ default: module.Pricing })));
const WebXR = lazy(() => import('./pages/WebXR').then(module => ({ default: module.default })));

import { useState, useEffect } from "react";
import { RootLayout } from "./components/layout/RootLayout";
import { GuardianVoiceAssistant } from "./components/ai/GuardianVoiceAssistant";
import { FirebaseProvider, useFirebase } from "./contexts/FirebaseContext";
import { ProjectProvider } from "./contexts/ProjectContext";
import { UniversalKnowledgeProvider } from "./contexts/UniversalKnowledgeContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { EmergencyProvider } from "./contexts/EmergencyContext";
import { SubscriptionProvider } from "./contexts/SubscriptionContext";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { useAutoLogout } from "./hooks/useAutoLogout";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { OfflineSyncManager } from "./components/OfflineSyncManager";
import { EmergencyOverlay } from "./components/shared/EmergencyOverlay";
import { GeolocationTracker } from "./components/GeolocationTracker";
import { SurvivalPing } from "./components/SurvivalPing";
import { GeofenceAlert } from "./components/emergency/GeofenceAlert";
import { FallDetectionMonitor } from "./components/emergency/FallDetectionMonitor";
import { seedGlobalData } from "./services/seedService";


function AppRoutes() {
  const { user, loading } = useFirebase();
  const [hasEntered, setHasEntered] = useState(false);

  // Initialize auto-logout for enterprise security
  useAutoLogout();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            Calibrando Conciencia...
          </span>
        </div>
      </div>
    );
  }

  if (!hasEntered) {
    return <Splash onEnter={() => setHasEntered(true)} />;
  }

  return (
    <UniversalKnowledgeProvider>
      <ProjectProvider>
        <SubscriptionProvider>
          <NotificationProvider>
            <EmergencyProvider>
              <GeolocationTracker />
              <EmergencyOverlay />
              <FallDetectionMonitor />
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Cargando Módulo...</span>
                  </div>
                </div>
              }>
              <Routes>
                <Route
                  path="/login"
                  element={!user ? <Login /> : <Navigate to="/" />}
                />
                <Route
                  path="/public/node/:nodeId"
                  element={<PublicNodeView />}
                />
                <Route path="/" element={<RootLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="evacuation" element={<Evacuation />} />
                  <Route path="emergency" element={<Emergency />} />
                  <Route
                    path="emergency-generator"
                    element={<EmergencyGenerator />}
                  />
                  <Route path="matrix" element={<Matrix />} />
                  <Route path="risks" element={<Risks />} />
                  <Route path="training" element={<Training />} />
                  <Route path="workers" element={<Workers />} />
                  <Route path="epp" element={<EPP />} />
                  <Route path="pts" element={<PTSGenerator />} />
                  <Route path="webxr" element={<WebXR />} />
                  <Route path="bio-analysis" element={<BioAnalysis />} />
                  <Route path="assets" element={<Assets />} />
                  <Route path="history" element={<History />} />
                  <Route path="normatives" element={<Normatives />} />
                  <Route path="comite-paritario" element={<ComiteParitario />} />
                  <Route path="pricing" element={<Pricing />} />
                  <Route path="normatives/:id" element={<NormativeDetail />} />
                  <Route
                    path="minsal-protocols"
                    element={<MinsalProtocols />}
                  />
                  <Route path="glossary" element={<Glossary />} />
                  <Route path="diagnostico" element={<Diagnostico />} />
                  <Route path="mural" element={<MuralDinamico />} />
                  <Route path="dea-zones" element={<DEAZones />} />
                  <Route
                    path="inhospitable-guide"
                    element={<InhospitableGuide />}
                  />
                  <Route
                    path="volcanic-eruption"
                    element={<VolcanicEruptionMap />}
                  />
                  <Route path="hazmat-map" element={<HazmatMap />} />
                  <Route path="hazmat-storage" element={<HazmatStorage />} />
                  <Route
                    path="mountain-refuges"
                    element={<MountainRefuges />}
                  />
                  <Route
                    path="national-parks"
                    element={<NationalParksEmergency />}
                  />
                  <Route path="climate-routes" element={<ClimateRoutes />} />
                  <Route path="arcade-games" element={<ArcadeGames />} />
                  <Route path="sun-tracker" element={<SunTracker />} />
                  <Route
                    path="controls-materials"
                    element={<ControlsAndMaterials />}
                  />
                  <Route
                    path="academic-processor"
                    element={<AcademicProcessor />}
                  />
                  <Route path="document-ocr" element={<DocumentOCRManager />} />
                  <Route path="human-body" element={<HumanBodyViewer />} />
                  <Route
                    path="evacuation-routes"
                    element={<EvacuationRoutes />}
                  />
                  <Route
                    path="google-drive"
                    element={<GoogleDriveIntegrationManager />}
                  />
                  <Route path="security-shield" element={<SecurityShield />} />
                  <Route path="audit-trail" element={<AuditTrail />} />
                  <Route
                    path="immutable-render"
                    element={<ImmutableRender />}
                  />
                  <Route path="autocad" element={<AutoCADViewer />} />
                  <Route
                    path="light-pollution"
                    element={<LightPollutionAudit />}
                  />
                  <Route path="wearables" element={<WearablesIntegration />} />
                  <Route path="iot-edge" element={<IoTEdgeFiltering />} />
                  <Route path="erp-integration" element={<ERPIntegration />} />
                  <Route path="sso-config" element={<SSOConfig />} />
                  <Route
                    path="cqrs-architecture"
                    element={<CQRSArchitecture />}
                  />
                  <Route
                    path="blueprint-viewer"
                    element={<BlueprintViewer />}
                  />
                  <Route
                    path="emergencia-avanzada"
                    element={<EmergenciaAvanzada />}
                  />
                  <Route
                    path="coastal-emergency"
                    element={<CoastalEmergencyMap />}
                  />
                  <Route path="hygiene" element={<Hygiene />} />
                  <Route path="medicine" element={<Medicine />} />
                  <Route path="ergonomics" element={<Ergonomics />} />
                  <Route path="psychosocial" element={<Psychosocial />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="help" element={<Help />} />
                  <Route path="risk-network" element={<RiskNetwork />} />
                  <Route path="findings" element={<Findings />} />
                  <Route path="audits" element={<Audits />} />
                  <Route path="attendance" element={<Attendance />} />
                  <Route path="safe-driving" element={<SafeDriving />} />
                  <Route path="telemetry" element={<Telemetry />} />
                  <Route path="site-map" element={<SiteMap />} />
                  <Route path="gamification" element={<Gamification />} />
                  <Route path="curriculum" element={<PortableCurriculum />} />
                  <Route path="projects" element={<Projects />} />
                  <Route path="safety-feed" element={<SafetyFeed />} />
                  <Route
                    path="predictive-guard"
                    element={<PredictiveGuard />}
                  />
                  <Route path="documents" element={<Documents />} />
                  <Route path="documents/:id" element={<DocumentViewer />} />
                  <Route path="calendar" element={<Calendar />} />
                  <Route path="hub/:id" element={<ModuleHub />} />
                  <Route path="ai-hub" element={<AIHub />} />
                  <Route path="analytics" element={<Analytics />} />
                  <Route path="suseso" element={<SusesoReports />} />
                  <Route
                    path="knowledge-ingestion"
                    element={<KnowledgeIngestion />}
                  />
                  <Route
                    path="profile"
                    element={user ? <Profile /> : <Navigate to="/login" />}
                  />
                </Route>
              </Routes>
              </Suspense>
              {user && <GuardianVoiceAssistant />}
            </EmergencyProvider>
          </NotificationProvider>
        </SubscriptionProvider>
      </ProjectProvider>
    </UniversalKnowledgeProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FirebaseProvider>
        <BrowserRouter>
          <OfflineIndicator />
          <OfflineSyncManager />
          <SurvivalPing />
          <GeofenceAlert />
          <AppRoutes />
        </BrowserRouter>
      </FirebaseProvider>
    </ErrorBoundary>
  );
}

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { RootLayout } from "./components/layout/RootLayout";
import { Dashboard } from "./pages/Dashboard";
import { Workers } from "./pages/Workers";
import { History } from "./pages/History";
import { Risks } from "./pages/Risks";
import { Emergency } from "./pages/Emergency";
import { EmergencyGenerator } from "./pages/EmergencyGenerator";
import { Matrix } from "./pages/Matrix";
import { Training } from "./pages/Training";
import { Normatives } from "./pages/Normatives";
import { Hygiene } from "./pages/Hygiene";
import { Medicine } from "./pages/Medicine";
import { Ergonomics } from "./pages/Ergonomics";
import { Psychosocial } from "./pages/Psychosocial";
import { Notifications } from "./pages/Notifications";
import { Settings } from "./pages/Settings";
import { Help } from "./pages/Help";
import { Evacuation } from "./pages/Evacuation";
import { RiskNetwork } from "./pages/RiskNetwork";
import { Findings } from "./pages/Findings";
import { Audits } from "./pages/Audits";
import { Projects } from "./pages/Projects";
import { Documents } from "./pages/Documents";
import { DocumentViewer } from "./pages/DocumentViewer";
import { Calendar } from "./pages/Calendar";
import { EPP } from "./pages/EPP";
import { PTSGenerator } from "./pages/PTSGenerator";
import { BioAnalysis } from "./pages/BioAnalysis";
import { NormativeDetail } from "./pages/NormativeDetail";
import { Assets } from "./pages/Assets";
import { PublicNodeView } from "./pages/PublicNodeView";
import { Profile } from "./pages/Profile";
import { Login } from "./pages/Login";
import { Splash } from "./pages/Splash";
import { AIHub } from "./pages/AIHub";
import { ModuleHub } from "./pages/ModuleHub";
import { SafetyFeed } from "./pages/SafetyFeed";
import { PredictiveGuard } from "./pages/PredictiveGuard";
import { Attendance } from "./pages/Attendance";
import { SafeDriving } from "./pages/SafeDriving";
import { Telemetry } from "./pages/Telemetry";
import { SiteMap } from "./pages/SiteMap";
import { Gamification } from "./pages/Gamification";
import { KnowledgeIngestion } from "./pages/KnowledgeIngestion";
import { Analytics } from "./pages/Analytics";
import { SusesoReports } from "./pages/SusesoReports";
import { Glossary } from "./pages/Glossary";
import { Diagnostico } from "./pages/Diagnostico";
import { MuralDinamico } from "./pages/MuralDinamico";
import { DEAZones } from "./pages/DEAZones";
import { InhospitableGuide } from "./pages/InhospitableGuide";
import { ControlsAndMaterials } from "./pages/ControlsAndMaterials";
import { AcademicProcessor } from "./pages/AcademicProcessor";
import { VolcanicEruptionMap } from "./pages/VolcanicEruptionMap";
import { HazmatMap } from "./pages/HazmatMap";
import { SunTracker } from "./pages/SunTracker";
import { MountainRefuges } from "./pages/MountainRefuges";
import { NationalParksEmergency } from "./pages/NationalParksEmergency";
import { ClimateRoutes } from "./pages/ClimateRoutes";
import { ArcadeGames } from "./pages/ArcadeGames";
import { DocumentOCRManager } from "./pages/DocumentOCRManager";
import { HumanBodyViewer } from "./pages/HumanBodyViewer";
import { EvacuationRoutes } from "./pages/EvacuationRoutes";
import { GoogleDriveIntegrationManager } from "./pages/GoogleDriveIntegrationManager";
import { SecurityShield } from "./pages/SecurityShield";
import { AuditTrail } from "./pages/AuditTrail";
import { ImmutableRender } from "./pages/ImmutableRender";
import { AutoCADViewer } from "./pages/AutoCADViewer";
import { LightPollutionAudit } from "./pages/LightPollutionAudit";
import { WearablesIntegration } from "./pages/WearablesIntegration";
import { IoTEdgeFiltering } from "./pages/IoTEdgeFiltering";
import { ERPIntegration } from "./pages/ERPIntegration";
import { SSOConfig } from "./pages/SSOConfig";
import { CQRSArchitecture } from "./pages/CQRSArchitecture";
import { BlueprintViewer } from "./pages/BlueprintViewer";
import { EmergenciaAvanzada } from "./pages/EmergenciaAvanzada";
import { CoastalEmergencyMap } from "./pages/CoastalEmergencyMap";
import { MinsalProtocols } from "./pages/MinsalProtocols";
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
import { seedGlobalData } from "./services/seedService";

import { PortableCurriculum } from "./pages/PortableCurriculum";
import { ComiteParitario } from "./pages/ComiteParitario";
import { Pricing } from "./pages/Pricing";

function AppRoutes() {
  const { user, loading } = useFirebase();
  const [hasEntered, setHasEntered] = useState(false);

  // Initialize auto-logout for enterprise security
  useAutoLogout();

  useEffect(() => {
    if (user) {
      seedGlobalData();
    }
  }, [user]);

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
    <SubscriptionProvider>
      <UniversalKnowledgeProvider>
        <ProjectProvider>
          <NotificationProvider>
            <EmergencyProvider>
              <GeolocationTracker />
              <EmergencyOverlay />
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
              {user && <GuardianVoiceAssistant />}
            </EmergencyProvider>
          </NotificationProvider>
        </ProjectProvider>
      </UniversalKnowledgeProvider>
    </SubscriptionProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FirebaseProvider>
        <BrowserRouter>
          <OfflineIndicator />
          <OfflineSyncManager />
          <AppRoutes />
        </BrowserRouter>
      </FirebaseProvider>
    </ErrorBoundary>
  );
}

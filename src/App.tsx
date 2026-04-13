import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useState } from 'react';
import { Dashboard } from './pages/Dashboard';
import { RootLayout } from "./components/layout/RootLayout";
import { GuardianVoiceAssistant } from "./components/ai/GuardianVoiceAssistant";
import { FirebaseProvider, useFirebase } from "./contexts/FirebaseContext";
import { ProjectProvider } from "./contexts/ProjectContext";
import { UniversalKnowledgeProvider } from "./contexts/UniversalKnowledgeContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { EmergencyProvider } from "./contexts/EmergencyContext";
import { SubscriptionProvider } from "./contexts/SubscriptionContext";
import { SensorProvider } from "./contexts/SensorContext";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { useAutoLogout } from "./hooks/useAutoLogout";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { OfflineSyncManager } from "./components/OfflineSyncManager";
import { EmergencyOverlay } from "./components/shared/EmergencyOverlay";
import { GeolocationTracker } from "./components/GeolocationTracker";
import { SurvivalPing } from "./components/SurvivalPing";
import { GeofenceAlert } from "./components/emergency/GeofenceAlert";
import { FallDetectionMonitor } from "./components/emergency/FallDetectionMonitor";
import { PWAUpdateToast } from "./components/shared/PWAUpdateToast";

// Import Route Groups
import { EmergencyRoutes } from "./routes/EmergencyRoutes";
import { TrainingRoutes } from "./routes/TrainingRoutes";
import { OperationsRoutes } from "./routes/OperationsRoutes";
import { RiskRoutes } from "./routes/RiskRoutes";
import { HealthRoutes } from "./routes/HealthRoutes";
import { ComplianceRoutes } from "./routes/ComplianceRoutes";
import { AIRoutes } from "./routes/AIRoutes";

// Other Lazy Loaded Routes
const History = lazy(() => import('./pages/History').then(module => ({ default: module.History })));
const Notifications = lazy(() => import('./pages/Notifications').then(module => ({ default: module.Notifications })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const Help = lazy(() => import('./pages/Help').then(module => ({ default: module.Help })));
const PublicNodeView = lazy(() => import('./pages/PublicNodeView').then(module => ({ default: module.PublicNodeView })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Splash = lazy(() => import('./pages/Splash').then(module => ({ default: module.Splash })));
const SafetyFeed = lazy(() => import('./pages/SafetyFeed').then(module => ({ default: module.SafetyFeed })));
const Analytics = lazy(() => import('./pages/Analytics').then(module => ({ default: module.Analytics })));
const GoogleDriveIntegrationManager = lazy(() => import('./pages/GoogleDriveIntegrationManager').then(module => ({ default: module.GoogleDriveIntegrationManager })));
const ImmutableRender = lazy(() => import('./pages/ImmutableRender').then(module => ({ default: module.ImmutableRender })));
const WearablesIntegration = lazy(() => import('./pages/WearablesIntegration').then(module => ({ default: module.WearablesIntegration })));
const IoTEdgeFiltering = lazy(() => import('./pages/IoTEdgeFiltering').then(module => ({ default: module.IoTEdgeFiltering })));
const SSOConfig = lazy(() => import('./pages/SSOConfig').then(module => ({ default: module.SSOConfig })));
const CQRSArchitecture = lazy(() => import('./pages/CQRSArchitecture').then(module => ({ default: module.CQRSArchitecture })));
const Pricing = lazy(() => import('./pages/Pricing').then(module => ({ default: module.Pricing })));
const WebXR = lazy(() => import('./pages/WebXR').then(module => ({ default: module.default })));

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
              <SensorProvider>
                <GeolocationTracker />
                <EmergencyOverlay />
                <FallDetectionMonitor />
                <GeofenceAlert />
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
                    
                    {/* Route Groups */}
                    {EmergencyRoutes}
                    {TrainingRoutes}
                    {OperationsRoutes}
                    {RiskRoutes}
                    {HealthRoutes}
                    {ComplianceRoutes}
                    {AIRoutes}

                    {/* Other Routes */}
                    <Route path="webxr" element={<WebXR />} />
                    <Route path="history" element={<History />} />
                    <Route path="pricing" element={<Pricing />} />
                    <Route path="google-drive" element={<GoogleDriveIntegrationManager />} />
                    <Route path="immutable-render" element={<ImmutableRender />} />
                    <Route path="wearables" element={<WearablesIntegration />} />
                    <Route path="iot-edge" element={<IoTEdgeFiltering />} />
                    <Route path="sso-config" element={<SSOConfig />} />
                    <Route path="cqrs-architecture" element={<CQRSArchitecture />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="help" element={<Help />} />
                    <Route path="safety-feed" element={<SafetyFeed />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route
                      path="profile"
                      element={user ? <Profile /> : <Navigate to="/login" />}
                    />
                  </Route>
                </Routes>
                </Suspense>
                {user && <GuardianVoiceAssistant />}
              </SensorProvider>
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
          <PWAUpdateToast />
          <AppRoutes />
        </BrowserRouter>
      </FirebaseProvider>
    </ErrorBoundary>
  );
}

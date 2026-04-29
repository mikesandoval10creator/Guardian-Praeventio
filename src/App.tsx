import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useState, useEffect } from 'react';
import { initAdMob } from './services/adService';
import { preWarmHealthConnect } from './services/health/healthConnectAdapter';
import { Dashboard } from './pages/Dashboard';
import { RootLayout } from "./components/layout/RootLayout";
import { GuardianVoiceAssistant } from "./components/ai/GuardianVoiceAssistant";
import { FirebaseProvider, useFirebase } from "./contexts/FirebaseContext";
import { LanguageProvider } from "./contexts/LanguageProvider";
import { AppProviders } from "./providers/AppProviders";
import { NormativaProvider } from "./components/normativa/NormativaSwitch";
import { ConsciousnessLoader } from "./components/shared/ConsciousnessLoader";
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
import { WisdomCapsuleWatcher } from "./components/shared/WisdomCapsuleWatcher";

// Import Route Groups
import { EmergencyRoutes } from "./routes/EmergencyRoutes";
import { TrainingRoutes } from "./routes/TrainingRoutes";
import { OperationsRoutes } from "./routes/OperationsRoutes";
import { RiskRoutes } from "./routes/RiskRoutes";
import { HealthRoutes } from "./routes/HealthRoutes";
import { ComplianceRoutes } from "./routes/ComplianceRoutes";
import { AIRoutes } from "./routes/AIRoutes";

const LandingPage = lazy(() => import('./pages/LandingPage').then(module => ({ default: module.LandingPage })));

// Other Lazy Loaded Routes
const History = lazy(() => import('./pages/History').then(module => ({ default: module.History })));
const Notifications = lazy(() => import('./pages/Notifications').then(module => ({ default: module.Notifications })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const Help = lazy(() => import('./pages/Help').then(module => ({ default: module.Help })));
const PublicNodeView = lazy(() => import('./pages/PublicNodeView').then(module => ({ default: module.PublicNodeView })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Login = lazy(() => import('./pages/Login'));
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
const Transparencia = lazy(() => import('./pages/Transparencia').then(module => ({ default: module.Transparencia })));
const WebXR = lazy(() => import('./pages/WebXR').then(module => ({ default: module.default })));
const SafeDrivingMode = lazy(() => import('./pages/SafeDrivingMode').then(module => ({ default: module.SafeDrivingMode })));
const ExecutiveDashboard = lazy(() => import('./pages/ExecutiveDashboard').then(module => ({ default: module.ExecutiveDashboard })));
const InviteAccept = lazy(() => import('./pages/InviteAccept').then(module => ({ default: module.InviteAccept })));
const RefereeAccept = lazy(() => import('./pages/RefereeAccept').then(module => ({ default: module.RefereeAccept })));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy').then(module => ({ default: module.PrivacyPolicy })));
const Terms = lazy(() => import('./pages/Terms').then(module => ({ default: module.Terms })));

function AppRoutes() {
  const { user, loading } = useFirebase();
  const [hasEntered, setHasEntered] = useState(false);

  // Initialize auto-logout for enterprise security
  useAutoLogout();

  if (loading) {
    return <ConsciousnessLoader />;
  }

  // Skip landing/splash for direct deep-links (invite, public node,
  // curriculum referee co-sign — Round 14 R5).
  const skipLanding = window.location.pathname.startsWith('/invite') ||
    window.location.pathname.startsWith('/public') ||
    window.location.pathname.startsWith('/curriculum/referee');

  if (!hasEntered && !skipLanding) {
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

  return (
    <AppProviders>
      <GeolocationTracker />
      <EmergencyOverlay />
      <FallDetectionMonitor />
      <GeofenceAlert />
      <WisdomCapsuleWatcher />
      <Suspense fallback={<ConsciousnessLoader />}>
      <Routes>
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/" />}
        />
                  <Route path="/invite" element={<InviteAccept />} />
                  <Route path="/curriculum/referee/:token" element={<RefereeAccept />} />
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
                    <Route path="help" element={<Help />} />
                    <Route path="safety-feed" element={<SafetyFeed />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route path="executive-dashboard" element={<ExecutiveDashboard />} />
                    <Route
                      path="profile"
                      element={user ? <Profile /> : <Navigate to="/login" />}
                    />
                  </Route>
                </Routes>
              </Suspense>
              {user && <GuardianVoiceAssistant />}
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
              <OfflineIndicator />
              <OfflineSyncManager />
              <SurvivalPing />
              <PWAUpdateToast />
              <AppRoutes />
            </BrowserRouter>
          </NormativaProvider>
        </LanguageProvider>
      </FirebaseProvider>
    </ErrorBoundary>
  );
}

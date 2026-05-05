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
import { DrivingSuggestion } from "./components/driving/DrivingSuggestion";
import { PWAUpdateToast } from "./components/shared/PWAUpdateToast";
import { WisdomCapsuleWatcher } from "./components/shared/WisdomCapsuleWatcher";
import { DeepLinkHandler } from "./components/shared/DeepLinkHandler";
// Sprint 23 Bucket FF — Ley 19.628 first-time consent banner.
import { ConsentBanner } from "./components/compliance/ConsentBanner";

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
              <Route path="analytics" element={<Analytics />} />
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
    window.location.pathname.startsWith('/onboarding');

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
      <FallDetectionMonitor />
      <DrivingSuggestion />
      <GeofenceAlert />
      <WisdomCapsuleWatcher />
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
                    <Route path="help" element={<Help />} />
                    <Route path="safety-feed" element={<SafetyFeed />} />
                    <Route path="analytics" element={<Analytics />} />
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
              {user && <GuardianVoiceAssistant />}
              {user && <ConsentBanner />}
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
              <DeepLinkHandler />
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

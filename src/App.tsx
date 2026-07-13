// perf(landing): App.tsx is now the thin anonymous shell.
//
// Firebase SDK (vendor-firebase ~120KB gzip) is NO LONGER on the critical path
// for the anonymous landing page. The full routing tree — including
// FirebaseProvider — lives in `./AppRoutes` which is lazy-loaded via
// React.lazy(). Firebase only downloads when:
//   • The user clicks "Entrar" on the landing page  (hasEntered → true)
//   • The URL is a skipLanding path (/login, /invite, /demo, …)
//   • E2E mode with a fixture user (isE2EMode() && hasE2EUserFixture())
//
// This mirrors the Sprint-54 Dashboard de-eager pattern (App.tsx:55 at the
// time). The vendor-firebase manualChunk in vite.config.ts is unchanged; it
// now only loads as a dependency of the lazy AppRoutes chunk.

import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { initAdMob } from './services/adService';
import { preWarmHealthConnect } from './services/health/healthConnectAdapter';
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { ConsciousnessLoader } from "./components/shared/ConsciousnessLoader";
// §2.19 fix (2026-05-21) — detectar fixture E2E inyectado para saltar
// Landing/Splash sin tocar UX de usuarios reales anónimos.
// NOTE: isE2EMode/hasE2EUserFixture only use import.meta.env and localStorage;
// they do NOT import services/firebase — safe to keep in this thin shell.
import { isE2EMode, hasE2EUserFixture } from './lib/e2eAuth';

// Anonymous-only landing: no Firebase dependency.
const LandingPage = lazy(() => import('./pages/LandingPage').then(module => ({ default: module.LandingPage })));

// Firebase-bearing routing tree — only loads after landing is bypassed.
// AppRoutes owns FirebaseProvider, BrowserRouter, LanguageProvider,
// NormativaProvider, useAutoLogout, useOnboardingStatus, and every page.
const AppRoutes = lazy(() => import('./AppRoutes'));

/**
 * Compute the skipLanding flag from the current URL.
 *
 * Mirrors the same list that was in AppRoutes (formerly at App.tsx:354-375).
 * Kept as a pure function (no hooks) so it's safe to call from useState
 * and from the render body.
 */
function computeSkipLanding(): boolean {
  return (
    window.location.pathname.startsWith('/invite') ||
    window.location.pathname.startsWith('/public') ||
    window.location.pathname.startsWith('/curriculum/referee') ||
    window.location.pathname.startsWith('/vault/share') ||
    window.location.pathname.startsWith('/onboarding') ||
    // §2.19 fix (2026-05-21) — `/login` ya no debe pasar por Landing.
    window.location.pathname.startsWith('/login') ||
    // UX mejora (2026-05-21) — visitantes anónimos a páginas públicas
    // específicas saltan Landing y van directo a su destino.
    window.location.pathname.startsWith('/pricing') ||
    window.location.pathname.startsWith('/help') ||
    window.location.pathname.startsWith('/privacy') ||
    window.location.pathname.startsWith('/terms') ||
    // Sprint 30 Bucket LL — public demo page accessible without auth.
    window.location.pathname.startsWith('/demo')
  );
}

export default function App() {
  // §2.19 fix — auto-hasEntered when running in MODE=test with E2E fixture.
  // Production never enters this path (gated by import.meta.env.MODE === 'test').
  const [hasEntered, setHasEntered] = useState<boolean>(
    () => isE2EMode() && hasE2EUserFixture(),
  );

  // Compute once on mount; URL won't change during the landing render.
  const skipLanding = computeSkipLanding();

  useEffect(() => {
    initAdMob();
    // Pre-warm the Health Connect availability probe so a user tapping
    // "Connect" on the Telemetry page within ~50ms of boot doesn't race
    // the cached probe and see a false negative. Errors are swallowed
    // by `preWarmHealthConnect` (cache resolves to `NotSupported`).
    void preWarmHealthConnect();
  }, []);

  // ANONYMOUS LANDING — no Firebase.
  // Rendered only when: user has not entered AND path is not a skipLanding
  // route AND we're not in E2E-with-fixture mode (hasEntered already true).
  // BrowserRouter is required by LandingPage (uses useNavigate).
  // NOTE: AppRoutes also wraps BrowserRouter — but this branch returns before
  // AppRoutes mounts, so there is no double-wrapping at runtime.
  if (!hasEntered && !skipLanding) {
    return (
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={<ConsciousnessLoader />}>
            <LandingPage onEnter={() => setHasEntered(true)} />
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    );
  }

  // FIREBASE-BEARING TREE — loads vendor-firebase on demand.
  // AppRoutes owns its own BrowserRouter + FirebaseProvider + LanguageProvider
  // + NormativaProvider + all authenticated routing.
  return (
    <ErrorBoundary>
      <Suspense fallback={<ConsciousnessLoader />}>
        <AppRoutes
          hasEntered={hasEntered}
          setHasEntered={setHasEntered}
          skipLanding={skipLanding}
        />
      </Suspense>
    </ErrorBoundary>
  );
}

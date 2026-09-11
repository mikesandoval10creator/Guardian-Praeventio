/**
 * Routes that must load the Firebase/native routing tree instead of the
 * anonymous marketing landing. This is especially important for Android cold
 * starts: an App Link or notification can open a life-safety destination
 * before React has mounted any authenticated shell.
 */
const LANDING_BYPASS_PREFIXES = [
  '/invite',
  '/public',
  '/curriculum/referee',
  '/vault/share',
  '/onboarding',
  '/login',
  '/pricing',
  '/help',
  '/privacy',
  '/terms',
  '/demo',
  '/verificar',
  // Critical native destinations. Push links normally carry source=push, but
  // Android App Links and a user reopening a saved URL may not.
  '/emergency',
  '/emergencia-avanzada',
  '/hub/emergencies',
  '/evacuation',
  '/evacuation-routes',
  '/evacuation-dashboard',
  '/lone-worker',
  '/worker-readiness',
  '/notifications',
  '/dashboard',
  '/first-responder-map',
] as const;

/**
 * Pure URL policy so the cold-start contract is testable without mounting the
 * Firebase tree. The root path remains the real Plano Vivo LandingPage.
 */
export function shouldSkipLanding(pathname: string, search = ''): boolean {
  if (search.includes('source=push')) return true;
  return LANDING_BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Global/window augmentation (Sprint 49 - E.5 P2 H19).
 *
 * Centralizes the shape of properties bolted onto `globalThis`/`window` by
 * third-party SDKs (Capacitor, AdSense) and Praeventio runtime tokens
 * (__GP_TENANT_ID__, __SLM_OFFLINE_ENABLED__), so consumers can drop
 * `(window as any).Capacitor`-style casts in favour of typed access.
 *
 * Browser-only globals (AudioContext, SpeechRecognition, DeviceMotionEvent,
 * requestIdleCallback) live on Window. Test-fixture overrides (fetch,
 * ResizeObserver, Event, document, crypto on globalThis) are covered via
 * the index signature so vitest mocks keep compiling.
 */
export {};

// Minimal Capacitor surface we actually touch from the web layer.
interface PraeventioCapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
}

declare global {
  interface Window {
    // Capacitor injects itself when the app boots inside a native shell.
    Capacitor?: PraeventioCapacitorBridge;

    // Praeventio runtime tokens (set by bootstrap script in index.html or
    // by the auth flow once tenant is known).
    __GP_TENANT_ID__?: string;

    // Vendor-prefixed Web Audio fallback used by NoiseMonitor / FirstAidCards.
    webkitAudioContext?: typeof AudioContext;

    // Vendor-prefixed SpeechRecognition (Chrome ships only the prefixed one).
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;

    // Sensor APIs that are still TS-DOM-lib opt-in.
    DeviceMotionEvent?: typeof Event & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    // Google AdSense queue.
    adsbygoogle?: unknown[];

    // requestIdleCallback is in lib.dom but mistyped in some setups.
    requestIdleCallback?: (
      cb: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void,
      opts?: { timeout?: number },
    ) => number;
  }

  // SLM offline rollout flag (set by feature-flag bootstrap).
   
  var __SLM_OFFLINE_ENABLED__: boolean | undefined;
}

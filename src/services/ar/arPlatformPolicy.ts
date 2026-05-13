// Praeventio Guard — Sprint 48 E.1 (cierre): AR platform policy + scene orchestrator.
//
// Cierra E.1 del plan maestro. Componentes:
//   - arPlatformPolicy: decide qué tecnología AR usar (Android WebXR vs
//     iOS Quick Look vs fallback 2D overlay)
//   - arSceneOrchestrator (archivo separado): dado posición del usuario
//     + grafo de riesgos, decide qué markers proyectar
//
// 100% determinístico. No mockea navegador — caller pasa "capabilities"
// snapshot (de useWebXRSupport hook + UA detection).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ArMode =
  | 'webxr_immersive_ar' // Android Chrome 79+ con immersive-ar + hit-test
  | 'arkit_quick_look'   // iOS Safari con AR Quick Look (USDZ link)
  | 'fallback_2d'        // sin XR — overlay 2D sobre cámara
  | 'unsupported';       // no se puede AR aquí (desktop sin webcam, etc.)

export interface ArPlatformCapabilities {
  /** UA reporta iOS Safari (incluido iOS Chrome/Firefox que reusan WebKit). */
  isIos: boolean;
  /** UA reporta Android. */
  isAndroid: boolean;
  /** `navigator.xr` existe. */
  hasXrApi: boolean;
  /** `xr.isSessionSupported('immersive-ar')` resolvió true. */
  supportsImmersiveAr: boolean;
  /** `hit-test` feature OK (asume true si supportsImmersiveAr). */
  hasHitTest: boolean;
  /** Cámara disponible (getUserMedia). */
  hasCamera: boolean;
  /** Si el dispositivo es móvil (mobile screen + touch). */
  isMobile: boolean;
}

export interface ArModeDecision {
  mode: ArMode;
  /** Razón por la que se eligió ese modo (audit/debug). */
  rationale: string;
  /** Si la app debe ofrecer un toggle a otro modo manualmente. */
  allowsFallback: boolean;
  /** Features que el modo elegido habilita. */
  features: {
    hitTest: boolean;
    anchors: boolean;
    domOverlay: boolean;
    /** Si los markers pueden persistir entre sesiones (anchors). */
    persistentAnchors: boolean;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Decision logic
// ────────────────────────────────────────────────────────────────────────

export function decideArMode(caps: ArPlatformCapabilities): ArModeDecision {
  // Apple ecosystem → Quick Look (Apple no implementa WebXR sobre WebKit)
  if (caps.isIos) {
    return {
      mode: 'arkit_quick_look',
      rationale:
        'iOS Safari no soporta WebXR (Apple promueve AR Quick Look). USDZ link estándar.',
      allowsFallback: caps.hasCamera,
      features: {
        hitTest: true, // ARKit lo hace nativo
        anchors: true,
        domOverlay: false, // Quick Look es full-screen native
        persistentAnchors: false, // Quick Look es session-only
      },
    };
  }

  // Android Chrome 79+ con WebXR
  if (caps.isAndroid && caps.hasXrApi && caps.supportsImmersiveAr) {
    return {
      mode: 'webxr_immersive_ar',
      rationale: 'Android + navigator.xr + immersive-ar disponible.',
      allowsFallback: caps.hasCamera,
      features: {
        hitTest: caps.hasHitTest,
        anchors: true,
        domOverlay: true,
        persistentAnchors: true,
      },
    };
  }

  // Móvil con cámara pero sin WebXR → fallback 2D overlay
  if (caps.isMobile && caps.hasCamera) {
    return {
      mode: 'fallback_2d',
      rationale:
        'Móvil sin WebXR — overlay 2D sobre cámara con getUserMedia.',
      allowsFallback: false,
      features: {
        hitTest: false,
        anchors: false,
        domOverlay: true,
        persistentAnchors: false,
      },
    };
  }

  // Desktop sin cámara → no AR
  return {
    mode: 'unsupported',
    rationale: 'Dispositivo sin cámara o no-móvil — AR no aplicable.',
    allowsFallback: false,
    features: {
      hitTest: false,
      anchors: false,
      domOverlay: false,
      persistentAnchors: false,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// UA parser helper — caller normaliza window.navigator.userAgent
// ────────────────────────────────────────────────────────────────────────

export function parsePlatformFromUserAgent(ua: string): {
  isIos: boolean;
  isAndroid: boolean;
  isMobile: boolean;
} {
  const lower = ua.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(lower) ||
    // iPadOS 13+ reporta como Mac — distinguir por touch
    (/macintosh/.test(lower) && /touch|safari\/(15|16|17|18)/.test(lower) && /mobile/.test(lower));
  const isAndroid = /android/.test(lower);
  const isMobile = isIos || isAndroid || /mobile|phone|tablet/.test(lower);
  return { isIos, isAndroid, isMobile };
}

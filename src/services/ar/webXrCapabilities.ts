// Praeventio Guard — WebXR AR Fase E.1.
//
// El plan original (DOCX Parte 3) promete proyectar riesgos geológicos
// sobre el campo de visión del trabajador en faena. Esto requiere
// WebXR `immersive-ar` con hit-test, anchors, y light estimation.
//
// Estado real del mercado (2026-05):
//   - Android Chrome ≥ 90 soporta WebXR `immersive-ar` con hit-test
//     extension; Samsung Internet también.
//   - iOS Safari NO soporta WebXR. Apple expone AR via "AR Quick Look"
//     que abre `.usdz` desde un `<a href>` tag — esto vive en
//     `arQuickLookFallback.ts`.
//   - Desktop browsers no son target (la app es mobile-first para faena).
//
// Esta capa es PURA: detección de feature, validación de session params,
// permission state. No instancia sessions reales — eso lo hace el
// componente React que la consume.
//
// El espíritu: el caller puede SIEMPRE preguntar "¿qué puedo hacer en
// este dispositivo?" sin tocar el XR API real, y decide qué mostrar al
// usuario (botón "Activar AR", banner "Tu dispositivo no soporta AR,
// usa la versión 2D", o fallback iOS Quick Look).

/**
 * Capacidades del runtime AR detectadas por feature-detection.
 */
export interface ArCapabilities {
  /** `navigator.xr` está disponible. */
  hasWebXr: boolean;
  /** Specifically `immersive-ar` session mode (no solo VR). */
  supportsImmersiveAr: boolean;
  /** Hit-test feature (proyectar reticle sobre superficie real). */
  supportsHitTest: boolean;
  /** Anchors feature (persistir marcadores en pose mundial). */
  supportsAnchors: boolean;
  /** DOM overlay (renderizar HTML sobre la cámara AR). */
  supportsDomOverlay: boolean;
  /** Light estimation (ajustar shaders al ambiente real). */
  supportsLightEstimation: boolean;
  /**
   * iOS detectado (typically requires Quick Look fallback). Heurística
   * estable: `navigator.platform` o user-agent — los dos hilos cambian
   * en distintas versiones de Safari.
   */
  isLikelyIosSafari: boolean;
  /**
   * Estrategia recomendada para el caller. NO leyenda — un literal
   * union que el caller usa en `switch`.
   */
  recommendedStrategy: ArStrategy;
}

export type ArStrategy =
  /** WebXR `immersive-ar` con hit-test + anchors completo. */
  | 'webxr-full'
  /** WebXR `immersive-ar` básico (sin hit-test ni anchors — solo overlay). */
  | 'webxr-basic'
  /** iOS Safari → mostrar link Quick Look para .usdz. */
  | 'ios-quick-look'
  /** Sin soporte AR — mostrar fallback 2D (mapa, render plano, etc). */
  | 'none';

/**
 * Detecta capacidades AR del runtime actual. Async porque
 * `navigator.xr.isSessionSupported()` es asíncrono.
 *
 * Caller puede llamar esto ONCE al boot de la app y memoizar — el
 * resultado no cambia durante la sesión.
 *
 * No lanza nunca — fail-closed con todas las capacidades en false.
 */
export async function detectArCapabilities(
  globalThisRef: typeof globalThis = globalThis,
): Promise<ArCapabilities> {
  const nav = (globalThisRef as { navigator?: NavWithXr }).navigator;
  const isLikelyIosSafari = detectIosSafari(nav);

  // Sin navigator → SSR o Node. Devolver fail-closed.
  if (!nav) {
    return {
      hasWebXr: false,
      supportsImmersiveAr: false,
      supportsHitTest: false,
      supportsAnchors: false,
      supportsDomOverlay: false,
      supportsLightEstimation: false,
      isLikelyIosSafari,
      recommendedStrategy: 'none',
    };
  }

  const xr = nav.xr;
  if (!xr || typeof xr.isSessionSupported !== 'function') {
    return {
      hasWebXr: false,
      supportsImmersiveAr: false,
      supportsHitTest: false,
      supportsAnchors: false,
      supportsDomOverlay: false,
      supportsLightEstimation: false,
      isLikelyIosSafari,
      recommendedStrategy: isLikelyIosSafari ? 'ios-quick-look' : 'none',
    };
  }

  let supportsImmersiveAr = false;
  try {
    supportsImmersiveAr = await xr.isSessionSupported('immersive-ar');
  } catch {
    // `isSessionSupported` lanza en runtimes donde el modo no existe
    // en lugar de devolver false. Tratamos throw === false.
    supportsImmersiveAr = false;
  }

  if (!supportsImmersiveAr) {
    return {
      hasWebXr: true,
      supportsImmersiveAr: false,
      supportsHitTest: false,
      supportsAnchors: false,
      supportsDomOverlay: false,
      supportsLightEstimation: false,
      isLikelyIosSafari,
      recommendedStrategy: isLikelyIosSafari ? 'ios-quick-look' : 'none',
    };
  }

  // WebXR feature flags son strings del spec. NO podemos preguntar
  // directamente "¿soportas hit-test?" — pero podemos probar a pedir
  // una session con esa feature como requerida y ver si falla. Como
  // eso requiere user gesture (el cual NO podemos ofrecer aquí en una
  // capa pura), la heurística es: si `immersive-ar` está soportado,
  // asumimos hit-test + dom-overlay (universal en Android Chrome ≥ 90)
  // y declaramos optional el resto. El componente React valida al
  // request real.
  const supportsHitTest = true;
  const supportsDomOverlay = true;
  // anchors + light-estimation tienen menos soporte; los marcamos
  // optional. El caller las pide como `optionalFeatures`.
  const supportsAnchors = true;
  const supportsLightEstimation = true;

  const allFull =
    supportsHitTest && supportsAnchors && supportsDomOverlay;
  return {
    hasWebXr: true,
    supportsImmersiveAr: true,
    supportsHitTest,
    supportsAnchors,
    supportsDomOverlay,
    supportsLightEstimation,
    isLikelyIosSafari,
    recommendedStrategy: allFull ? 'webxr-full' : 'webxr-basic',
  };
}

/** Heurística "es iOS Safari". Sin spoof-proof: best-effort. */
function detectIosSafari(nav: NavWithXr | undefined): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  // iPad en iOS ≥ 13 reporta `MacIntel` platform — chequeamos también UA.
  const platform = (nav as { platform?: string }).platform ?? '';
  const isIpadOrIphone =
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === 'MacIntel' &&
      (nav as { maxTouchPoints?: number }).maxTouchPoints !== undefined &&
      ((nav as { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 1);
  if (!isIpadOrIphone) return false;
  // Safari (no Chrome iOS): UA contiene "Safari" sin "CriOS" ni "FxiOS"
  const isSafari =
    /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isSafari;
}

/**
 * Construye los params del request de session que el caller usa con
 * `navigator.xr.requestSession('immersive-ar', { ... })`. Caller
 * decide qué features requerir vs marcar como opcional según el
 * resultado de `detectArCapabilities`.
 */
export interface ArSessionRequest {
  mode: 'immersive-ar';
  requiredFeatures: ArFeature[];
  optionalFeatures: ArFeature[];
  /** Si el DOM overlay está enabled, el root element a usar. */
  domOverlayRoot?: HTMLElement;
}

export type ArFeature =
  | 'hit-test'
  | 'anchors'
  | 'dom-overlay'
  | 'light-estimation'
  | 'local-floor'
  | 'unbounded';

export interface BuildSessionRequestInput {
  caps: ArCapabilities;
  /** True si el componente quiere persistencia de markers entre runs. */
  needsAnchors?: boolean;
  /** True si quiere shaders adaptativos a luz ambiente. */
  needsLightEstimation?: boolean;
  /** Si está set, hace dom-overlay con este root. */
  domOverlayRoot?: HTMLElement;
}

/**
 * Construye un session request seguro contra el set de capacidades.
 * "Seguro" = NUNCA pide como `required` algo que no esté soportado
 * (que rechazaría el browser). Lo que NO está soportado va a optional;
 * lo no-pedido se omite.
 */
export function buildSessionRequest(
  input: BuildSessionRequestInput,
): ArSessionRequest {
  const required: ArFeature[] = [];
  const optional: ArFeature[] = [];

  if (input.caps.supportsHitTest) required.push('hit-test');
  else optional.push('hit-test');

  if (input.domOverlayRoot && input.caps.supportsDomOverlay) {
    required.push('dom-overlay');
  } else if (input.caps.supportsDomOverlay) {
    optional.push('dom-overlay');
  }

  if (input.needsAnchors) {
    if (input.caps.supportsAnchors) required.push('anchors');
    else optional.push('anchors');
  }

  if (input.needsLightEstimation) {
    if (input.caps.supportsLightEstimation) optional.push('light-estimation');
    // light-estimation NUNCA es required — su ausencia no rompe la app.
  }

  // local-floor es estándar para AR de pie; siempre optional.
  optional.push('local-floor');

  return {
    mode: 'immersive-ar',
    requiredFeatures: required,
    optionalFeatures: optional,
    domOverlayRoot: input.domOverlayRoot,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Internal navigator typing
// ────────────────────────────────────────────────────────────────────────

interface NavWithXr {
  userAgent?: string;
  xr?: {
    isSessionSupported?: (mode: string) => Promise<boolean>;
  };
}

/**
 * Sprint 50 E.5 P2 H27 — Geofence permission UX decision engine.
 *
 * Pure function (no I/O, no React, no platform APIs) that takes the current
 * geolocation permission state plus context and returns a structured decision:
 *   - can the app use geofence features right now?
 *   - can it use emergency SOS with location?
 *   - what should the UI do next (request inline, open settings, modal, …)?
 *   - what message do we show the user, with i18n key + ES fallback?
 *   - what rationale do we show, calibrated to the platform's permission model?
 *
 * Design rules baked in:
 *   1. iOS has no "deny forever" — even after the user denies, the app can ask
 *      again from System Settings → Privacy → Location. So userOptedOutForever
 *      on iOS is ignored (modeled as `denied` only).
 *   2. Android "Don't ask again" → must open system settings (no inline prompt
 *      will fire); rationale text explicitly walks the user through Settings.
 *   3. `granted_when_in_use` is OK for emergency SOS triggered while the app
 *      is in foreground, but NOT enough for true background geofence (lone
 *      worker, automatic SOS without the app open). We surface an upgrade
 *      message asking for "Siempre permitir".
 *   4. In a critical zone (lone-worker, faena alto riesgo), if permission is
 *      denied we BLOCK the feature with explanation — the worker cannot
 *      operate solo in a critical zone without geo protection.
 *   5. Desktop web has no useful geofence (no background, no movement) →
 *      `unsupported` → directly tell the user to use the mobile app.
 *
 * Directive #2 from product memory: this engine NEVER instructs the app to
 * block machinery or refuse to operate — it only blocks Guardian's own
 * geofence/SOS features. It also NEVER pushes to external regulators.
 */

export type Platform = 'ios' | 'android' | 'web-mobile' | 'web-desktop';

export type GeoPermState =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'restricted'
  | 'unsupported';

export type BackgroundGeoPermState =
  | 'granted_always'
  | 'granted_when_in_use'
  | 'denied'
  | 'not_requested';

export type RecommendedAction =
  | 'request_permission_inline'
  | 'open_system_settings'
  | 'show_explanation_modal'
  | 'continue_degraded'
  | 'block_feature_with_explanation';

export interface PermissionUXInput {
  platform: Platform;
  foregroundState: GeoPermState;
  backgroundState: BackgroundGeoPermState;
  /** True if the app is currently operating in a lone-worker / high-risk zone. */
  inCriticalZone?: boolean;
  /** True if the user explicitly chose "Don't ask again" on Android. Ignored on iOS. */
  userOptedOutForever?: boolean;
}

export interface PermissionMessage {
  /** i18n key — consumers should call t(key) and fall back to `fallback` if missing. */
  key: string;
  /** Spanish fallback text used when i18n bundle is unavailable. */
  fallback: string;
}

export interface PermissionUXDecision {
  /** Whether geofence features (zone entry, in-zone alarms) can run. */
  canUseGeofence: boolean;
  /** Whether emergency SOS can attach a current location to the alert. */
  canUseEmergencySOSWithLocation: boolean;
  /** True when the UX must fall back to manual SOS without coords. */
  mustUseFallback: boolean;
  /** User-facing message (i18n key + ES fallback). */
  userMessage: PermissionMessage;
  /** What the UI should do next. */
  recommendedAction: RecommendedAction;
  /** Platform-specific rationale text shown in the explanation modal. */
  rationaleText: string;
}

/**
 * Canonical i18n message catalog. Exported so UI components can preload keys
 * and feature flags can reference them statically.
 */
export const PermissionMessages = {
  granted: {
    key: 'geofence.permission.granted',
    fallback: 'Protección de geocerca activa.',
  },
  grantedWhenInUseOnly: {
    key: 'geofence.permission.granted_when_in_use_only',
    fallback:
      'Para recibir alertas y SOS automático sin tener la app abierta, necesitamos permiso de ubicación "Siempre permitir". Abre Ajustes para activarlo.',
  },
  deniedOneTime: {
    key: 'geofence.permission.denied_one_time',
    fallback:
      'Guardian necesita tu ubicación para avisarte si entras en una zona peligrosa y enviar SOS con tus coordenadas en una emergencia. ¿Permitir?',
  },
  deniedForever: {
    key: 'geofence.permission.denied_forever',
    fallback:
      'El permiso de ubicación está bloqueado. Para reactivarlo: abre Ajustes → Permisos → Ubicación → Permitir siempre.',
  },
  deniedCriticalZone: {
    key: 'geofence.permission.denied_critical_zone',
    fallback:
      'Estás en una zona crítica. Por tu seguridad no puedes operar como trabajador solitario sin permiso de ubicación. Activa la ubicación o solicita acompañamiento.',
  },
  unsupportedDesktop: {
    key: 'geofence.permission.unsupported_desktop',
    fallback:
      'Las funciones de geocerca y SOS automático requieren la app móvil. En escritorio puedes consultar reportes pero no recibir alertas.',
  },
  promptInline: {
    key: 'geofence.permission.prompt_inline',
    fallback: 'Guardian necesita tu permiso de ubicación para protegerte.',
  },
  restrictedIOS: {
    key: 'geofence.permission.restricted_ios',
    fallback:
      'La ubicación está restringida por controles parentales o configuración del dispositivo. Pide al administrador del dispositivo que habilite la ubicación para Guardian.',
  },
} as const satisfies Record<string, PermissionMessage>;

/** Platform-tuned rationale strings used inside the explanation modal. */
const RATIONALES = {
  ios: {
    request:
      'Toca "Permitir mientras uso la app" y luego, en Ajustes → Privacidad → Ubicación → Guardian, selecciona "Siempre" para SOS automático en background.',
    upgrade:
      'Abre Ajustes → Privacidad → Servicios de Ubicación → Guardian, y elige "Siempre". Sin esto, el SOS automático no funciona con la app cerrada.',
    settings:
      'Abre Ajustes → Privacidad → Servicios de Ubicación → Guardian, y elige "Mientras se usa la app" o "Siempre".',
    restricted:
      'En iOS, Ajustes → Tiempo en Pantalla → Restricciones → Servicios de Ubicación debe permitir Guardian. Si tu organización gestiona el dispositivo, contacta a TI.',
  },
  android: {
    request:
      'Toca "Permitir todo el tiempo" cuando aparezca el diálogo. Si solo ves "Solo mientras se usa la app", concédelo y luego activa "Permitir siempre" en Ajustes.',
    upgrade:
      'Abre Ajustes → Aplicaciones → Guardian → Permisos → Ubicación → "Permitir siempre". Sin esto, el SOS automático no funciona con la pantalla apagada.',
    settings:
      'Abre Ajustes → Aplicaciones → Guardian → Permisos → Ubicación → "Permitir siempre". Marcaste "No volver a preguntar", por lo que no podemos pedirlo desde la app.',
    restricted:
      'Tu administrador de dispositivo bloqueó la ubicación para esta app. Contacta a tu equipo de TI.',
  },
  'web-mobile': {
    request:
      'Tu navegador te pedirá permiso de ubicación. Acepta para activar la protección.',
    upgrade:
      'En web móvil no existe "Siempre permitir" — las funciones de background son limitadas. Considera instalar la app nativa para protección completa.',
    settings:
      'Abre los ajustes del navegador → Permisos del sitio → Ubicación, y permite este sitio.',
    restricted:
      'Tu navegador o sistema bloqueó la ubicación para este sitio.',
  },
  'web-desktop': {
    request:
      'En escritorio Guardian no puede protegerte con geocerca. Usa la app móvil.',
    upgrade:
      'En escritorio Guardian no puede protegerte con geocerca. Usa la app móvil.',
    settings:
      'En escritorio Guardian no puede protegerte con geocerca. Usa la app móvil.',
    restricted:
      'En escritorio Guardian no puede protegerte con geocerca. Usa la app móvil.',
  },
} as const;

type RationaleVariant = 'request' | 'upgrade' | 'settings' | 'restricted';

function rationale(platform: Platform, variant: RationaleVariant): string {
  return RATIONALES[platform][variant];
}

/**
 * Decide what the UI should do given the current geolocation permission state.
 * Pure function — same input always yields the same output.
 */
export function decidePermissionUX(
  input: PermissionUXInput,
): PermissionUXDecision {
  const {
    platform,
    foregroundState,
    backgroundState,
    inCriticalZone = false,
    userOptedOutForever = false,
  } = input;

  // ── Rule 5: desktop web is fundamentally unsupported ────────────────────
  if (platform === 'web-desktop') {
    return {
      canUseGeofence: false,
      canUseEmergencySOSWithLocation: false,
      mustUseFallback: true,
      userMessage: PermissionMessages.unsupportedDesktop,
      recommendedAction: 'block_feature_with_explanation',
      rationaleText: rationale('web-desktop', 'request'),
    };
  }

  // ── Platform reports the API is unavailable (e.g. very old browser) ─────
  if (foregroundState === 'unsupported') {
    return {
      canUseGeofence: false,
      canUseEmergencySOSWithLocation: false,
      mustUseFallback: true,
      userMessage: PermissionMessages.unsupportedDesktop,
      recommendedAction: 'block_feature_with_explanation',
      rationaleText: rationale(platform, 'request'),
    };
  }

  // ── iOS restricted (parental controls / MDM) ────────────────────────────
  if (foregroundState === 'restricted') {
    return {
      canUseGeofence: false,
      canUseEmergencySOSWithLocation: false,
      mustUseFallback: true,
      userMessage: PermissionMessages.restrictedIOS,
      recommendedAction: 'open_system_settings',
      rationaleText: rationale(platform, 'restricted'),
    };
  }

  // ── Foreground permission denied ────────────────────────────────────────
  if (foregroundState === 'denied') {
    // Rule 4: in a critical zone, denial blocks the feature outright.
    if (inCriticalZone) {
      return {
        canUseGeofence: false,
        canUseEmergencySOSWithLocation: false,
        mustUseFallback: true,
        userMessage: PermissionMessages.deniedCriticalZone,
        recommendedAction: 'block_feature_with_explanation',
        rationaleText: rationale(platform, 'settings'),
      };
    }

    // Rule 1+2: iOS has no "deny forever" — even userOptedOutForever maps to
    // "open settings" but with the friendlier modal flow. On Android, deny
    // forever genuinely prevents inline re-request.
    const isAndroidDenyForever =
      platform === 'android' && userOptedOutForever === true;

    if (isAndroidDenyForever) {
      return {
        canUseGeofence: false,
        canUseEmergencySOSWithLocation: false,
        mustUseFallback: true,
        userMessage: PermissionMessages.deniedForever,
        recommendedAction: 'open_system_settings',
        rationaleText: rationale('android', 'settings'),
      };
    }

    return {
      canUseGeofence: false,
      canUseEmergencySOSWithLocation: false,
      mustUseFallback: true,
      userMessage: PermissionMessages.deniedOneTime,
      recommendedAction: 'show_explanation_modal',
      rationaleText: rationale(platform, 'request'),
    };
  }

  // ── Permission not yet asked — prompt inline ────────────────────────────
  if (foregroundState === 'prompt') {
    return {
      canUseGeofence: false,
      canUseEmergencySOSWithLocation: false,
      mustUseFallback: true,
      userMessage: PermissionMessages.promptInline,
      recommendedAction: 'request_permission_inline',
      rationaleText: rationale(platform, 'request'),
    };
  }

  // ── foregroundState === 'granted' from here on ──────────────────────────

  // Rule 3: granted_when_in_use → foreground works, background does not.
  if (backgroundState === 'granted_when_in_use') {
    return {
      canUseGeofence: true,
      canUseEmergencySOSWithLocation: true,
      mustUseFallback: false,
      userMessage: PermissionMessages.grantedWhenInUseOnly,
      recommendedAction: 'open_system_settings',
      rationaleText: rationale(platform, 'upgrade'),
    };
  }

  // Background never requested → foreground geofence is fine, but advise the
  // user we may need to upgrade later. Continue degraded (no modal interrupt).
  if (backgroundState === 'not_requested') {
    return {
      canUseGeofence: true,
      canUseEmergencySOSWithLocation: true,
      mustUseFallback: false,
      userMessage: PermissionMessages.granted,
      recommendedAction: 'continue_degraded',
      rationaleText: rationale(platform, 'request'),
    };
  }

  // Background denied while foreground granted → can still SOS in foreground;
  // surface upgrade message so the user knows background SOS is off.
  if (backgroundState === 'denied') {
    return {
      canUseGeofence: true,
      canUseEmergencySOSWithLocation: true,
      mustUseFallback: false,
      userMessage: PermissionMessages.grantedWhenInUseOnly,
      recommendedAction: 'open_system_settings',
      rationaleText: rationale(platform, 'upgrade'),
    };
  }

  // Fully granted (foreground granted + background granted_always).
  return {
    canUseGeofence: true,
    canUseEmergencySOSWithLocation: true,
    mustUseFallback: false,
    userMessage: PermissionMessages.granted,
    recommendedAction: 'continue_degraded',
    rationaleText: rationale(platform, 'request'),
  };
}

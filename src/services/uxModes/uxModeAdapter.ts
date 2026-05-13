// Praeventio Guard — Sprint 50 §141-145: Modos adaptativos de UI.
//
// Cierra §141 (lectura fácil), §142 (alto contraste), §143 (modo guantes),
// §144 (baja conectividad), §145 (batería baja) de la 2da tanda usuario.
//
// 100% determinístico. Engine puro que dado un contexto (batería, red,
// luminosidad, prefs usuario, accesibilidad declarada) produce un
// `UxModeProfile` con tokens UI que el caller aplica via CSS variables.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type AccessibilityPref =
  | 'standard'
  | 'easy_read'            // §141 — pictogramas + vocabulario simple
  | 'high_contrast'        // §142 — contraste WCAG AAA, sin gradients
  | 'large_text'           // text +25%
  | 'reduce_motion';       // sin animaciones (prefers-reduced-motion)

export type HandsContext =
  | 'free_hands'
  | 'gloved_hands'         // §143 — botones grandes, sin gestos finos
  | 'one_hand'             // operando maquinaria, mantén un agarre
  | 'voice_only';          // manos ocupadas

export type NetworkClass =
  | 'wifi_strong'
  | 'cellular_4g'
  | 'cellular_3g'
  | 'cellular_2g'
  | 'edge_or_worse'
  | 'offline';             // §144 — solo bundle cached

export type BatteryClass =
  | 'plenty'               // >50%
  | 'sufficient'           // 20-50%
  | 'low'                  // 10-20% — modo ahorro
  | 'critical'             // <10% — solo SOS + check-in
  | 'charging';

export type AmbientLight = 'bright_sunlight' | 'normal_indoor' | 'low_light' | 'night';

export interface UxModeContext {
  accessibility?: AccessibilityPref[];
  hands?: HandsContext;
  network?: NetworkClass;
  battery?: BatteryClass;
  ambientLight?: AmbientLight;
  /** Si el usuario explícitamente eligió un theme manual. */
  manualTheme?: 'light' | 'dark' | 'auto';
}

// ────────────────────────────────────────────────────────────────────────
// Output profile (tokens UI)
// ────────────────────────────────────────────────────────────────────────

export interface UxModeProfile {
  /** Light o dark resuelto (manual override > ambient detection). */
  theme: 'light' | 'dark';
  /** Multiplier del baseline font-size (1.0 = normal, 1.25 = large). */
  fontScale: number;
  /** Tamaño mínimo de tap target (px). Default 44, gloves 64+. */
  minTapTargetPx: number;
  /** Si pictogramas reemplazan texto donde sea posible. */
  preferPictograms: boolean;
  /** Si se eliminan animaciones complejas. */
  reduceMotion: boolean;
  /** Si gradients/sombras se reemplazan con plano + bordes. */
  highContrastMode: boolean;
  /** Si gestos multi-touch están deshabilitados. */
  disableMultiTouchGestures: boolean;
  /** Si features pesadas (3D, charts complejos) se ocultan. */
  hideHeavyFeatures: boolean;
  /** Polling interval para sync (segundos). Default 30s; subir si batería baja. */
  syncIntervalSeconds: number;
  /** Si la app debe entrar en "essential only" mode. */
  essentialOnlyMode: boolean;
  /** Lista de features que quedan habilitadas en essential mode. */
  essentialFeatures: string[];
  /** Razones por las que se aplicó este profile (audit/debug). */
  appliedReasons: string[];
}

const ESSENTIAL_FEATURES = [
  'sos_button',
  'manual_checkin',
  'lone_worker_status',
  'emergency_numbers',
  'medical_qr',
];

// ────────────────────────────────────────────────────────────────────────
// Decision logic
// ────────────────────────────────────────────────────────────────────────

function resolveTheme(ctx: UxModeContext): 'light' | 'dark' {
  if (ctx.manualTheme === 'light') return 'light';
  if (ctx.manualTheme === 'dark') return 'dark';
  switch (ctx.ambientLight) {
    case 'bright_sunlight':
    case 'normal_indoor':
      return 'light';
    case 'low_light':
    case 'night':
      return 'dark';
    default:
      return 'light';
  }
}

export function deriveUxMode(ctx: UxModeContext): UxModeProfile {
  const reasons: string[] = [];
  const accessibility = new Set(ctx.accessibility ?? []);
  const theme = resolveTheme(ctx);

  let fontScale = 1.0;
  if (accessibility.has('large_text')) {
    fontScale = 1.25;
    reasons.push('large_text preference → fontScale 1.25');
  }
  if (accessibility.has('easy_read')) {
    fontScale = Math.max(fontScale, 1.15);
    reasons.push('easy_read → fontScale ≥1.15');
  }

  let minTapTargetPx = 44;
  if (ctx.hands === 'gloved_hands') {
    minTapTargetPx = 64;
    reasons.push('gloved_hands → tap target 64px (WCAG 2.5.5 ampliado)');
  }
  if (ctx.hands === 'one_hand') {
    minTapTargetPx = Math.max(minTapTargetPx, 56);
    reasons.push('one_hand → tap target ≥56px');
  }

  const preferPictograms =
    accessibility.has('easy_read') ||
    ctx.hands === 'gloved_hands' ||
    ctx.hands === 'voice_only';
  if (preferPictograms) reasons.push('preferPictograms (easy_read / gloves / voice)');

  const reduceMotion = accessibility.has('reduce_motion');
  if (reduceMotion) reasons.push('reduce_motion preference');

  const highContrastMode =
    accessibility.has('high_contrast') ||
    ctx.ambientLight === 'bright_sunlight';
  if (highContrastMode) reasons.push('high_contrast (preference o sol brillante)');

  const disableMultiTouchGestures =
    ctx.hands === 'gloved_hands' ||
    ctx.hands === 'one_hand' ||
    accessibility.has('easy_read');
  if (disableMultiTouchGestures) reasons.push('disableMultiTouchGestures');

  // Battery + network → essential mode
  let hideHeavyFeatures = false;
  let essentialOnlyMode = false;
  let syncIntervalSeconds = 30;

  if (ctx.battery === 'critical') {
    essentialOnlyMode = true;
    hideHeavyFeatures = true;
    syncIntervalSeconds = 300;
    reasons.push('battery critical → essentialOnly + sync 300s');
  } else if (ctx.battery === 'low') {
    hideHeavyFeatures = true;
    syncIntervalSeconds = 120;
    reasons.push('battery low → hideHeavyFeatures + sync 120s');
  }

  if (ctx.network === 'offline') {
    essentialOnlyMode = essentialOnlyMode || true;
    syncIntervalSeconds = 9999; // no sync online
    hideHeavyFeatures = true;
    reasons.push('offline → essentialOnly');
  } else if (ctx.network === 'edge_or_worse' || ctx.network === 'cellular_2g') {
    hideHeavyFeatures = true;
    syncIntervalSeconds = Math.max(syncIntervalSeconds, 180);
    reasons.push('network 2G/edge → hideHeavyFeatures + sync ≥180s');
  } else if (ctx.network === 'cellular_3g') {
    syncIntervalSeconds = Math.max(syncIntervalSeconds, 60);
    reasons.push('3G → sync ≥60s');
  }

  // Resolved
  return {
    theme,
    fontScale,
    minTapTargetPx,
    preferPictograms,
    reduceMotion,
    highContrastMode,
    disableMultiTouchGestures,
    hideHeavyFeatures,
    syncIntervalSeconds,
    essentialOnlyMode,
    essentialFeatures: ESSENTIAL_FEATURES,
    appliedReasons: reasons,
  };
}

// ────────────────────────────────────────────────────────────────────────
// CSS variable emitter
// ────────────────────────────────────────────────────────────────────────

/**
 * Convierte el profile a `Record<string, string>` que el caller puede
 * setear como `--var: value` en `:root` o `[data-ux-mode]`.
 */
export function profileToCssVars(profile: UxModeProfile): Record<string, string> {
  return {
    '--ux-theme': profile.theme,
    '--ux-font-scale': profile.fontScale.toString(),
    '--ux-tap-min': `${profile.minTapTargetPx}px`,
    '--ux-prefer-pictograms': profile.preferPictograms ? '1' : '0',
    '--ux-reduce-motion': profile.reduceMotion ? '1' : '0',
    '--ux-high-contrast': profile.highContrastMode ? '1' : '0',
    '--ux-disable-multitouch': profile.disableMultiTouchGestures ? '1' : '0',
    '--ux-hide-heavy': profile.hideHeavyFeatures ? '1' : '0',
    '--ux-sync-interval-s': profile.syncIntervalSeconds.toString(),
    '--ux-essential-only': profile.essentialOnlyMode ? '1' : '0',
  };
}

/**
 * Build a transition plan when context changes — devuelve qué tokens
 * cambiaron y si requiere recargar/reset de UI agresivo (essentialOnly
 * cambia → recargar shell para descargar features pesadas).
 */
export interface UxTransitionPlan {
  changes: Array<{ token: string; from: string; to: string }>;
  /** Si requiere full reload del shell. */
  requiresShellReload: boolean;
}

export function diffProfiles(
  previous: UxModeProfile,
  next: UxModeProfile,
): UxTransitionPlan {
  const prevVars = profileToCssVars(previous);
  const nextVars = profileToCssVars(next);
  const changes: UxTransitionPlan['changes'] = [];
  for (const [k, v] of Object.entries(nextVars)) {
    if (prevVars[k] !== v) {
      changes.push({ token: k, from: prevVars[k] ?? '', to: v });
    }
  }
  // Shell reload necesario si essentialOnly cambia (hay que descargar
  // chunks pesados de la app).
  const requiresShellReload = previous.essentialOnlyMode !== next.essentialOnlyMode;
  return { changes, requiresShellReload };
}

// SPDX-License-Identifier: MIT
//
// ArViewLink — Sprint 30 Bucket JJ.
//
// Punto único de entrada AR para iOS y Android Day-1. Wrapping de
// `ArQuickLookButton` (Sprint 21 M.3) + branch Android Scene Viewer.
//
// iOS Safari NO soporta WebXR `immersive-ar`. Para dar AR funcional Day-1
// en iPhone/iPad usamos ARKit Quick Look que se invoca con un simple
// `<a rel="ar" href="model.usdz">` (sin librerías, sin instalación).
//
// Android Chrome / Samsung Internet soportan tanto WebXR como **Scene
// Viewer** (intent:// que abre la app nativa "Google AR" o el Trusted Web
// Activity de Quick Look). Aquí preferimos Scene Viewer sobre WebXR por
// dos razones:
//   1. Day-1 sin requerir cámara permission flow del browser.
//   2. Si el usuario no tiene WebXR (Firefox Mobile, Edge Mobile antiguo)
//      Scene Viewer cae a la app pre-instalada.
//
// Browsers desktop / unsupported caen al callback `onUnsupported` para que
// el caller decida (mostrar mensaje, link a tutorial, etc.).
//
// CONTRATO con assets:
//   `kind` se mapea a `/models/ar/{kind}.usdz` (iOS) y `/models/{kind}.glb`
//   (Android). Los .glb ya existen en este repo (Sprint 21 Bucket M.2);
//   los .usdz son stubs hasta que el Cloud Run usdz-converter corra
//   (ver docs/ar-assets.md).

import React from 'react';
import { ArQuickLookButton } from './ArQuickLookButton';

export type ArKind =
  | 'extinguisher_pqs'
  | 'extinguisher_co2'
  | 'extinguisher_water'
  | 'hydrant'
  | 'aed'
  | 'first_aid_kit'
  | 'sign_evacuation'
  | 'sign_warning'
  | 'sign_mandatory'
  | 'sign_prohibition'
  | 'emergency_shower'
  | 'eye_wash_station'
  | 'gas_detector'
  | 'spill_kit'
  | 'safety_shower'
  | 'assembly_point'
  | 'evacuation_route';

export interface ArViewLinkProps {
  /** Identificador del tipo de objeto. Mapea a `.usdz` y `.glb`. */
  kind: ArKind;
  /** Texto visible. Default: "Ver en AR". */
  label?: string;
  /** Clases CSS extra para el control raíz. */
  className?: string;
  /** Callback cuando ni iOS Quick Look ni Scene Viewer están disponibles. */
  onUnsupported?: () => void;
  /**
   * Override del navigator.userAgent para tests jsdom — no usar en
   * producción. Si está set, evita leer `navigator` real.
   */
  userAgentOverride?: string;
}

export const IOS_USER_AGENT_RE = /iPad|iPhone|iPod/;
const ANDROID_UA_RE = /Android/;

/** Detecta iOS sin depender de runtime ssr. Acepta override para tests. */
export function isIosUserAgent(override?: string): boolean {
  const ua = override ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return IOS_USER_AGENT_RE.test(ua);
}

/** Detecta Android sin depender de runtime ssr. Acepta override para tests. */
export function isAndroidUserAgent(override?: string): boolean {
  const ua = override ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return ANDROID_UA_RE.test(ua);
}

/**
 * Construye el href de Google Scene Viewer. Documentado en
 * https://developers.google.com/ar/develop/scene-viewer — nuestro intent
 * apunta al `.glb` absoluto (Scene Viewer requiere URL accesible) con
 * `mode=ar_only` para forzar AR (sin fallback 3D viewer si no hay AR).
 */
export function buildSceneViewerHref(kind: ArKind, origin: string): string {
  const file = `${origin}/models/${kind}.glb`;
  // Encodeamos correctamente el query y mantenemos `Intent;...` como
  // bloque opaco: Scene Viewer no requiere encoding del intent suffix.
  return (
    `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(file)}&mode=ar_only` +
    `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;` +
    `action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${encodeURIComponent(file)};end;`
  );
}

export function ArViewLink({
  kind,
  label = 'Ver en AR',
  className,
  onUnsupported,
  userAgentOverride,
}: ArViewLinkProps) {
  const ios = isIosUserAgent(userAgentOverride);
  const android = isAndroidUserAgent(userAgentOverride);

  // iOS: delegar a ArQuickLookButton existente. Maneja capability detection
  // (relList.supports('ar')) y HEAD probe del .usdz.
  if (ios) {
    return (
      <ArQuickLookButton
        modelPath={`/models/ar/${kind}.usdz`}
        label={label}
        className={className}
      />
    );
  }

  // Android: Scene Viewer via intent://
  if (android) {
    const origin =
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : '';
    const href = buildSceneViewerHref(kind, origin);
    return (
      <a
        href={href}
        data-ar-scene-viewer
        rel="noopener"
        className={
          className ??
          'inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold uppercase tracking-wider transition-colors min-h-[44px]'
        }
      >
        <span aria-hidden="true">📱</span>
        <span>{label}</span>
      </a>
    );
  }

  // Desktop / unsupported: avisar al caller — no renderizamos nada.
  if (onUnsupported) {
    onUnsupported();
  }
  return null;
}

// SPDX-License-Identifier: MIT
//
// useWebXRSupport — Sprint 21 Ola 4 Bucket L.1.
//
// Detecta capabilities WebXR del navegador en runtime. La API WebXR Device
// se expone como `navigator.xr` — un `XRSystem` con métodos async como
// `isSessionSupported('immersive-ar')`. No todos los navegadores la
// implementan: hoy (2026) la cobertura es Android Chrome 79+, Edge Mobile,
// Quest Browser, Samsung Internet 12+. iOS Safari NO soporta WebXR (Apple
// empuja Quick Look + USDZ vía AR Quick Look — ver Bucket M).
//
// Este hook devuelve un snapshot del soporte que el resto de la app puede
// usar para decidir entre:
//   - `immersive-ar` real (hit-test + anchors) → XRSession.tsx
//   - fallback 2D (getUserMedia + overlays HTML) → WebXR.tsx legacy
//
// La detección es ASÍNCRONA (isSessionSupported retorna Promise<boolean>)
// por eso devolvemos `loading: true` mientras se resuelve. Los consumers
// deben renderizar un placeholder durante ese momento.
//
// Soporta SSR: si `navigator` no existe (build / Node tests sin jsdom),
// devuelve `available: false` sin lanzar.

import { useEffect, useState } from 'react';

/** Snapshot inmutable de las capabilities WebXR detectadas. */
export interface XRSupport {
  /** `navigator.xr` existe (no implica que immersive-ar funcione). */
  available: boolean;
  /** `isSessionSupported('immersive-ar')` resolvió true. */
  immersiveAr: boolean;
  /**
   * El user-agent expone soporte para `hit-test` como required feature.
   * Asumido true cuando immersiveAr es true en navegadores modernos
   * (Chrome ≥ 81). Detección runtime real solo es posible al iniciar
   * la sesión — aquí marcamos optimista.
   */
  hitTest: boolean;
  /** `anchors` feature — Chrome ≥ 92 estable. Optimista igual que hitTest. */
  anchors: boolean;
  /** `dom-overlay` feature — Chrome ≥ 88 estable. Optimista. */
  domOverlay: boolean;
  /** Detección asíncrona en curso. UI debe mostrar spinner si true. */
  loading: boolean;
}

/**
 * Mínimo subset de la API WebXR que necesitamos. TypeScript ya trae las
 * lib types DOM con `Navigator.xr` y `XRSystem`, pero no queremos depender
 * de la presencia exacta del tsconfig — por eso narrowing defensivo.
 */
interface MinimalXRSystem {
  isSessionSupported(mode: 'immersive-ar' | 'immersive-vr' | 'inline'): Promise<boolean>;
}

const INITIAL: XRSupport = {
  available: false,
  immersiveAr: false,
  hitTest: false,
  anchors: false,
  domOverlay: false,
  loading: true,
};

const UNSUPPORTED: XRSupport = { ...INITIAL, loading: false };

/**
 * React hook que detecta capabilities WebXR. Re-evalúa solo en mount —
 * el soporte del browser no cambia mid-session.
 */
export function useWebXRSupport(): XRSupport {
  const [support, setSupport] = useState<XRSupport>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    if (typeof navigator === 'undefined') {
      setSupport(UNSUPPORTED);
      return;
    }

    const xrSystem = (navigator as Navigator & { xr?: MinimalXRSystem }).xr;
    if (!xrSystem || typeof xrSystem.isSessionSupported !== 'function') {
      setSupport(UNSUPPORTED);
      return;
    }

    xrSystem
      .isSessionSupported('immersive-ar')
      .then((supported) => {
        if (cancelled) return;
        setSupport({
          available: true,
          immersiveAr: supported,
          // Optimistic: Chrome ≥ 92 expone los 3 features juntos cuando
          // immersive-ar es true. Si falla el requestSession más tarde,
          // se cae al fallback 2D.
          hitTest: supported,
          anchors: supported,
          domOverlay: supported,
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // navigator.xr existe pero falló la query → reportamos available
        // sin immersive-ar para que la UI muestre "AR detectada pero no
        // soportada en este modo".
        setSupport({
          available: true,
          immersiveAr: false,
          hitTest: false,
          anchors: false,
          domOverlay: false,
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return support;
}

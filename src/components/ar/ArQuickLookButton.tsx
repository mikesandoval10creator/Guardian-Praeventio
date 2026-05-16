// SPDX-License-Identifier: MIT
//
// ArQuickLookButton — Sprint 21 Ola 4 Bucket M.3.
//
// Botón "Ver en AR" para iOS (iPhone / iPad). Apple no soporta WebXR; en
// vez de eso provee AR Quick Look — un visor nativo del sistema invocado
// con un simple `<a rel="ar" href="model.usdz">`. iOS Safari (y iOS Chrome)
// detectan ese rel y abren el modelo en una sesión AR fullscreen sin
// necesidad de instalar app extra.
//
// Detección de capability: el spec exige que el browser implemente
// `HTMLAnchorElement.relList.supports('ar')`. Si no, no renderizamos nada
// (el caller decide qué mostrar — típicamente fallback 2D).
//
// CRÍTICO (requirement de Apple): el `<a rel="ar">` DEBE tener un `<img>` o
// `<picture>` hijo, sino iOS NO trata el link como Quick Look. Si no hay
// poster, generamos un placeholder transparente 1x1 inline.

import React, { useEffect, useState } from 'react';

export interface ArQuickLookButtonProps {
  /** Path al archivo `.usdz`. Ej: `/models/ar/extinguisher_pqs.usdz`. */
  modelPath: string;
  /**
   * Path opcional a una imagen poster (preview en el botón). Apple
   * requiere un `<img>` hijo; si no se provee, usamos un 1x1 transparente.
   */
  posterPath?: string;
  /** Texto visible. Default: "Ver en AR". */
  label?: string;
  /** Clases CSS extra para el `<a>`. */
  className?: string;
  /**
   * Callback que se invoca con la capability detectada al montar. Útil
   * para que el caller decida si mostrar fallback en paralelo.
   */
  onAvailable?: (supported: boolean) => void;
}

/**
 * Detección sincrónica del soporte AR Quick Look. Apple specifica
 * `relList.supports('ar')` como contract — Safari iOS retorna true,
 * desktop retorna false, otros browsers (Firefox/Chrome desktop) también
 * retornan false. Wrapping defensivo por SSR / jsdom sin createElement.
 */
function detectArQuickLookSupport(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const a = document.createElement('a');
    if (!a || !('relList' in a)) return false;
    const rl = a.relList as DOMTokenList & { supports?: (token: string) => boolean };
    if (typeof rl.supports !== 'function') return false;
    return rl.supports('ar');
  } catch {
    return false;
  }
}

/** Pixel transparente 1x1 PNG inline — Apple exige `<img>` hijo. */
const TRANSPARENT_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

export function ArQuickLookButton({
  modelPath,
  posterPath,
  label = 'Ver en AR',
  className,
  onAvailable,
}: ArQuickLookButtonProps) {
  const [supported, setSupported] = useState<boolean>(false);
  // Bucket EE.7 — los .usdz se generan vía Cloud Function aislada y pueden
  // no existir todavía para algunos kinds (despliegue gradual del converter).
  // Hacemos un HEAD al modelPath antes de mostrar el link para no romper la
  // UX con un download que falla. Mientras esté pending, no renderizamos
  // nada (el caller decide fallback).
  const [usdzAvailable, setUsdzAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const ok = detectArQuickLookSupport();
    setSupported(ok);
    onAvailable?.(ok);
    // onAvailable intentionally outside deps — caller stable refs assumed,
    // re-running on every render would call the callback for every parent
    // re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    // HEAD probe — si el archivo no existe (404) o el server-side está
    // mal configurado, fallback gracefully a no renderizar el botón.
    // Algunos servers (incluyendo el dev de Vite) no permiten HEAD; en ese
    // caso GET con range 0-0 funciona pero no vale el peso, así que tratamos
    // cualquier no-2xx como "no disponible".
    fetch(modelPath, { method: 'HEAD' })
      .then((res) => {
        if (cancelled) return;
        setUsdzAvailable(res.ok);
      })
      .catch(() => {
        if (cancelled) return;
        setUsdzAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supported, modelPath]);

  if (!supported) return null;
  // Aún no sabemos si existe — no renderizamos hasta confirmar para evitar
  // flash de un botón roto. usdzAvailable === false mantiene el mismo
  // comportamiento que !supported (return null, el caller decide).
  if (!usdzAvailable) return null;

  return (
    <a
      rel="ar"
      href={modelPath}
      data-ar-quick-look
      className={
        className ??
        'inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold uppercase tracking-wider transition-colors min-h-[44px]'
      }
    >
      {/*
        Apple requirement: <a rel="ar"> MUST contain an <img> or <picture>
        child for iOS to invoke Quick Look. Without it, the link opens as a
        normal download.
      */}
      <img
        src={posterPath ?? TRANSPARENT_1PX}
        alt=""
        aria-hidden="true"
        className={posterPath ? 'w-6 h-6 rounded' : 'sr-only'}
      />
      <span>{label}</span>
    </a>
  );
}

/**
 * Helper exportado para detección "fuera del componente" — útil en
 * ARObjectOverlay para decidir entre branch WebXR y branch Quick Look
 * sin renderizar el botón.
 */
export function isArQuickLookSupported(): boolean {
  return detectArQuickLookSupport();
}

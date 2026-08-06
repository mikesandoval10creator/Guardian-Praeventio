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

/**
 * Magic bytes de un archivo ZIP (y por extensión USDZ, que es un ZIP
 * contenedor de assets USD según Apple AR Quick Look spec).
 * USDZ NO empieza con "USDA"; empieza con `PK\x03\x04` (local file
 * header de un ZIP estándar). Validamos los primeros 4 bytes del body.
 */
const USDZ_MAGIC_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/**
 * Devuelve true si los primeros 4 bytes del body coinciden con la firma
 * ZIP (USDZ válido). Falsos positivos posibles si un server devuelve un
 * PNG cuyo header coincida por accidente (no documentado en práctica);
 * usamos los 4 bytes completos (no 2) para minimizarlo.
 *
 * Refs: P1 ticket 39baa66d-73fe-8125-aca4-eeb2e33e5f8a — los archivos
 * .usdz placeholder en public/models/ar/*.usdz eran texto plano que
 * respondía HEAD 200, pero iOS abría un archivo inválido al hacer click.
 */
export function validateUsdzMagicBytes(body: Uint8Array | null): boolean {
  if (!body || body.length < 4) return false;
  return (
    body[0] === USDZ_MAGIC_BYTES[0] &&
    body[1] === USDZ_MAGIC_BYTES[1] &&
    body[2] === USDZ_MAGIC_BYTES[2] &&
    body[3] === USDZ_MAGIC_BYTES[3]
  );
}

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
    // P1 ticket 39baa66d-73fe-8125-aca4-eeb2e33e5f8a:
    // Antes este bloque hacía HEAD al modelPath — confiaba en que un 200
    // significara un USDZ válido. En realidad los placeholders
    // (texto "REPLACE WITH REAL .usdz") devuelven 200 al HEAD, así que el
    // botón mostraba "Ver en AR" y iOS abría un archivo inválido en sesión
    // Quick Look fullscreen (vida-safety: extintor/AED/hidrante no se
    // renderizaba en AR → el supervisor no podía identificar la pieza).
    //
    // Fix: GET con Range 0-3 (cheap — solo primeros 4 bytes), validamos
    // magic bytes ZIP (PK\x03\x04). Si no coincide, fallback a no
    // renderizar. Mantiene el comportamiento de "no rompe UX con un
    // download que falla" pero ahora honesto sobre disponibilidad.
    fetch(modelPath, {
      method: 'GET',
      headers: { Range: 'bytes=0-3' },
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setUsdzAvailable(false);
          return;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        setUsdzAvailable(validateUsdzMagicBytes(buf));
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

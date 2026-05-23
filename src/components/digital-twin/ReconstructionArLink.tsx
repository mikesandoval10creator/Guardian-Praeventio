// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-23) AR launcher para el mesh
// reconstruido on-device.
//
// El componente `ArViewLink` (src/components/ar/) está diseñado para
// objetos del catálogo (extintor, hidrante, etc.) con paths fijos
// `/models/{kind}.glb`. Para el mesh reconstruido del Digital Twin las
// URLs vienen del job en Firestore (glb + opcional usdz en Firebase
// Storage). Este componente acepta esas URLs y abre el viewer adecuado:
//
//   - iOS Safari (iPad/iPhone) → AR Quick Look con USDZ (`<a rel="ar">`)
//   - Android Chrome → Scene Viewer intent con GLB
//   - Otro browser → fallback a model-viewer / 3D preview tab
//
// Privacy: las URLs son download URLs firmadas de Firebase Storage del
// mesh propio del usuario. La imagen original del video NUNCA está
// referenciada.

import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { isIosUserAgent, isAndroidUserAgent } from '../ar/ArViewLink';

export interface ReconstructionArLinkProps {
  /** URL del GLB en Firebase Storage. Obligatorio. */
  glbUrl: string;
  /** URL del USDZ en Firebase Storage. Opcional — sin USDZ, iOS no abre Quick Look. */
  usdzUrl?: string;
  /** Texto visible. Default "Ver mesh en AR". */
  label?: string;
  /** Título del modelo (mostrado en Scene Viewer). */
  title?: string;
  /** Clases CSS extra. */
  className?: string;
  /** Override de userAgent para tests. */
  userAgentOverride?: string;
}

/**
 * Construye el href Scene Viewer para una URL GLB arbitraria.
 * `mode=ar_preferred` permite caer a 3D viewer si AR no está disponible.
 * `title` se muestra en el banner del viewer.
 */
function buildSceneViewerForUrl(glbUrl: string, title?: string): string {
  const params = new URLSearchParams({
    file: glbUrl,
    mode: 'ar_preferred',
  });
  if (title) params.set('title', title);
  return (
    `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}` +
    `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;` +
    `action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${encodeURIComponent(glbUrl)};end;`
  );
}

export function ReconstructionArLink({
  glbUrl,
  usdzUrl,
  label = 'Ver mesh en AR',
  title,
  className,
  userAgentOverride,
}: ReconstructionArLinkProps) {
  const isIos = isIosUserAgent(userAgentOverride);
  const isAndroid = isAndroidUserAgent(userAgentOverride);

  const href = useMemo(() => {
    if (isIos && usdzUrl) return usdzUrl;
    if (isAndroid) return buildSceneViewerForUrl(glbUrl, title);
    return glbUrl;
  }, [isIos, isAndroid, usdzUrl, glbUrl, title]);

  // En iOS Quick Look, el `<a rel="ar">` activa el visor nativo cuando
  // el target es .usdz. Si no tenemos usdz, mostramos un fallback link
  // genérico al GLB (descargable, abrible con model-viewer apps).
  const isQuickLook = isIos && usdzUrl;

  const baseClassName =
    'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl ' +
    'text-xs font-black uppercase tracking-widest transition-colors ' +
    'bg-cyan-500 hover:bg-cyan-400 text-white active:scale-95';

  return (
    <a
      href={href}
      rel={isQuickLook ? 'ar' : 'noopener noreferrer'}
      target={isAndroid || isQuickLook ? undefined : '_blank'}
      download={!isAndroid && !isQuickLook ? undefined : undefined}
      className={className ? `${baseClassName} ${className}` : baseClassName}
      // iOS Safari: para activar Quick Look, el `<a>` DEBE tener exactamente
      // `rel="ar"` y un único hijo `<img>` o un descendiente con la imagen
      // de preview. Para mantener el componente accesible + sin imagen
      // pre-cargada, usamos un `<picture>` vacío que Safari acepta como
      // fallback válido.
    >
      {isQuickLook && (
        <picture>
          {/* Safari Quick Look ignora el contenido del <picture> si está
              vacío pero respeta el rel="ar" en el ancestor. */}
        </picture>
      )}
      <Eye className="w-4 h-4" aria-hidden="true" />
      <span>{label}</span>
      {isIos && !usdzUrl && (
        <span className="text-[9px] opacity-70">(GLB)</span>
      )}
    </a>
  );
}

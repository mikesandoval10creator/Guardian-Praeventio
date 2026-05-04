import React, { useState, useMemo } from 'react';
import { findMedicalIcon, resolveIconUrl } from '../../services/medical/iconLibrary';

/**
 * Sprint 17c — Generic medical icon renderer.
 * Sprint 20 Fase 1b — soporta PNG hosted en CDN Praeventio con fallback graceful
 * al SVG local cuando la URL hosted no carga.
 *
 * Estrategia de render:
 *   1. Resolvemos la URL preferida via `resolveIconUrl(entry)`. Si
 *      `VITE_MEDICAL_ICONS_BASE_URL` está seteado, intenta el PNG hosted.
 *   2. Si el PNG falla (404, CORS, offline), el `onError` cae al `publicPath`
 *      local (SVG placeholder) que viene del bundle.
 *   3. Si la entry no existe, render del placeholder tinted (graceful=true) o
 *      throw (graceful=false).
 *
 * Esto permite que el operario sin red siga viendo un icono (el SVG local)
 * mientras que con red ve el boceto Nano Banana de alta calidad servido por
 * el bucket público de Guardian Praeventio.
 */
export interface MedicalIconProps {
  /** Stable name from `MEDICAL_ICON_REGISTRY`. */
  name: string;
  /** Square render size in CSS pixels. Default 48. */
  size?: number;
  /** Extra class for layout / tinting. */
  className?: string;
  /** Accessible alt text; falls back to the icon name. */
  alt?: string;
  /** When false, throws on unknown name instead of rendering a placeholder. */
  graceful?: boolean;
}

export const MedicalIcon: React.FC<MedicalIconProps> = ({
  name,
  size = 48,
  className,
  alt,
  graceful = true,
}) => {
  const entry = findMedicalIcon(name);
  // Track whether the hosted (preferred) URL has failed so we know to render
  // the local fallback. `null` means "not yet attempted or no fallback needed".
  const [failedHostedUrl, setFailedHostedUrl] = useState<string | null>(null);

  const preferredSrc = useMemo(() => (entry ? resolveIconUrl(entry) : null), [entry]);

  if (!entry) {
    if (!graceful) throw new Error(`MedicalIcon: unknown name "${name}"`);
    return (
      <span
        role="img"
        aria-label={alt ?? name}
        data-medical-icon-missing={name}
        style={{
          width: size,
          height: size,
          display: 'inline-block',
          backgroundColor: 'rgba(77, 182, 172, 0.1)',
          borderRadius: 4,
        }}
        className={className}
      />
    );
  }

  // If the preferred (hosted) URL already failed, use the local SVG fallback.
  const renderUrl =
    preferredSrc && preferredSrc !== failedHostedUrl ? preferredSrc : entry.publicPath;

  return (
    <img
      src={renderUrl}
      alt={alt ?? entry.name}
      width={size}
      height={size}
      className={className}
      loading="lazy"
      decoding="async"
      data-medical-icon={entry.name}
      data-medical-icon-source={renderUrl === entry.publicPath ? 'local' : 'hosted'}
      onError={() => {
        // First failure of the hosted URL → flip to local SVG fallback. The
        // local path is served from /public/icons/biology/ by Vite, so this
        // never makes a second network call against the hosted CDN.
        if (preferredSrc && renderUrl === preferredSrc) {
          setFailedHostedUrl(preferredSrc);
        }
      }}
    />
  );
};

export default MedicalIcon;

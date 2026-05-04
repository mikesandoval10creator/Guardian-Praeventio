import React, { useState, useMemo } from 'react';
import { findMedicalIcon, type MedicalIconEntry } from '../../services/medical/iconLibrary';

/**
 * Sprint 17c — Generic medical icon renderer.
 * Sprint 20 Fase 1b — fallback chain PNG → SVG → placeholder graceful para
 * habilitar offline-first (los PNG generados con nano-banana se bundlean
 * al repo en `public/icons/biology/*.png` cuando el dueño del producto
 * corre `node scripts/generate-medical-icons.mjs --enrich-with-bioicons`).
 *
 * Estrategia de render:
 *   1. Intenta el PNG (path computado: `entry.publicPath` con `.svg` → `.png`).
 *      Si los PNG están bundleados, esto carga el boceto rico de Nano Banana.
 *   2. Si el PNG no existe (404 — pre-script-run o icono no generado),
 *      `onError` cambia state y re-renderiza con `entry.publicPath` (SVG legacy).
 *   3. Si el SVG también falla, segundo `onError` cae al placeholder graceful
 *      (span tinted teal con role="img").
 *
 * Esto cumple offline-first (ver ADR-0004): el operario sin red ve los iconos
 * desde el bundle local (PNG si existen, SVG sino, placeholder en último caso).
 * Cero requests externos.
 */

/** Build the PNG path candidate from an entry's SVG path. Pure helper, exported for tests. */
export function pngPathFor(entry: MedicalIconEntry): string {
  return entry.publicPath.endsWith('.svg')
    ? entry.publicPath.slice(0, -4) + '.png'
    : entry.publicPath;
}

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

type Stage = 'png' | 'svg' | 'placeholder';

export const MedicalIcon: React.FC<MedicalIconProps> = ({
  name,
  size = 48,
  className,
  alt,
  graceful = true,
}) => {
  const entry = findMedicalIcon(name);
  const [stage, setStage] = useState<Stage>('png');

  const pngSrc = useMemo(() => (entry ? pngPathFor(entry) : null), [entry]);

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

  // Final stage: placeholder graceful when both PNG and SVG failed to load.
  if (stage === 'placeholder') {
    return (
      <span
        role="img"
        aria-label={alt ?? entry.name}
        data-medical-icon-failed={entry.name}
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

  const src = stage === 'png' && pngSrc ? pngSrc : entry.publicPath;

  return (
    <img
      src={src}
      alt={alt ?? entry.name}
      width={size}
      height={size}
      className={className}
      loading="lazy"
      decoding="async"
      data-medical-icon={entry.name}
      data-medical-icon-stage={stage}
      onError={() => {
        // PNG missing → fall back to SVG. SVG missing → placeholder.
        if (stage === 'png') setStage('svg');
        else if (stage === 'svg') setStage('placeholder');
      }}
    />
  );
};

export default MedicalIcon;

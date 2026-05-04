import React from 'react';
import { findMedicalIcon } from '../../services/medical/iconLibrary';

/**
 * Sprint 17c — Generic medical icon renderer.
 *
 * Loads SVGs from the static `/public/icons/biology/` library via
 * `findMedicalIcon`. Defaults to graceful fallback (a tinted placeholder
 * box) so a missing icon never crashes a page during the staged rollout
 * while the curated Bioicons set is still being populated.
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
  return (
    <img
      src={entry.publicPath}
      alt={alt ?? entry.name}
      width={size}
      height={size}
      className={className}
      loading="lazy"
      decoding="async"
      data-medical-icon={entry.name}
    />
  );
};

export default MedicalIcon;

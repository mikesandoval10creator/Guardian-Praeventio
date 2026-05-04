import React from 'react';
import { hasAnyCcByIcons } from '../../services/medical/iconLibrary';

/**
 * Sprint 17c — CC-BY attribution footer for Bioicons.
 *
 * Mount this in pages that render `MedicalIcon` whenever the registry
 * contains at least one `CC-BY-4.0` entry. With the initial 100% CC0
 * subset this component renders nothing; it stays prepared so future
 * curation can flip licenses without further wiring work.
 */
export const MedicalIconAttribution: React.FC<{ className?: string }> = ({
  className,
}) => {
  if (!hasAnyCcByIcons()) return null;
  return (
    <p
      className={className}
      style={{ fontSize: 11, opacity: 0.7, marginTop: 8 }}
      data-medical-icon-attribution
    >
      Iconos médicos cortesía de{' '}
      <a
        href="https://bioicons.com"
        target="_blank"
        rel="noreferrer noopener"
      >
        Bioicons.com
      </a>{' '}
      (CC BY 4.0).
    </p>
  );
};

export default MedicalIconAttribution;

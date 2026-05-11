// Praeventio Guard — EPP requirement widget with Guardian figure.
// Industry-aware: reads selected project's industry and maps to sector-specific EPP list.
// Integrates EPPCharacter concept (Guardian shield) from the original prototype.

import { Shield, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProject } from '../../contexts/ProjectContext';
import { EPP_BY_SECTOR, EPP_DEFAULT } from '../../constants';

function getSectorPrefix(industry: string | undefined): string | null {
  if (!industry) return null;
  const match = industry.match(/^(GP-[A-Z]+)/);
  return match ? match[1] : null;
}

export function EPPRequiredWidget() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();

  const prefix = getSectorPrefix(selectedProject?.industry);
  const eppItems = (prefix && EPP_BY_SECTOR[prefix]) ? EPP_BY_SECTOR[prefix] : EPP_DEFAULT;

  return (
    <section className="bg-surface border border-default-token rounded-xl sm:rounded-2xl p-2 sm:p-4 shadow-mode w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <div>
          <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-token">
            {t('epp_required.badge', 'EPP Requerido')}
            {prefix && <span className="ml-1 normal-case tracking-normal font-normal">· {prefix}</span>}
          </p>
          <h3 className="text-[11px] sm:text-sm font-black text-primary-token leading-tight">
            {selectedProject
              ? t('epp_required.for_project', 'Equipos de protección activos')
              : t('epp_required.default', 'Equipos de protección general')}
          </h3>
        </div>
        <Link
          to="/epp"
          className="flex items-center gap-0.5 text-[8px] sm:text-[10px] accent-text font-bold uppercase tracking-widest hover:underline shrink-0"
        >
          {t('epp_required.see_all', 'Ver todos')} <ChevronRight className="w-2.5 h-2.5" />
        </Link>
      </div>

      {/* Body: Guardian figure + EPP grid */}
      <div className="flex items-center gap-3 sm:gap-5">

        {/* Guardian figure (prototype EPPCharacter concept) */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          <div className="relative w-14 h-14 sm:w-20 sm:h-20 accent-bg rounded-full flex items-center justify-center shadow-mode">
            <Shield className="w-7 h-7 sm:w-10 sm:h-10 text-white drop-shadow" />
            {prefix && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-elevated border border-default-token text-[5px] sm:text-[7px] font-black uppercase tracking-widest px-1 py-0.5 rounded-full text-primary-token whitespace-nowrap shadow-mode">
                {prefix.replace('GP-', '')}
              </span>
            )}
          </div>
          <span className="text-[6px] sm:text-[8px] text-muted-token font-bold uppercase tracking-widest text-center leading-none mt-1">
            {t('epp_required.brand', 'Guardián')}
          </span>
        </div>

        {/* EPP items grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-2 flex-1">
          {eppItems.map((item, i) => (
            <div
              key={i}
              className="bg-elevated border border-default-token rounded-lg sm:rounded-xl p-1 sm:p-2 flex flex-col items-center gap-0.5 sm:gap-1 text-center min-h-[44px] justify-center"
            >
              <span className="text-base sm:text-xl leading-none">{item.emoji}</span>
              <span className="text-[6px] sm:text-[9px] font-bold text-primary-token uppercase tracking-tight leading-none line-clamp-2">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

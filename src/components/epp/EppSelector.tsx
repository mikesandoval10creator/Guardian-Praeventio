// @vitest-environment jsdom
// Personalización Inteligente — EPP selector with rubro/industry dropdown.
// Renders the Guardian mascot at center with EPP cards arranged around it,
// dynamic per-rubro. Founder-confirmed UX pattern from praevium-guard prototype.
//
// DS 594-compliant EPP sets. No hardcoded colors — tokens only.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GuardianMascot } from '../shared/GuardianMascot';
import { EPP_SELECTOR_RUBROS, getEppForRubro, type EppSelectorRubro } from './eppSelectorData';

/** Single EPP card — icon + label badge */
function EppCard({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div className="bg-elevated border border-default-token rounded-xl p-2 sm:p-3 flex flex-col items-center gap-1 text-center min-h-[56px] sm:min-h-[68px] justify-center shadow-mode transition-all hover:border-accent-token">
      <span className="text-xl sm:text-2xl leading-none select-none" role="img" aria-label={label}>
        {emoji}
      </span>
      <span className="text-[7px] sm:text-[9px] font-black text-primary-token uppercase tracking-tight leading-none line-clamp-2 max-w-[64px]">
        {label}
      </span>
    </div>
  );
}

export function EppSelector() {
  const { t } = useTranslation();
  const [selectedRubroId, setSelectedRubroId] = useState<string>(EPP_SELECTOR_RUBROS[0].id);

  const selectedRubro: EppSelectorRubro =
    EPP_SELECTOR_RUBROS.find((r) => r.id === selectedRubroId) ?? EPP_SELECTOR_RUBROS[0];
  const eppItems = getEppForRubro(selectedRubroId);

  // Split EPP items: first half left, second half right (max 3 per side for clean layout)
  const leftItems = eppItems.slice(0, Math.ceil(eppItems.length / 2)).slice(0, 3);
  const rightItems = eppItems.slice(Math.ceil(eppItems.length / 2)).slice(0, 3);

  return (
    <section
      className="bg-surface border border-default-token rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-mode w-full"
      aria-label={t('epp_selector.section_label', 'Personalización Inteligente EPP')}
    >
      {/* Header */}
      <div className="mb-3 sm:mb-4">
        <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-token mb-0.5">
          {t('epp_selector.badge', 'Personalización Inteligente')}
        </p>
        <h2 className="text-[13px] sm:text-base font-black text-primary-token leading-tight">
          {t('epp_selector.title', 'Adapta tu equipo según tu profesión y entorno')}
        </h2>
        <p className="text-[9px] sm:text-[11px] text-muted-token mt-0.5 leading-snug">
          {t('epp_selector.subtitle', 'Cada decisión cuenta para tu seguridad.')}
        </p>
      </div>

      {/* Rubro dropdown */}
      <div className="mb-3 sm:mb-4">
        <label
          htmlFor="epp-rubro-select"
          className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-token block mb-1"
        >
          {t('epp_selector.rubro_label', 'Selecciona tu rubro')}
        </label>
        <select
          id="epp-rubro-select"
          value={selectedRubroId}
          onChange={(e) => setSelectedRubroId(e.target.value)}
          className="w-full bg-elevated border border-default-token rounded-lg px-2.5 py-1.5 text-[11px] sm:text-xs font-bold text-primary-token appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent-token shadow-mode"
          aria-label={t('epp_selector.rubro_aria', 'Rubro o industria')}
          data-testid="epp-rubro-select"
        >
          {EPP_SELECTOR_RUBROS.map((rubro) => (
            <option key={rubro.id} value={rubro.id}>
              {rubro.label}
            </option>
          ))}
        </select>
      </div>

      {/* Center layout: EPP left | Mascot | EPP right */}
      <div
        className="flex items-center justify-center gap-2 sm:gap-4"
        aria-label={t('epp_selector.grid_label', 'Equipos de protección para {{rubro}}', {
          rubro: selectedRubro.label,
        })}
        data-testid="epp-grid"
      >
        {/* Left column */}
        <div className="flex flex-col gap-1.5 sm:gap-2 flex-1">
          {leftItems.map((item, i) => (
            <EppCard key={`left-${i}`} emoji={item.emoji} label={item.label} />
          ))}
        </div>

        {/* Guardian mascot — center anchor */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          <GuardianMascot mood="default" size="lg" />
          <span className="text-[6px] sm:text-[8px] font-black uppercase tracking-widest text-muted-token text-center leading-none">
            {selectedRubro.label}
          </span>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-1.5 sm:gap-2 flex-1">
          {rightItems.map((item, i) => (
            <EppCard key={`right-${i}`} emoji={item.emoji} label={item.label} />
          ))}
        </div>
      </div>

      {/* Footer note */}
      <p className="text-[7px] sm:text-[9px] text-muted-token text-center mt-2 sm:mt-3 leading-snug">
        {t('epp_selector.norm_note', 'Según DS 594 — Reglamento sobre condiciones sanitarias y ambientales básicas en los lugares de trabajo')}
      </p>
    </section>
  );
}

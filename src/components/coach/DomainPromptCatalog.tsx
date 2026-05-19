// Praeventio Guard — Wire UI #77: <DomainPromptCatalog />
//
// Catálogo navegable de los 5 prompts de dominio del Coach IA
// (chemical / medicine / legal / ergonomics / structural) — útil para
// auditoría + transparencia IA + onboarding del prevencionista.
//
// Fase 3.B 2026-05-18: agregado ergonomics + structural.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, FlaskConical, Stethoscope, Scale, PersonStanding, Building2 } from 'lucide-react';
import {
  DOMAIN_PROMPTS,
  type CoachDomain,
} from '../../services/coach/prompts.js';

interface DomainPromptCatalogProps {
  initialDomain?: CoachDomain;
  onDomainSelect?: (domain: CoachDomain) => void;
}

const DOMAIN_META: Record<CoachDomain, { label: string; Icon: typeof FlaskConical; color: string }> = {
  chemical: { label: 'Químico-Toxicológico', Icon: FlaskConical, color: 'text-amber-500' },
  medicine: { label: 'Salud Ocupacional', Icon: Stethoscope, color: 'text-emerald-500' },
  legal: { label: 'Legal / Cumplimiento', Icon: Scale, color: 'text-sky-500' },
  ergonomics: { label: 'Ergonomía', Icon: PersonStanding, color: 'text-rose-500' },
  structural: { label: 'Estructural', Icon: Building2, color: 'text-indigo-500' },
};

const DOMAIN_ORDER: CoachDomain[] = ['chemical', 'medicine', 'legal', 'ergonomics', 'structural'];

export function DomainPromptCatalog({
  initialDomain = 'chemical',
  onDomainSelect,
}: DomainPromptCatalogProps) {
  const { t } = useTranslation();
  const [domain, setDomain] = useState<CoachDomain>(initialDomain);
  const prompt = DOMAIN_PROMPTS[domain];
  const { Icon, color } = DOMAIN_META[domain];

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="domain-prompt-catalog"
      aria-label={t('coach.catalogAria', 'Catálogo prompts dominio') as string}
    >
      <header className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-fuchsia-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('coach.catalogTitle', 'Coach IA · Prompts')}
        </h2>
      </header>

      <nav
        className="flex gap-1"
        role="tablist"
        data-testid="domain-prompt-tabs"
      >
        {DOMAIN_ORDER.map((d) => {
          const meta = DOMAIN_META[d];
          const TabIcon = meta.Icon;
          const active = d === domain;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`domain-prompt-tab-${d}`}
              onClick={() => {
                setDomain(d);
                onDomainSelect?.(d);
              }}
              className={`flex items-center gap-1 flex-1 px-2 py-1.5 rounded text-xs font-bold ${
                active
                  ? `${meta.color} bg-surface-elevated border border-default-token`
                  : 'text-secondary-token hover:bg-surface-elevated'
              }`}
            >
              <TabIcon className="w-3 h-3" aria-hidden="true" />
              {meta.label}
            </button>
          );
        })}
      </nav>

      <div
        className="bg-surface-elevated rounded p-3 space-y-2"
        data-testid={`domain-prompt-content-${domain}`}
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${color}`} aria-hidden="true" />
          <h3 className="text-xs font-black uppercase">{DOMAIN_META[domain].label}</h3>
        </div>

        <details open>
          <summary className="text-[10px] uppercase font-bold text-secondary-token cursor-pointer">
            {t('coach.systemPrompt', 'System prompt')}
          </summary>
          <pre
            className="mt-1 text-[10px] whitespace-pre-wrap font-mono bg-surface rounded p-2"
            data-testid={`domain-prompt-system-${domain}`}
          >
            {prompt.systemPrompt}
          </pre>
        </details>

        <details>
          <summary className="text-[10px] uppercase font-bold text-secondary-token cursor-pointer">
            {t('coach.examples', 'Few-shot examples')} ({prompt.examples.length})
          </summary>
          <ul className="mt-1 space-y-2" data-testid={`domain-prompt-examples-${domain}`}>
            {prompt.examples.map((ex, i) => (
              <li key={i} className="bg-surface rounded p-2 space-y-1">
                <p className="text-[10px] uppercase font-bold text-secondary-token">Q</p>
                <p className="text-[11px]">{ex.input}</p>
                <p className="text-[10px] uppercase font-bold text-secondary-token">A</p>
                <p className="text-[11px] text-secondary-token">{ex.output}</p>
              </li>
            ))}
          </ul>
        </details>

        <div data-testid={`domain-prompt-citations-${domain}`}>
          <h4 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('coach.citations', 'Normativas citadas')}
          </h4>
          <div className="flex flex-wrap gap-1">
            {prompt.citations.map((c) => (
              <span
                key={c}
                className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

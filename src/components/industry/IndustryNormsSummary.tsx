// Praeventio Guard — Bloque 3.13 wire huérfanos: IndustryNormsSummary.
//
// Read-only card that surfaces the regulatory + EPP + protocol footprint
// of a selected industry. Designed to live next to the selector wizard
// (review step) and on the project dashboard after the preset is applied.
//
// Founder directive — fuente como dato enriquecedor discreto:
//   • References (DS 44/2024, Ley 16.744) appear as small chips, never as
//     "BLOCK". The component does not gate any flow.
//   • Empty sections collapse — no "0 protocols" noise.

import { FileText, GraduationCap, HardHat, ScrollText, Stethoscope } from 'lucide-react';
import type { IndustryPreset } from '../../services/industryRules/industryRuleEngine.js';

export interface IndustryNormsSummaryProps {
  /** Full preset, typically returned by the `select` endpoint. */
  preset: IndustryPreset;
  /** Optional override for the title (defaults to preset.label). */
  title?: string;
  /** When true, the card is rendered in a denser, side-panel layout. */
  compact?: boolean;
}

interface SectionProps {
  icon: typeof FileText;
  title: string;
  items: string[];
  testid: string;
  compact?: boolean;
}

function Section({ icon: Icon, title, items, testid, compact }: SectionProps) {
  if (items.length === 0) return null;
  return (
    <div data-testid={testid} className={compact ? 'space-y-1' : 'space-y-2'}>
      <h3
        className={`flex items-center gap-1.5 font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300 ${
          compact ? 'text-[10px]' : 'text-xs'
        }`}
      >
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {title}
      </h3>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li
            key={item}
            className={`rounded border px-2 py-0.5 font-medium text-teal-800 bg-teal-50 border-teal-200 dark:bg-teal-900/30 dark:text-teal-100 dark:border-teal-700 ${
              compact ? 'text-[10px]' : 'text-xs'
            }`}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IndustryNormsSummary({
  preset,
  title,
  compact,
}: IndustryNormsSummaryProps) {
  return (
    <section
      data-testid="industryNorms.card"
      aria-label={`Normativa aplicable a ${preset.label}`}
      className={`rounded-2xl border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 ${
        compact ? 'p-3 space-y-3' : 'p-5 space-y-4'
      } shadow-sm`}
    >
      <header className="flex items-center gap-2">
        <ScrollText
          className="w-5 h-5 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h2
          data-testid="industryNorms.title"
          className={`font-bold text-slate-800 dark:text-slate-100 ${
            compact ? 'text-sm' : 'text-base'
          }`}
        >
          {title ?? preset.label}
        </h2>
        <span
          data-testid="industryNorms.prefix"
          className="ml-auto rounded bg-teal-50 dark:bg-teal-900/40 px-2 py-0.5 text-[10px] font-bold text-teal-700 dark:text-teal-200 border border-teal-200 dark:border-teal-700"
        >
          {preset.industryPrefix}
        </span>
      </header>

      <Section
        icon={ScrollText}
        title="Normativa aplicable"
        items={preset.applicableRegulations}
        testid="industryNorms.regulations"
        compact={compact}
      />
      <Section
        icon={Stethoscope}
        title="Protocolos MINSAL"
        items={preset.minsalProtocols}
        testid="industryNorms.protocols"
        compact={compact}
      />
      <Section
        icon={HardHat}
        title="Riesgos típicos"
        items={preset.typicalRisks}
        testid="industryNorms.risks"
        compact={compact}
      />
      <Section
        icon={HardHat}
        title="EPP base"
        items={preset.baseEpp}
        testid="industryNorms.epp"
        compact={compact}
      />
      <Section
        icon={FileText}
        title="Documentos obligatorios"
        items={preset.mandatoryDocuments}
        testid="industryNorms.documents"
        compact={compact}
      />
      <Section
        icon={GraduationCap}
        title="Capacitaciones mínimas"
        items={preset.mandatoryTrainings}
        testid="industryNorms.trainings"
        compact={compact}
      />

      <footer
        data-testid="industryNorms.footnote"
        className="text-[10px] text-slate-500 dark:text-slate-400 italic border-t border-slate-100 dark:border-slate-800 pt-2"
      >
        Fuente: DS 44/2024 + Ley 16.744 + protocolos MINSAL aplicables.
        Esta lista es una recomendación inicial; ajustables por proyecto.
      </footer>
    </section>
  );
}

export default IndustryNormsSummary;

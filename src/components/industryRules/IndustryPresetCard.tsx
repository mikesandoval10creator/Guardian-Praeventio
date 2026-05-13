// Praeventio Guard — Wire UI S43: <IndustryPresetCard />
//
// Tarjeta presentacional que muestra el preset de industria aplicado a
// un proyecto (riesgos, documentos, capacitaciones, EPP, normativa,
// protocolos MINSAL). El padre obtiene la PresetApplication vía
// buildPresetApplication() y la pasa como prop.

import { Factory, FileText, GraduationCap, HardHat, ScrollText, Stethoscope } from 'lucide-react';
import type { PresetApplication } from '../../services/industryRules/industryRuleEngine.js';

interface IndustryPresetCardProps {
  preset: PresetApplication;
  label?: string;
}

function Section({
  icon: Icon,
  title,
  items,
  testid,
}: {
  icon: typeof Factory;
  title: string;
  items: string[];
  testid: string;
}) {
  if (items.length === 0) return null;
  return (
    <div data-testid={testid}>
      <h3 className="flex items-center gap-1 text-[10px] uppercase font-bold text-teal-700 mb-1">
        <Icon className="w-3 h-3" aria-hidden="true" />
        {title}
      </h3>
      <ul className="flex flex-wrap gap-1">
        {items.map((it) => (
          <li
            key={it}
            className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded border border-teal-200"
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IndustryPresetCard({ preset, label }: IndustryPresetCardProps) {
  const risks = preset.risksToCreate.map((r) => r.riskType);
  return (
    <section
      className="rounded-2xl border border-teal-200 bg-white p-4 space-y-3"
      data-testid="industryRules.card"
      aria-label="Preset de industria"
    >
      <header className="flex items-center gap-2">
        <Factory className="w-4 h-4 text-teal-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-800" data-testid="industryRules.card.title">
          {label ?? preset.industryPrefix}
        </h2>
        <span
          className="ml-auto text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded"
          data-testid="industryRules.card.projectId"
        >
          {preset.projectId}
        </span>
      </header>

      <Section
        icon={HardHat}
        title="Riesgos típicos"
        items={risks}
        testid="industryRules.card.risks"
      />
      <Section
        icon={FileText}
        title="Documentos obligatorios"
        items={preset.documentsToGenerate}
        testid="industryRules.card.documents"
      />
      <Section
        icon={GraduationCap}
        title="Capacitaciones"
        items={preset.trainingsToSchedule}
        testid="industryRules.card.trainings"
      />
      <Section
        icon={HardHat}
        title="EPP base"
        items={preset.baseEppToAssign}
        testid="industryRules.card.epp"
      />
      <Section
        icon={ScrollText}
        title="Normativa"
        items={preset.regulationsToLink}
        testid="industryRules.card.regs"
      />
      <Section
        icon={Stethoscope}
        title="Protocolos MINSAL"
        items={preset.protocolsToActivate}
        testid="industryRules.card.protocols"
      />
    </section>
  );
}

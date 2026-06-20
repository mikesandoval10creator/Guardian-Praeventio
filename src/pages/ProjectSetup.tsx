// Praeventio Guard — Wire UI: <ProjectSetup /> (configuración de industria).
//
// Cierra el último eslabón del flujo "preset por industria": el motor
// determinístico (`industryRuleEngine.ts`) y su superficie HTTP
// (`industryRules.ts`, montada en `/api/sprint-k`) ya existían, junto al
// <IndustrySelectorWizard /> (GET .../industry/list + POST .../industry/select)
// y la tarjeta presentacional <IndustryPresetCard />. Pero ninguno estaba
// montado/ruteado: trabajo construido que no era real porque no estaba
// conectado (huérfanos del connectivity-ratchet, CLAUDE.md #21).
//
// Esta página los conecta sobre datos REALES:
//   1. El wizard consume el catálogo real de presets vía GET
//      `/api/sprint-k/:projectId/industry/list` (presets curados, estáticos)
//      y aplica el preset elegido vía POST `/api/sprint-k/:projectId/industry/select`
//      (persiste del lado del caller; el server gatea por membresía).
//   2. Al aplicar, se renderiza <IndustryPresetCard /> con la
//      `PresetApplication` REAL devuelta por el POST (riesgos, documentos,
//      capacitaciones, EPP base, normativa, protocolos MINSAL).
//
// Directivas del fundador respetadas:
//   • Nunca bloquea la operación — el preset es una recomendación inicial,
//     siempre ajustable.
//   • No se contacta ningún organismo externo: `select` es una llamada al
//     motor local, el caller decide qué persistir.
//   • Empty-state honesto cuando no hay proyecto seleccionado: no se
//     inventa data ni se muestra una tarjeta vacía.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Factory } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { IndustrySelectorWizard } from '../components/industry/IndustrySelectorWizard';
import { IndustryPresetCard } from '../components/industryRules/IndustryPresetCard';
import type {
  IndustryPreset,
  PresetApplication,
} from '../services/industryRules/industryRuleEngine';

export function ProjectSetup() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;

  // The applied preset feeds <IndustryPresetCard />. We keep both the
  // PresetApplication (what the card renders) and the IndustryPreset (for
  // its human label).
  const [applied, setApplied] = useState<{
    application: PresetApplication;
    preset: IndustryPreset;
  } | null>(null);

  if (!selectedProject || !projectId) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="project-setup-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Factory
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('projectSetup.page.title', 'Configuración de industria')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'projectSetup.page.selectProject',
              'Selecciona un proyecto para configurar su preset de industria (riesgos, documentos, capacitaciones, EPP y normativa aplicable).',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-5"
      data-testid="project-setup-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <Factory className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('projectSetup.page.title', 'Configuración de industria')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'projectSetup.page.subtitle',
              'Aplica el preset del sector: normativa DS 44/2024 + Ley 16.744, EPP base, capacitaciones y protocolos MINSAL. Recomendación inicial — siempre ajustable.',
            )}
          </p>
        </div>
      </header>

      <IndustrySelectorWizard
        projectId={projectId}
        onApplied={(result) => setApplied(result)}
      />

      {applied && (
        <section
          className="space-y-2"
          aria-label={
            t('projectSetup.applied.title', 'Preset aplicado') as string
          }
          data-testid="project-setup-applied"
        >
          <h2 className="text-xs font-black uppercase tracking-widest text-secondary-token">
            {t('projectSetup.applied.title', 'Preset aplicado')}
          </h2>
          <IndustryPresetCard
            preset={applied.application}
            label={applied.preset.label}
          />
        </section>
      )}
    </div>
  );
}

export default ProjectSetup;

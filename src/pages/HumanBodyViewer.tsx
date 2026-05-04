import React, { useState, useCallback } from 'react';
import { Activity, Network, CheckCircle, Loader2 } from 'lucide-react';
import { HumanBodyViewer as HumanBodyViewerComponent, BodyRegion } from '../components/occupational-health/HumanBodyViewer';
import { MedicalAnalyzer } from '../components/occupational-health/MedicalAnalyzer';
import { MedicalIcon } from '../components/medical/MedicalIcon';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useProject } from '../contexts/ProjectContext';
import { NodeType } from '../types';

const SEVERITY_LABEL: Record<NonNullable<BodyRegion['severity']>, string> = {
  leve: 'Leve',
  moderado: 'Moderado',
  grave: 'Grave',
  critico: 'Crítico',
};

export function HumanBodyViewer() {
  const [regions, setRegions] = useState<BodyRegion[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();

  const affectedRegions = regions.filter(r => r.severity !== null);

  const registerToRiskNetwork = useCallback(async () => {
    if (!selectedProject || affectedRegions.length === 0) return;
    setSaving(true);
    let count = 0;
    try {
      for (const region of affectedRegions) {
        await addNode({
          title: `Lesión: ${region.label} (${SEVERITY_LABEL[region.severity!]})`,
          description: region.notes
            ? `Región: ${region.label}. Notas: ${region.notes}. ${region.ds594Article ? `Ref: ${region.ds594Article}.` : ''}`
            : `Región corporal afectada: ${region.label}. Severidad: ${SEVERITY_LABEL[region.severity!]}.`,
          type: NodeType.FINDING,
          projectId: selectedProject.id,
          tags: ['lesión', region.severity!, region.label.toLowerCase(), 'diat', 'ley-16744'],
          connections: [],
          metadata: {
            bodyRegionId: region.id,
            severity: region.severity,
            ds594Article: region.ds594Article ?? null,
            source: 'human-body-viewer',
          },
        });
        count++;
      }
      setSavedCount(count);
      setTimeout(() => setSavedCount(0), 3000);
    } finally {
      setSaving(false);
    }
  }, [affectedRegions, addNode, selectedProject]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Activity className="w-7 h-7 text-rose-500" />
            Visor Corporal
            {/* Sprint 17c — Bioicons body silhouettes (M/F) decorate the page header. */}
            <span className="hidden sm:inline-flex items-center gap-1.5 text-rose-300/80" aria-hidden="true">
              <MedicalIcon name="human-body-male-front" size={28} alt="Cuerpo masculino" />
              <MedicalIcon name="human-body-female-front" size={28} alt="Cuerpo femenino" />
              <MedicalIcon name="spine" size={22} alt="Columna" />
            </span>
          </h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.25em] mt-1.5">
            Registro de Lesiones — DIAT · Ley 16.744 · DS 594
          </p>
        </div>
        <div className="flex items-center gap-3">
          {affectedRegions.length > 0 && (
            <button
              onClick={registerToRiskNetwork}
              disabled={saving || !selectedProject}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40
                bg-[#4db6ac]/10 border border-[#4db6ac]/30 text-[#4db6ac] hover:bg-[#4db6ac]/20"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : savedCount > 0 ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <Network className="w-4 h-4" />
              )}
              {savedCount > 0
                ? `${savedCount} nodo${savedCount > 1 ? 's' : ''} creado${savedCount > 1 ? 's' : ''}`
                : `Registrar ${affectedRegions.length} lesión${affectedRegions.length > 1 ? 'es' : ''} en Red`}
            </button>
          )}
          <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-rose-500 bg-rose-500/10 border-rose-500/20 shrink-0">
            <Activity className="w-4 h-4" />
            <span className="font-bold uppercase tracking-wider text-xs">Salud Ocupacional</span>
          </div>
        </div>
      </div>

      {/* Two-column layout: body viewer + AI analyzer */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <HumanBodyViewerComponent onChange={setRegions} />
        <MedicalAnalyzer regions={regions} />
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Activity } from 'lucide-react';
import { HumanBodyViewer as HumanBodyViewerComponent, BodyRegion } from '../components/occupational-health/HumanBodyViewer';
import { MedicalAnalyzer } from '../components/occupational-health/MedicalAnalyzer';

export function HumanBodyViewer() {
  const [regions, setRegions] = useState<BodyRegion[]>([]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Activity className="w-7 h-7 text-rose-500" />
            Visor Corporal
          </h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.25em] mt-1.5">
            Registro de Lesiones — DIAT · Ley 16.744 · DS 594
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-rose-500 bg-rose-500/10 border-rose-500/20 shrink-0">
          <Activity className="w-4 h-4" />
          <span className="font-bold uppercase tracking-wider text-xs">Salud Ocupacional</span>
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

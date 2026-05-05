// SPDX-License-Identifier: MIT
// Sprint 25 — Bucket NN: UI consumer for confinedSpaceHVAC Bernoulli generator.
// DS 594 Art. 35/61, DS 132 Art. 74, OSHA 29 CFR 1910.146.

import React, { useMemo, useState } from 'react';
import { Wind, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { logger } from '../../utils/logger';
import { generateConfinedSpaceVentNode } from '../../services/zettelkasten/bernoulli/confinedSpaceHVAC';
import { writeNodesDebounced } from '../../services/zettelkasten/persistence/writeNode';
import { useProject } from '../../contexts/ProjectContext';

const CONTAMINANTS = [
  { id: 'h2s', label: 'H₂S (1.19)', relDensity: 1.19 },
  { id: 'co2', label: 'CO₂ (1.52)', relDensity: 1.52 },
  { id: 'ch4', label: 'CH₄ (0.55)', relDensity: 0.55 },
  { id: 'nh3', label: 'NH₃ (0.59)', relDensity: 0.59 },
] as const;

export const ConfinedSpacePanel: React.FC = () => {
  const { selectedProject } = useProject();
  const [volumeM3, setVolumeM3] = useState<number | ''>(40);
  const [flowRateM3S, setFlowRateM3S] = useState<number | ''>(0.08);
  const [intakeVms, setIntakeVms] = useState<number | ''>(2);
  const [extractVms, setExtractVms] = useState<number | ''>(4);
  const [contaminantId, setContaminantId] = useState<typeof CONTAMINANTS[number]['id']>('h2s');
  const [measuredDeltaPa, setMeasuredDeltaPa] = useState<number | ''>(8);

  const result = useMemo(() => {
    const v = Number(volumeM3);
    const q = Number(flowRateM3S);
    const vIn = Number(intakeVms);
    const vOut = Number(extractVms);
    const meas = Number(measuredDeltaPa);
    if (v <= 0 || q <= 0 || vIn < 0 || vOut < 0) return null;

    const contaminant = CONTAMINANTS.find((c) => c.id === contaminantId)!;
    const node = generateConfinedSpaceVentNode(
      { id: `confined-${contaminantId}`, volumeM3: v, contaminantRelDensity: contaminant.relDensity },
      { intakeVelocityMs: vIn, extractionVelocityMs: vOut, flowRateM3S: q },
      { measuredDeltaPPa: meas },
    );

    const ach = (q * 3600) / v;
    // Tiempo de purga: 4 cambios de aire (estándar OSHA) para llegar < 1% concentración.
    const purgeMinutes = ach > 0 ? (4 * 60) / ach : Infinity;

    if (node) {
      logger.info('zettelkasten:confined-space-vent', { node });
      const projectId = selectedProject?.id;
      if (projectId) writeNodesDebounced([node], { projectId });
    }
    return { node, ach, purgeMinutes };
  }, [volumeM3, flowRateM3S, intakeVms, extractVms, contaminantId, measuredDeltaPa, selectedProject?.id]);

  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center border border-teal-500/20">
          <Wind className="w-6 h-6 text-teal-500 dark:text-teal-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Espacio confinado — ventilación</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            DS 594 Art. 35/61 · OSHA 29 CFR 1910.146. Purga + LEL alerta.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Volumen (m³)</label>
          <input
            type="number" min="0" step="any"
            value={volumeM3}
            onChange={(e) => setVolumeM3(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Caudal ventilador (m³/s)</label>
          <input
            type="number" min="0" step="any"
            value={flowRateM3S}
            onChange={(e) => setFlowRateM3S(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Contaminante</label>
          <select
            value={contaminantId}
            onChange={(e) => setContaminantId(e.target.value as typeof CONTAMINANTS[number]['id'])}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            {CONTAMINANTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">v aspiración (m/s)</label>
          <input
            type="number" min="0" step="any"
            value={intakeVms}
            onChange={(e) => setIntakeVms(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">v extracción (m/s)</label>
          <input
            type="number" min="0" step="any"
            value={extractVms}
            onChange={(e) => setExtractVms(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">ΔP sensor (Pa)</label>
          <input
            type="number" min="0" step="any"
            value={measuredDeltaPa}
            onChange={(e) => setMeasuredDeltaPa(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg px-3 py-2 border bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50">
            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">ACH / Tiempo de purga</p>
            <p className="text-lg font-black text-slate-900 dark:text-white">
              {result.ach.toFixed(1)} ACH · {Number.isFinite(result.purgeMinutes) ? result.purgeMinutes.toFixed(1) : '—'} min
            </p>
          </div>
          {result.node ? (
            <div className="rounded-lg px-3 py-2 border bg-rose-500/10 border-rose-500/20 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-rose-700 dark:text-rose-300">
                  LEL / ventilación crítica ({result.node.severity})
                </p>
                <p className="text-xs text-rose-700 dark:text-rose-300">
                  Bloquear ingreso. Nodo enviado al Zettelkasten.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg px-3 py-2 border bg-emerald-500/10 border-emerald-500/20 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-bold">Ventilación cumple DS 594</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ConfinedSpacePanel;

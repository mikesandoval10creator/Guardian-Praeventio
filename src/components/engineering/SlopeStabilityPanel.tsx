// SPDX-License-Identifier: MIT
// Sprint 25 — Bucket NN: UI consumer for slopeStabilityAfterRain Bernoulli generator.
// DS 132 Art. 32, Eurocódigo 7.

import React, { useMemo, useState } from 'react';
import { Mountain, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { logger } from '../../utils/logger';
import { generateSlopeStabilityNode } from '../../services/zettelkasten/bernoulli/slopeStabilityAfterRain';
import { writeNodesDebounced } from '../../services/zettelkasten/persistence/writeNode';
import { useProject } from '../../contexts/ProjectContext';

export const SlopeStabilityPanel: React.FC = () => {
  const { selectedProject } = useProject();
  const [slopeAngleDeg, setSlopeAngleDeg] = useState<number | ''>(35);
  const [cohesionKpa, setCohesionKpa] = useState<number | ''>(15);
  const [frictionAngleDeg, setFrictionAngleDeg] = useState<number | ''>(28);
  const [rainfall24hMm, setRainfall24hMm] = useState<number | ''>(40);
  const [heightM, setHeightM] = useState<number | ''>(8);

  const result = useMemo(() => {
    const slopeRad = (Number(slopeAngleDeg) * Math.PI) / 180;
    const frictionRad = (Number(frictionAngleDeg) * Math.PI) / 180;
    const c = Number(cohesionKpa) * 1000; // Pa
    const rain = Number(rainfall24hMm);
    const h = Number(heightM);
    if (h <= 0 || c < 0 || rain < 0) return null;

    // Saturation reduction (heurística): mayor lluvia → mayor reducción del ángulo.
    const saturationReductionRad = Math.min(0.3, (rain / 100) * 0.15);
    // Profundidad freática estimada inversamente proporcional a lluvia.
    const waterTableDepthM = Math.max(0.5, h - rain / 20);

    const node = generateSlopeStabilityNode(
      {
        id: 'slope-material',
        dryReposeAngleRad: frictionRad,
        saturationReductionRad,
      },
      { id: 'slope-geom', slopeAngleRad: slopeRad, heightM: h },
      { waterTableDepthM, waterDensityKgM3: 1000 },
    );

    // FS infinito-talud post-lluvia (Bishop simplificado, suelo cohesivo + friccional):
    // FS = (c + (γ·h·cos²β·tanφ_sat)) / (γ·h·sinβ·cosβ)
    const gamma = 18000; // N/m³ peso específico suelo medio
    const phiSat = frictionRad - saturationReductionRad;
    const cosB = Math.cos(slopeRad);
    const sinB = Math.sin(slopeRad);
    const denom = gamma * h * sinB * cosB;
    const FS = denom > 0 ? (c + gamma * h * cosB * cosB * Math.tan(phiSat)) / denom : Infinity;

    let estado: 'estable' | 'marginal' | 'falla';
    if (FS >= 1.5) estado = 'estable';
    else if (FS >= 1.0) estado = 'marginal';
    else estado = 'falla';

    if (node) {
      logger.info('zettelkasten:slope-stability', { node });
      const projectId = selectedProject?.id;
      if (projectId) writeNodesDebounced([node], { projectId });
    }
    return { node, FS, estado };
  }, [slopeAngleDeg, cohesionKpa, frictionAngleDeg, rainfall24hMm, heightM, selectedProject?.id]);

  const stateColor = result?.estado === 'estable'
    ? 'text-emerald-600 dark:text-emerald-400'
    : result?.estado === 'marginal' ? 'text-amber-600 dark:text-amber-400'
    : 'text-rose-600 dark:text-rose-400';

  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
          <Mountain className="w-6 h-6 text-amber-500 dark:text-amber-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Estabilidad de talud post-lluvia</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm">DS 132 Art. 32 · Eurocódigo 7. Factor de seguridad FS.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Ángulo talud (°)</label>
          <input type="number" min="0" max="90" step="any" value={slopeAngleDeg}
            onChange={(e) => setSlopeAngleDeg(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Cohesión (kPa)</label>
          <input type="number" min="0" step="any" value={cohesionKpa}
            onChange={(e) => setCohesionKpa(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Ángulo fricción interna (°)</label>
          <input type="number" min="0" max="90" step="any" value={frictionAngleDeg}
            onChange={(e) => setFrictionAngleDeg(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Lluvia 24h (mm)</label>
          <input type="number" min="0" step="any" value={rainfall24hMm}
            onChange={(e) => setRainfall24hMm(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Altura talud (m)</label>
          <input type="number" min="0" step="any" value={heightM}
            onChange={(e) => setHeightM(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg px-3 py-2 border bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50">
            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">Factor de seguridad FS</p>
            <p className={`text-lg font-black ${stateColor}`}>
              {Number.isFinite(result.FS) ? result.FS.toFixed(2) : '—'} · {result.estado.toUpperCase()}
            </p>
          </div>
          {result.node ? (
            <div className="rounded-lg px-3 py-2 border bg-rose-500/10 border-rose-500/20 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-700 dark:text-rose-300">
                Talud crítico ({result.node.severity}). Bloquear faena en zona.
              </p>
            </div>
          ) : (
            <div className="rounded-lg px-3 py-2 border bg-emerald-500/10 border-emerald-500/20 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-bold">Sin alertas geotécnicas</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SlopeStabilityPanel;

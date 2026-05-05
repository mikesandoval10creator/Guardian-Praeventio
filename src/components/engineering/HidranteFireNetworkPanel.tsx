// SPDX-License-Identifier: MIT
// Sprint 25 — Bucket NN: UI consumer for hidranteFireNetwork Bernoulli generator.
// NCh 1646 Of.98, NFPA 14, DS 594 Art. 41.

import React, { useMemo, useState } from 'react';
import { Droplets, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { logger } from '../../utils/logger';
import { generateHidrantePressureNode } from '../../services/zettelkasten/bernoulli/hidranteFireNetwork';
import { writeNodesDebounced } from '../../services/zettelkasten/persistence/writeNode';
import { useProject } from '../../contexts/ProjectContext';

const ATM_PA = 101_325; // NIST sea-level
const WATER_RHO = 1000;

export const HidranteFireNetworkPanel: React.FC = () => {
  const { selectedProject } = useProject();
  const [networkLengthM, setNetworkLengthM] = useState<number | ''>(150);
  const [diameterMm, setDiameterMm] = useState<number | ''>(63);
  const [networkPressureKpa, setNetworkPressureKpa] = useState<number | ''>(700);
  const [reachHeightM, setReachHeightM] = useState<number | ''>(8);

  const result = useMemo(() => {
    const len = Number(networkLengthM);
    const dMm = Number(diameterMm);
    const pKpa = Number(networkPressureKpa);
    const h = Number(reachHeightM);
    if (len <= 0 || dMm <= 0 || pKpa <= 0 || h <= 0) return null;

    const nozzleDiameterM = (dMm / 1000) * 0.6; // boquilla ~60% de la red
    const networkPressurePa = pKpa * 1000 + ATM_PA;
    const node = generateHidrantePressureNode(
      { id: `hydrant-net-${len}m`, networkPressurePa, nozzleDiameterM, dischargeCoefficient: 0.95 },
      { id: 'fire-target', reachHeightM: h, jetAngleRad: Math.PI / 3 },
      { ambientPressurePa: ATM_PA },
    );

    // Caudal estimado pre-pérdidas (Torricelli):
    const dp = networkPressurePa - ATM_PA;
    const v = Math.sqrt((2 * dp) / WATER_RHO);
    const area = Math.PI * Math.pow(nozzleDiameterM / 2, 2);
    const flowM3s = 0.95 * area * v;
    const flowM3h = flowM3s * 3600;
    // Tiempo de respuesta heurístico: 2 s/m de red + 5 s setup.
    const responseS = len * 2 + 5;

    if (node) {
      logger.info('zettelkasten:hidrante-pressure', { node });
      const projectId = selectedProject?.id;
      if (projectId) writeNodesDebounced([node], { projectId });
    }
    return { node, flowM3h, responseS, v };
  }, [networkLengthM, diameterMm, networkPressureKpa, reachHeightM, selectedProject?.id]);

  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
          <Droplets className="w-6 h-6 text-rose-500 dark:text-rose-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Red contra incendios — hidrante</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm">NCh 1646 Of.98 · NFPA 14 · DS 594 Art. 41.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Longitud red (m)</label>
          <input type="number" min="0" step="any" value={networkLengthM}
            onChange={(e) => setNetworkLengthM(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Diámetro (mm)</label>
          <input type="number" min="0" step="any" value={diameterMm}
            onChange={(e) => setDiameterMm(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Presión red (kPa)</label>
          <input type="number" min="0" step="any" value={networkPressureKpa}
            onChange={(e) => setNetworkPressureKpa(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Altura objetivo (m)</label>
          <input type="number" min="0" step="any" value={reachHeightM}
            onChange={(e) => setReachHeightM(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg px-3 py-2 border bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50">
            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">Caudal · Tiempo respuesta</p>
            <p className="text-lg font-black text-slate-900 dark:text-white">
              {result.flowM3h.toFixed(1)} m³/h · {result.responseS.toFixed(0)} s
            </p>
          </div>
          {result.node ? (
            <div className="rounded-lg px-3 py-2 border bg-rose-500/10 border-rose-500/20 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-700 dark:text-rose-300">
                Presión insuficiente ({result.node.severity}). Nodo Zettelkasten generado.
              </p>
            </div>
          ) : (
            <div className="rounded-lg px-3 py-2 border bg-emerald-500/10 border-emerald-500/20 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-bold">Red cumple alcance NCh 1646</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HidranteFireNetworkPanel;

// Sprint 29 Bucket AA F-A — CalculatorHub.
//
// Hub centralizado de los 12 generadores Bernoulli/Euler que hasta ahora
// no tenían UI consumer (solo HazmatStorageDesigner cubría 3 de ellos).
// Cada calculadora sigue el patrón de HazmatStorageDesigner:
//   1. Form de inputs con valores por defecto razonables.
//   2. useMemo que llama al generador del registry.
//   3. Si el nodo se emite, se muestra severidad + descripción + cita
//      normativa via `cite()` del registry regulatorio (Sprint 28 B1)
//      y se persiste con `writeNodesDebounced` (cuando hay proyecto).
//
// Categorías:
//   - Atmósferas: confinedSpaceHVAC, gasDispersionCloud, gasLeakDetection,
//                 mistingDustSuppression, respiratorFatigue, pulmonaryAltitude
//   - Hidráulica: dikeHydrostaticMonitor, hidranteFireNetwork
//   - Estructural: scaffoldWindSuction, slopeStabilityAfterRain
//   - Aero/Ergo: microWindEnergy, slamPhotogrammetryNode

import React, { useMemo, useState } from 'react';
import {
  Wind, Droplets, Building2, Mountain, Activity, Cpu,
  AlertTriangle, CheckCircle2, BookOpen,
} from 'lucide-react';
import {
  generateConfinedSpaceVentNode,
  generateGasDispersionNode,
  generateGasLeakNode,
  generateMistingNode,
  generateRespiratorFatigueNode,
  generatePulmonaryNode,
  generateDikeNode,
  generateHidrantePressureNode,
  generateScaffoldUpliftNode,
  generateSlopeStabilityNode,
  generateMicroWindNode,
  generateSlamMeshNode,
} from '../services/zettelkasten/bernoulli';
import { writeNodesDebounced } from '../services/zettelkasten/persistence/writeNode';
import { useProject } from '../contexts/ProjectContext';
import { cite } from '../services/regulatory/registry';
import type { RiskNodePayload } from '../services/zettelkasten/types';
import type { JurisdictionCode } from '../services/regulatory/types';

type TabKey = 'atmospheres' | 'hydraulics' | 'structural' | 'aero';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'atmospheres', label: 'Atmósferas', icon: Wind },
  { key: 'hydraulics', label: 'Hidráulica', icon: Droplets },
  { key: 'structural', label: 'Estructural', icon: Building2 },
  { key: 'aero', label: 'Aero / Ergo / Sensores', icon: Cpu },
];

const DEFAULT_JURISDICTIONS: JurisdictionCode[] = ['ISO-45001', 'CL'];

// ─── Helper UI ──────────────────────────────────────────────────────────────

interface CalcCardProps {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  controlId: string;
  node: RiskNodePayload | null;
  children: React.ReactNode;
}

const sevColor: Record<string, string> = {
  info: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/20',
  low: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  medium: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
  high: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/20',
  critical: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20',
};

const CalcCard: React.FC<CalcCardProps> = ({ title, subtitle, icon: Icon, controlId, node, children }) => {
  const citations = useMemo(
    () => cite(controlId, { jurisdictions: DEFAULT_JURISDICTIONS }),
    [controlId],
  );
  return (
    <div
      data-testid={`calc-card-${controlId}`}
      className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-5 space-y-3"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#4db6ac]/10 flex items-center justify-center border border-[#4db6ac]/20">
          <Icon className="w-5 h-5 text-[#4db6ac]" />
        </div>
        <div>
          <h4 className="text-base font-bold text-slate-900 dark:text-white">{title}</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
      {node ? (
        <div className={`rounded-lg border p-3 ${sevColor[node.severity] ?? sevColor.medium}`}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <p className="text-sm font-semibold">{node.title}</p>
          </div>
          <pre className="whitespace-pre-wrap text-[11px] leading-snug font-mono">{node.description}</pre>
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <p className="text-xs text-emerald-700 dark:text-emerald-300">Sin alertas con los inputs actuales.</p>
        </div>
      )}
      {citations.length > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <BookOpen className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Refs: {citations.join(' · ')}</span>
        </div>
      )}
    </div>
  );
};

// Generic numeric input.
const NumInput: React.FC<{
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  testId?: string;
}> = ({ label, value, onChange, step = 0.01, min = 0, testId }) => (
  <label className="block">
    <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">{label}</span>
    <input
      type="number"
      step={step}
      min={min}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      data-testid={testId}
      className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white focus:ring-1 focus:ring-[#4db6ac]"
    />
  </label>
);

// Hook utility — debounced persistence. Single node payload.
function usePersistNode(node: RiskNodePayload | null): void {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  React.useEffect(() => {
    if (!node || !projectId) return;
    writeNodesDebounced([node], { projectId });
  }, [node, projectId]);
}

// ─── Calculators ────────────────────────────────────────────────────────────

// 1. Confined Space HVAC
const ConfinedSpaceCalc: React.FC = () => {
  const [volumeM3, setVolumeM3] = useState(80);
  const [relDensity, setRelDensity] = useState(1.19);
  const [intakeMs, setIntakeMs] = useState(2);
  const [extractMs, setExtractMs] = useState(5);
  const [flowM3S, setFlowM3S] = useState(0.05);
  const [measuredDeltaPa, setMeasuredDeltaPa] = useState(10);

  const node = useMemo(
    () =>
      generateConfinedSpaceVentNode(
        { id: 'cs-ui', volumeM3, contaminantRelDensity: relDensity },
        { intakeVelocityMs: intakeMs, extractionVelocityMs: extractMs, flowRateM3S: flowM3S },
        { measuredDeltaPPa: measuredDeltaPa },
      ),
    [volumeM3, relDensity, intakeMs, extractMs, flowM3S, measuredDeltaPa],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Espacio confinado — HVAC ΔP"
      subtitle="DS 594 Art. 35 / OSHA 1910.146"
      icon={Wind}
      controlId="OPERATIONAL_CONTROL"
      node={node}
    >
      <div className="grid grid-cols-3 gap-2">
        <NumInput label="Volumen (m³)" value={volumeM3} onChange={setVolumeM3} />
        <NumInput label="ρ rel. cont." value={relDensity} onChange={setRelDensity} />
        <NumInput label="v entrada (m/s)" value={intakeMs} onChange={setIntakeMs} />
        <NumInput label="v extracción (m/s)" value={extractMs} onChange={setExtractMs} />
        <NumInput label="Q (m³/s)" value={flowM3S} onChange={setFlowM3S} />
        <NumInput label="ΔP medido (Pa)" value={measuredDeltaPa} onChange={setMeasuredDeltaPa} />
      </div>
    </CalcCard>
  );
};

// 2. Gas Dispersion Cloud
const GasDispersionCalc: React.FC = () => {
  const [releaseRate, setReleaseRate] = useState(0.5);
  const [idlh, setIdlh] = useState(30);
  const [relDensity, setRelDensity] = useState(2.5);
  const [windKmh, setWindKmh] = useState(10);
  const [stab, setStab] = useState<'A'|'B'|'C'|'D'|'E'|'F'>('F');
  const [roughness, setRoughness] = useState(0.05);

  const node = useMemo(
    () =>
      generateGasDispersionNode(
        { id: 'leak-ui', releaseRateKgS: releaseRate, idlhMgM3: idlh, relativeDensity: relDensity },
        { windKmh, pasquillStability: stab },
        { id: 'terrain-ui', roughnessM: roughness },
      ),
    [releaseRate, idlh, relDensity, windKmh, stab, roughness],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Dispersión de gas tóxico"
      subtitle="DS 144/1961 — Pasquill-Gifford"
      icon={Wind}
      controlId="EMERGENCY_PREPAREDNESS"
      node={node}
    >
      <div className="grid grid-cols-3 gap-2">
        <NumInput label="Tasa fuga (kg/s)" value={releaseRate} onChange={setReleaseRate} step={0.01} testId="gd-rate" />
        <NumInput label="IDLH (mg/m³)" value={idlh} onChange={setIdlh} />
        <NumInput label="ρ relativa" value={relDensity} onChange={setRelDensity} />
        <NumInput label="Viento (km/h)" value={windKmh} onChange={setWindKmh} />
        <label className="block">
          <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">Pasquill</span>
          <select
            value={stab}
            onChange={(e) => setStab(e.target.value as typeof stab)}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white"
          >
            {(['A','B','C','D','E','F'] as const).map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <NumInput label="z₀ rugosidad (m)" value={roughness} onChange={setRoughness} step={0.01} />
      </div>
    </CalcCard>
  );
};

// 3. Gas Leak Detection
const GasLeakCalc: React.FC = () => {
  const [pA, setPA] = useState(220000);
  const [vA, setVA] = useState(5);
  const [hA, setHA] = useState(0);
  const [pB, setPB] = useState(180000);
  const [vB, setVB] = useState(5);
  const [hB, setHB] = useState(0);
  const [density, setDensity] = useState(2.0);
  const [friction, setFriction] = useState(5000);
  const [lel, setLel] = useState(1.8);

  const node = useMemo(
    () =>
      generateGasLeakNode(
        { id: 'A', pressurePa: pA, velocityMs: vA, heightM: hA },
        { id: 'B', pressurePa: pB, velocityMs: vB, heightM: hB },
        { id: 'GLP', densityKgM3: density, expectedFrictionLossJKg: friction, lelVolPercent: lel },
      ),
    [pA, vA, hA, pB, vB, hB, density, friction, lel],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Fuga en red de gas"
      subtitle="DS 66/2007, ANSI/API 1109"
      icon={Wind}
      controlId="HAZARD_IDENTIFICATION"
      node={node}
    >
      <div className="grid grid-cols-3 gap-2">
        <NumInput label="P_A (Pa)" value={pA} onChange={setPA} step={1000} />
        <NumInput label="v_A (m/s)" value={vA} onChange={setVA} />
        <NumInput label="h_A (m)" value={hA} onChange={setHA} />
        <NumInput label="P_B (Pa)" value={pB} onChange={setPB} step={1000} />
        <NumInput label="v_B (m/s)" value={vB} onChange={setVB} />
        <NumInput label="h_B (m)" value={hB} onChange={setHB} />
        <NumInput label="ρ gas (kg/m³)" value={density} onChange={setDensity} />
        <NumInput label="Fricción esp. (J/kg)" value={friction} onChange={setFriction} step={100} />
        <NumInput label="LEL (% vol)" value={lel} onChange={setLel} />
      </div>
    </CalcCard>
  );
};

// 4. Misting Dust Suppression
const MistingCalc: React.FC = () => {
  const [inletA, setInletA] = useState(0.4);
  const [throatA, setThroatA] = useState(0.1);
  const [deltaP, setDeltaP] = useState(50);
  const [waterFlow, setWaterFlow] = useState(0.0008);
  const [waterPressure, setWaterPressure] = useState(300000);
  const [airFlow, setAirFlow] = useState(0.05);

  const node = useMemo(
    () =>
      generateMistingNode(
        { id: 'mister-ui', inletAreaM2: inletA, throatAreaM2: throatA, deltaPPa: deltaP },
        { flowRateM3S: waterFlow, pressurePa: waterPressure },
        { availableFlowM3S: airFlow },
      ),
    [inletA, throatA, deltaP, waterFlow, waterPressure, airFlow],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Supresión de polvo (misting)"
      subtitle="DS 594 Art. 65 / ISO 14644"
      icon={Wind}
      controlId="OPERATIONAL_CONTROL"
      node={node}
    >
      <div className="grid grid-cols-3 gap-2">
        <NumInput label="A inlet (m²)" value={inletA} onChange={setInletA} />
        <NumInput label="A garganta (m²)" value={throatA} onChange={setThroatA} />
        <NumInput label="ΔP (Pa)" value={deltaP} onChange={setDeltaP} />
        <NumInput label="Q agua (m³/s)" value={waterFlow} onChange={setWaterFlow} step={0.0001} />
        <NumInput label="P agua (Pa)" value={waterPressure} onChange={setWaterPressure} step={1000} />
        <NumInput label="Q aire (m³/s)" value={airFlow} onChange={setAirFlow} step={0.001} />
      </div>
    </CalcCard>
  );
};

// 5. Respirator Fatigue
const RespiratorCalc: React.FC = () => {
  const [flow, setFlow] = useState(0.0014);
  const [resistance, setResistance] = useState(800);
  const [maxDrop, setMaxDrop] = useState(343);
  const [tempC, setTempC] = useState(28);

  const node = useMemo(
    () =>
      generateRespiratorFatigueNode(
        { id: 'worker-ui', breathingFlowM3S: flow },
        { id: 'mask-ui', filterResistancePaSPerM3: resistance, maxPressureDropPa: maxDrop },
        { temperatureC: tempC },
      ),
    [flow, resistance, maxDrop, tempC],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Fatiga del respirador"
      subtitle="NIOSH 42 CFR 84 / DS 594 Art. 53"
      icon={Activity}
      controlId="COMPETENCE_TRAINING"
      node={node}
    >
      <div className="grid grid-cols-2 gap-2">
        <NumInput label="Q (m³/s)" value={flow} onChange={setFlow} step={0.0001} />
        <NumInput label="R filtro (Pa·s/m³)" value={resistance} onChange={setResistance} step={10} />
        <NumInput label="Δp máx (Pa)" value={maxDrop} onChange={setMaxDrop} />
        <NumInput label="T amb (°C)" value={tempC} onChange={setTempC} />
      </div>
    </CalcCard>
  );
};

// 6. Pulmonary Altitude
const PulmonaryCalc: React.FC = () => {
  const [pef, setPef] = useState(450);
  const [masl, setMasl] = useState(3500);
  const [resistance, setResistance] = useState(600);
  const [criticalDrop, setCriticalDrop] = useState(120);

  const node = useMemo(
    () =>
      generatePulmonaryNode(
        { id: 'worker-ui', pefLMin: pef },
        { masl },
        { id: 'mask-ui', filterResistancePaSPerM3: resistance, criticalDropPa: criticalDrop },
      ),
    [pef, masl, resistance, criticalDrop],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Capacidad pulmonar en altitud"
      subtitle="DS 594 Art. 49 / DS 28/2012"
      icon={Activity}
      controlId="COMPETENCE_TRAINING"
      node={node}
    >
      <div className="grid grid-cols-2 gap-2">
        <NumInput label="PEF (L/min)" value={pef} onChange={setPef} />
        <NumInput label="Altitud (msnm)" value={masl} onChange={setMasl} step={50} />
        <NumInput label="R filtro" value={resistance} onChange={setResistance} step={10} />
        <NumInput label="Δp crítica (Pa)" value={criticalDrop} onChange={setCriticalDrop} />
      </div>
    </CalcCard>
  );
};

// 7. Dike Hydrostatic Monitor
const DikeCalc: React.FC = () => {
  const [heightM, setHeightM] = useState(30);
  const [fluidDensity, setFluidDensity] = useState(1500);
  const [depth1, setDepth1] = useState(10);
  const [pressure1, setPressure1] = useState(80000);
  const [depth2, setDepth2] = useState(20);
  const [pressure2, setPressure2] = useState(280000);

  const node = useMemo(
    () =>
      generateDikeNode(
        { id: 'tranque-ui', heightM, fluidDensityKgM3: fluidDensity },
        [
          { id: 'pz-1', depthM: depth1, measuredPressurePa: pressure1 },
          { id: 'pz-2', depthM: depth2, measuredPressurePa: pressure2 },
        ],
      ),
    [heightM, fluidDensity, depth1, pressure1, depth2, pressure2],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Monitor hidrostático dique/tranque"
      subtitle="DS 248/2007 — SERNAGEOMIN"
      icon={Droplets}
      controlId="HAZARD_IDENTIFICATION"
      node={node}
    >
      <div className="grid grid-cols-3 gap-2">
        <NumInput label="Altura (m)" value={heightM} onChange={setHeightM} />
        <NumInput label="ρ fluido" value={fluidDensity} onChange={setFluidDensity} step={50} testId="dk-rho" />
        <div />
        <NumInput label="z pz-1 (m)" value={depth1} onChange={setDepth1} />
        <NumInput label="P pz-1 (Pa)" value={pressure1} onChange={setPressure1} step={1000} />
        <div />
        <NumInput label="z pz-2 (m)" value={depth2} onChange={setDepth2} />
        <NumInput label="P pz-2 (Pa)" value={pressure2} onChange={setPressure2} step={1000} />
      </div>
    </CalcCard>
  );
};

// 8. Hidrante Fire Network
const HidranteCalc: React.FC = () => {
  const [networkP, setNetworkP] = useState(800000);
  const [nozzleD, setNozzleD] = useState(0.04);
  const [cd, setCd] = useState(0.95);
  const [reachH, setReachH] = useState(15);
  const [angle, setAngle] = useState(1.2);
  const [ambient, setAmbient] = useState(101325);

  const node = useMemo(
    () =>
      generateHidrantePressureNode(
        { id: 'red-ui', networkPressurePa: networkP, nozzleDiameterM: nozzleD, dischargeCoefficient: cd },
        { id: 'tgt-ui', reachHeightM: reachH, jetAngleRad: angle },
        { ambientPressurePa: ambient },
      ),
    [networkP, nozzleD, cd, reachH, angle, ambient],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Hidrante / red de incendio"
      subtitle="NCh 1646 / NFPA 14"
      icon={Droplets}
      controlId="EMERGENCY_PREPAREDNESS"
      node={node}
    >
      <div className="grid grid-cols-3 gap-2">
        <NumInput label="P red (Pa)" value={networkP} onChange={setNetworkP} step={1000} />
        <NumInput label="D boquilla (m)" value={nozzleD} onChange={setNozzleD} step={0.005} />
        <NumInput label="Cd" value={cd} onChange={setCd} />
        <NumInput label="h objetivo (m)" value={reachH} onChange={setReachH} />
        <NumInput label="θ chorro (rad)" value={angle} onChange={setAngle} />
        <NumInput label="P_amb (Pa)" value={ambient} onChange={setAmbient} step={500} />
      </div>
    </CalcCard>
  );
};

// 9. Scaffold Wind Suction
const ScaffoldCalc: React.FC = () => {
  const [areaM2, setAreaM2] = useState(50);
  const [cp, setCp] = useState(-1.5);
  const [windKmh, setWindKmh] = useState(90);
  const [rated, setRated] = useState(1000);
  const [count, setCount] = useState(4);

  const node = useMemo(
    () =>
      generateScaffoldUpliftNode(
        { id: 'scaff-ui', areaM2, pressureCoefficient: cp },
        { windKmh },
        { ratedCapacityN: rated, anchorCount: count },
      ),
    [areaM2, cp, windKmh, rated, count],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Succión de viento — andamios"
      subtitle="NCh 432 / OSHA 1926.451"
      icon={Building2}
      controlId="OPERATIONAL_CONTROL"
      node={node}
    >
      <div className="grid grid-cols-3 gap-2">
        <NumInput label="Área (m²)" value={areaM2} onChange={setAreaM2} testId="sc-area" />
        <NumInput label="Cp (succión)" value={cp} onChange={setCp} step={0.1} testId="sc-cp" />
        <NumInput label="Viento (km/h)" value={windKmh} onChange={setWindKmh} testId="sc-wind" />
        <NumInput label="Capacidad anclaje (N)" value={rated} onChange={setRated} step={100} testId="sc-rated" />
        <NumInput label="N anclajes" value={count} onChange={setCount} step={1} testId="sc-count" />
      </div>
    </CalcCard>
  );
};

// 10. Slope Stability After Rain
const SlopeCalc: React.FC = () => {
  const [reposeDeg, setReposeDeg] = useState(35);
  const [satDeg, setSatDeg] = useState(8);
  const [slopeDeg, setSlopeDeg] = useState(40);
  const [heightM, setHeightM] = useState(10);
  const [waterTable, setWaterTable] = useState(2);

  const node = useMemo(() => {
    const reposeRad = (reposeDeg * Math.PI) / 180;
    const satRad = (satDeg * Math.PI) / 180;
    const slopeRad = (slopeDeg * Math.PI) / 180;
    return generateSlopeStabilityNode(
      { id: 'mat-ui', dryReposeAngleRad: reposeRad, saturationReductionRad: satRad },
      { id: 'slope-ui', slopeAngleRad: slopeRad, heightM },
      { waterTableDepthM: waterTable, waterDensityKgM3: 1000 },
    );
  }, [reposeDeg, satDeg, slopeDeg, heightM, waterTable]);
  usePersistNode(node);
  return (
    <CalcCard
      title="Estabilidad de talud post-lluvia"
      subtitle="DS 132 Art. 32 / Eurocódigo 7"
      icon={Mountain}
      controlId="HAZARD_IDENTIFICATION"
      node={node}
    >
      <div className="grid grid-cols-3 gap-2">
        <NumInput label="θ reposo seco (°)" value={reposeDeg} onChange={setReposeDeg} />
        <NumInput label="Δθ saturación (°)" value={satDeg} onChange={setSatDeg} />
        <NumInput label="θ talud (°)" value={slopeDeg} onChange={setSlopeDeg} />
        <NumInput label="Altura (m)" value={heightM} onChange={setHeightM} />
        <NumInput label="z napa (m)" value={waterTable} onChange={setWaterTable} />
      </div>
    </CalcCard>
  );
};

// 11. Micro Wind Energy
const MicroWindCalc: React.FC = () => {
  const [funnel, setFunnel] = useState(1.4);
  const [rotor, setRotor] = useState(0.5);
  const [windKmh, setWindKmh] = useState(35);
  const node = useMemo(
    () =>
      generateMicroWindNode(
        { id: 'site-ui', funnelFactor: funnel, rotorAreaM2: rotor },
        { windKmh },
      ),
    [funnel, rotor, windKmh],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Micro-eólica para sensores"
      subtitle="IEC 61400-2 / Betz"
      icon={Cpu}
      controlId="OPERATIONAL_CONTROL"
      node={node}
    >
      <div className="grid grid-cols-3 gap-2">
        <NumInput label="Embudo" value={funnel} onChange={setFunnel} />
        <NumInput label="A rotor (m²)" value={rotor} onChange={setRotor} />
        <NumInput label="Viento (km/h)" value={windKmh} onChange={setWindKmh} />
      </div>
    </CalcCard>
  );
};

// 12. SLAM Photogrammetry Node
const SlamCalc: React.FC = () => {
  const [keyframes, setKeyframes] = useState(120);
  const [coverage, setCoverage] = useState(78);
  const node = useMemo(
    () =>
      generateSlamMeshNode(
        { id: 'cam-ui', keyframeCount: keyframes, coveragePercent: coverage },
        { id: 'project-ui' },
      ),
    [keyframes, coverage],
  );
  usePersistNode(node);
  return (
    <CalcCard
      title="Malla SLAM (gemelo digital)"
      subtitle="DS 43/2015 / NFPA 30"
      icon={Cpu}
      controlId="OPERATIONAL_CONTROL"
      node={node}
    >
      <div className="grid grid-cols-2 gap-2">
        <NumInput label="Keyframes" value={keyframes} onChange={setKeyframes} step={1} />
        <NumInput label="Cobertura (%)" value={coverage} onChange={setCoverage} />
      </div>
    </CalcCard>
  );
};

// ─── Page shell ─────────────────────────────────────────────────────────────

export const CalculatorHub: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('atmospheres');

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">
          Calculadoras Especializadas
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          12 generadores Bernoulli/Euler con citas normativas e indexación al Zettelkasten.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              data-testid={`tab-${key}`}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-[#4db6ac] text-[#4db6ac]'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {tab === 'atmospheres' && (
          <>
            <ConfinedSpaceCalc />
            <GasDispersionCalc />
            <GasLeakCalc />
            <MistingCalc />
            <RespiratorCalc />
            <PulmonaryCalc />
          </>
        )}
        {tab === 'hydraulics' && (
          <>
            <DikeCalc />
            <HidranteCalc />
          </>
        )}
        {tab === 'structural' && (
          <>
            <ScaffoldCalc />
            <SlopeCalc />
          </>
        )}
        {tab === 'aero' && (
          <>
            <MicroWindCalc />
            <SlamCalc />
          </>
        )}
      </div>
    </div>
  );
};

export default CalculatorHub;

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Layout,
  Loader2,
  MapPin,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Search,
  User as UserIcon,
  Clock,
} from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useFirebase } from '../../contexts/FirebaseContext';
import { NodeType, type Worker } from '../../types';
import { calculateReba, type RebaInput, type RebaResult } from '../../services/ergonomics/reba';
import { calculateRula, type RulaInput, type RulaResult } from '../../services/ergonomics/rula';
import { recordErgonomicAssessment } from '../../services/safety/ergonomicAssessments';
import { logger } from '../../utils/logger';

interface AddErgonomicsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  /**
   * Optional pre-selected worker (e.g. deep-link). When omitted, the
   * modal's Step 0 lets the prevencionista pick one. Round 17 (R4)
   * UX evolution: search + 5 most recent + full list.
   */
  workerId?: string;
  /**
   * Workers in scope (filtered by current project). Passed in by the
   * parent so the modal doesn't open its own Firestore subscription.
   */
  workers?: Worker[];
}

type WizardKind = 'REBA' | 'RULA';

/**
 * Default values for the guided wizard. The user MUST advance through all
 * steps before the deterministic engine runs — we never silently substitute
 * a missing field with a "neutral" value behind their back. If a field is
 * left blank, the angle defaults to 0 only because the engine still produces
 * a valid (lowest-severity) result; the UI shows the resulting low-risk
 * actionLevel so the prevencionista can see whether they captured enough
 * data. The "Calcular" button is the explicit acknowledgement that the
 * inputs are complete.
 */
const DEFAULT_REBA_INPUT: RebaInput = {
  trunk: { flexionDeg: 0, twisted: false, sideBent: false },
  neck: { flexionDeg: 0, twisted: false, sideBent: false },
  legs: { bilateralSupport: true, kneeFlexionDeg: 0 },
  upperArm: { flexionDeg: 0, shoulderRaised: false, abducted: false, supported: false },
  lowerArm: { flexionDeg: 90 },
  wrist: { flexionDeg: 0, twistedOrDeviated: false },
  load: { kg: 0, shockOrRapid: false },
  coupling: 'good',
  activity: { staticOver1Min: false, repeatedSmallRange: false, rapidLargeRangeChanges: false },
};

const DEFAULT_RULA_INPUT: RulaInput = {
  upperArm: { flexionDeg: 0, shoulderRaised: false, abducted: false, supported: false },
  lowerArm: { flexionDeg: 90, acrossMidlineOrOut: false },
  wrist: { flexionDeg: 0, deviated: false },
  wristTwist: 'mid',
  neck: { flexionDeg: 0, inExtension: false, twisted: false, sideBent: false },
  trunk: { flexionDeg: 0, wellSupported: false, twisted: false, sideBent: false },
  legs: { supportedAndBalanced: true },
  muscleUse: { staticOver1Min: false, repeatedOver4Min: false },
  force: { kg: 0, pattern: 'intermittent' },
};

const REBA_ACTION_LEVEL_LABEL: Record<RebaResult['actionLevel'], string> = {
  negligible: 'Insignificante',
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  very_high: 'Muy alto',
};

const RULA_ACTION_LEVEL_LABEL: Record<RulaResult['actionLevel'], string> = {
  1: 'Aceptable',
  2: 'Investigar',
  3: 'Investigar pronto',
  4: 'Cambiar inmediatamente',
};

const ACTION_LEVEL_TONE: Record<string, string> = {
  Insignificante: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  Bajo: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  Aceptable: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  Medio: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  Investigar: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  'Investigar pronto': 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  Alto: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  'Muy alto': 'bg-rose-500/10 text-rose-500 border-rose-500/30',
  'Cambiar inmediatamente': 'bg-rose-500/10 text-rose-500 border-rose-500/30',
};

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}

function NumberField({ label, value, onChange, hint, min, max, step = 1 }: NumberFieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">{label}</label>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(Number.isFinite(next) ? next : 0);
        }}
        className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
      />
      {hint && <p className="text-[10px] text-zinc-500 ml-1">{hint}</p>}
    </div>
  );
}

interface CheckboxRowProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function CheckboxRow({ label, checked, onChange }: CheckboxRowProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer text-sm text-zinc-700 dark:text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-orange-500"
      />
      <span>{label}</span>
    </label>
  );
}

export function AddErgonomicsModal({
  isOpen,
  onClose,
  projectId,
  workerId: workerIdProp,
  workers = [],
}: AddErgonomicsModalProps) {
  const { addNode, nodes } = useRiskEngine();
  const { user } = useFirebase();
  const [loading, setLoading] = useState(false);
  const [workstation, setWorkstation] = useState('');
  const [observations, setObservations] = useState('');
  const [kind, setKind] = useState<WizardKind>('REBA');
  const [step, setStep] = useState(0);
  const [reba, setReba] = useState<RebaInput>(DEFAULT_REBA_INPUT);
  const [rula, setRula] = useState<RulaInput>(DEFAULT_RULA_INPUT);
  const [error, setError] = useState<string | null>(null);
  // Round 17 (R4): worker selector lives inside the modal as Step 0.
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | undefined>(workerIdProp);
  const [workerSearch, setWorkerSearch] = useState('');

  useEffect(() => {
    setSelectedWorkerId(workerIdProp);
  }, [workerIdProp]);

  const workerId = selectedWorkerId;

  // The wizard now has Step 0 = worker selector. Subsequent steps use
  // `wizardStepIndex = step - 1` so the existing renderRebaStep /
  // renderRulaStep cases (0..N) still match.
  const REBA_STEPS = 7;
  const RULA_STEPS = 6;
  const wizardSteps = kind === 'REBA' ? REBA_STEPS : RULA_STEPS;
  const totalSteps = wizardSteps + 1; // +1 for worker selector
  const wizardStepIndex = step - 1;

  // Recently assessed workers — derived from the in-memory risk graph
  // (NodeType.ERGONOMICS) sorted by metadata.signedAt desc. Reusing
  // `useRiskEngine` keeps a single source of truth and avoids opening
  // a second Firestore subscription inside the modal.
  const recentWorkers = useMemo<Worker[]>(() => {
    const ergoForProject = nodes
      .filter(
        (n) =>
          n.type === NodeType.ERGONOMICS &&
          (projectId ? n.projectId === projectId : true) &&
          n.metadata?.workerId,
      )
      .sort((a, b) => {
        const ta = String(a.metadata?.signedAt || a.metadata?.date || a.updatedAt || '');
        const tb = String(b.metadata?.signedAt || b.metadata?.date || b.updatedAt || '');
        return tb.localeCompare(ta);
      });
    const seen = new Set<string>();
    const ordered: Worker[] = [];
    for (const n of ergoForProject) {
      const id = String(n.metadata.workerId);
      if (seen.has(id)) continue;
      seen.add(id);
      const w = workers.find((wk) => wk.id === id);
      if (w) ordered.push(w);
      if (ordered.length >= 5) break;
    }
    return ordered;
  }, [nodes, projectId, workers]);

  const filteredWorkers = useMemo<Worker[]>(() => {
    const q = workerSearch.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter((w) =>
      [w.name, w.role, w.email, w.id]
        .filter((v): v is string => typeof v === 'string')
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [workers, workerSearch]);

  const selectedWorker = useMemo(
    () => workers.find((w) => w.id === selectedWorkerId),
    [workers, selectedWorkerId],
  );

  const result: RebaResult | RulaResult | null = useMemo(() => {
    try {
      return kind === 'REBA' ? calculateReba(reba) : calculateRula(rula);
    } catch (err) {
      logger.warn('ergonomics_calc_failed', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, [kind, reba, rula]);

  const score = result
    ? 'finalScore' in result
      ? result.finalScore
      : 0
    : 0;
  const actionLevelLabel = useMemo(() => {
    if (!result) return null;
    if (kind === 'REBA') {
      const r = result as RebaResult;
      return REBA_ACTION_LEVEL_LABEL[r.actionLevel];
    }
    const r = result as RulaResult;
    return RULA_ACTION_LEVEL_LABEL[r.actionLevel];
  }, [result, kind]);

  const reset = () => {
    setStep(0);
    setReba(DEFAULT_REBA_INPUT);
    setRula(DEFAULT_RULA_INPUT);
    setWorkstation('');
    setObservations('');
    setError(null);
    // Round 17 (R4): also clear the in-modal worker selection unless
    // the parent supplied a fixed `workerIdProp` (deep-link case).
    setSelectedWorkerId(workerIdProp);
    setWorkerSearch('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!result) {
      setError('No se pudo calcular el puntaje. Revisá los inputs.');
      return;
    }
    if (!workstation.trim()) {
      setError('Ingresá el puesto de trabajo evaluado.');
      return;
    }
    if (!user) {
      setError('Debes iniciar sesión para guardar la evaluación.');
      return;
    }
    if (!projectId) {
      setError('Seleccioná un proyecto antes de guardar la evaluación.');
      return;
    }
    // Round 16 (R1): refuse to save without a real worker. The previous
    // fallback wrote `workerId: 'unassigned'` so we don't lose the form
    // submission, but it dirtied the analytics with rows that couldn't
    // be linked back to anyone. Better to block submit and tell the
    // prevencionista to pick a worker first.
    if (!workerId) {
      setError('Seleccione un trabajador antes de guardar la evaluación.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 1. Persist the deterministic assessment (Firestore + audit log).
      const inputs = kind === 'REBA' ? reba : rula;
      const finalScore = 'finalScore' in result ? result.finalScore : 0;
      const actionLevel = result.actionLevel as string | number;

      const persisted = await recordErgonomicAssessment({
        workerId,
        projectId,
        type: kind,
        inputs,
        score: finalScore,
        actionLevel,
        computedAt: new Date().toISOString(),
        authorUid: user.uid,
      });

      // 2. Mirror the assessment into the knowledge graph as an ERGONOMICS
      //    node so the existing Risk Network UI surfaces it. The deterministic
      //    score is the source of truth — we DO NOT let the AI rewrite it.
      await addNode({
        type: NodeType.ERGONOMICS,
        title: `${kind} - ${workstation}`,
        description:
          `Evaluación ergonómica ${kind} en el puesto ${workstation}. ` +
          `Puntaje final: ${finalScore} (${actionLevelLabel}). ` +
          (observations ? `Observaciones: ${observations}` : ''),
        tags: ['ergonomia', kind.toLowerCase(), String(actionLevel)],
        metadata: {
          workstation,
          assessmentType: kind,
          score: finalScore,
          actionLevel,
          actionLevelLabel,
          observations,
          assessmentId: persisted.id,
          status: 'completed',
          date: new Date().toISOString().split('T')[0],
        },
        connections: [],
        projectId,
      });

      close();
    } catch (err) {
      logger.error('ergonomic_assessment_save_failed', err);
      setError(err instanceof Error ? err.message : 'No se pudo guardar la evaluación.');
    } finally {
      setLoading(false);
    }
  };

  // ── Wizard step renderers ──────────────────────────────────────────

  function renderRebaStep(): React.ReactNode {
    switch (wizardStepIndex) {
      case 0:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 1 — Tronco</h3>
            <NumberField
              label="Ángulo de flexión del tronco (°)"
              value={reba.trunk.flexionDeg}
              onChange={(v) => setReba({ ...reba, trunk: { ...reba.trunk, flexionDeg: v } })}
              hint="Negativo = extensión, 0 = erecto, positivo = flexión."
              min={-180}
              max={180}
            />
            <CheckboxRow
              label="Tronco rotado"
              checked={!!reba.trunk.twisted}
              onChange={(v) => setReba({ ...reba, trunk: { ...reba.trunk, twisted: v } })}
            />
            <CheckboxRow
              label="Inclinación lateral del tronco"
              checked={!!reba.trunk.sideBent}
              onChange={(v) => setReba({ ...reba, trunk: { ...reba.trunk, sideBent: v } })}
            />
          </div>
        );
      case 1:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 2 — Cuello</h3>
            <NumberField
              label="Ángulo de flexión del cuello (°)"
              value={reba.neck.flexionDeg}
              onChange={(v) => setReba({ ...reba, neck: { ...reba.neck, flexionDeg: v } })}
              min={-90}
              max={90}
            />
            <CheckboxRow
              label="Cuello rotado"
              checked={!!reba.neck.twisted}
              onChange={(v) => setReba({ ...reba, neck: { ...reba.neck, twisted: v } })}
            />
            <CheckboxRow
              label="Inclinación lateral del cuello"
              checked={!!reba.neck.sideBent}
              onChange={(v) => setReba({ ...reba, neck: { ...reba.neck, sideBent: v } })}
            />
          </div>
        );
      case 2:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 3 — Piernas</h3>
            <CheckboxRow
              label="Soporte bilateral / caminando"
              checked={reba.legs.bilateralSupport}
              onChange={(v) => setReba({ ...reba, legs: { ...reba.legs, bilateralSupport: v } })}
            />
            <NumberField
              label="Flexión de rodilla (°)"
              value={reba.legs.kneeFlexionDeg}
              onChange={(v) => setReba({ ...reba, legs: { ...reba.legs, kneeFlexionDeg: v } })}
              hint="0 = de pie, 30-60° suma +1, >60° suma +2 (excepto sentado)."
              min={0}
              max={180}
            />
          </div>
        );
      case 3:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 4 — Brazo (superior)</h3>
            <NumberField
              label="Flexión del brazo (°)"
              value={reba.upperArm.flexionDeg}
              onChange={(v) => setReba({ ...reba, upperArm: { ...reba.upperArm, flexionDeg: v } })}
              min={-90}
              max={180}
            />
            <CheckboxRow
              label="Hombro elevado"
              checked={!!reba.upperArm.shoulderRaised}
              onChange={(v) => setReba({ ...reba, upperArm: { ...reba.upperArm, shoulderRaised: v } })}
            />
            <CheckboxRow
              label="Brazo abducido"
              checked={!!reba.upperArm.abducted}
              onChange={(v) => setReba({ ...reba, upperArm: { ...reba.upperArm, abducted: v } })}
            />
            <CheckboxRow
              label="Brazo apoyado / postura asistida"
              checked={!!reba.upperArm.supported}
              onChange={(v) => setReba({ ...reba, upperArm: { ...reba.upperArm, supported: v } })}
            />
          </div>
        );
      case 4:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 5 — Antebrazo</h3>
            <NumberField
              label="Flexión del antebrazo (°)"
              value={reba.lowerArm.flexionDeg}
              onChange={(v) => setReba({ ...reba, lowerArm: { flexionDeg: v } })}
              hint="Rango óptimo 60-100°."
              min={0}
              max={180}
            />
          </div>
        );
      case 5:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 6 — Muñeca</h3>
            <NumberField
              label="Flexión de muñeca (°)"
              value={reba.wrist.flexionDeg}
              onChange={(v) => setReba({ ...reba, wrist: { ...reba.wrist, flexionDeg: v } })}
              min={-90}
              max={90}
            />
            <CheckboxRow
              label="Muñeca rotada o desviada"
              checked={!!reba.wrist.twistedOrDeviated}
              onChange={(v) => setReba({ ...reba, wrist: { ...reba.wrist, twistedOrDeviated: v } })}
            />
          </div>
        );
      case 6:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 7 — Carga, agarre y actividad</h3>
            <NumberField
              label="Carga (kg)"
              value={reba.load.kg}
              onChange={(v) => setReba({ ...reba, load: { ...reba.load, kg: v } })}
              min={0}
              max={100}
            />
            <CheckboxRow
              label="Carga aplicada bruscamente o con shock"
              checked={!!reba.load.shockOrRapid}
              onChange={(v) => setReba({ ...reba, load: { ...reba.load, shockOrRapid: v } })}
            />
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Calidad del agarre</label>
              <select
                value={reba.coupling}
                onChange={(e) => setReba({ ...reba, coupling: e.target.value as RebaInput['coupling'] })}
                className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
              >
                <option value="good">Bueno</option>
                <option value="fair">Regular</option>
                <option value="poor">Malo</option>
                <option value="unacceptable">Inaceptable</option>
              </select>
            </div>
            <CheckboxRow
              label="Postura estática (>1 min)"
              checked={!!reba.activity.staticOver1Min}
              onChange={(v) => setReba({ ...reba, activity: { ...reba.activity, staticOver1Min: v } })}
            />
            <CheckboxRow
              label="Movimiento pequeño repetitivo"
              checked={!!reba.activity.repeatedSmallRange}
              onChange={(v) => setReba({ ...reba, activity: { ...reba.activity, repeatedSmallRange: v } })}
            />
            <CheckboxRow
              label="Cambios bruscos de gran amplitud"
              checked={!!reba.activity.rapidLargeRangeChanges}
              onChange={(v) => setReba({ ...reba, activity: { ...reba.activity, rapidLargeRangeChanges: v } })}
            />
          </div>
        );
      default:
        return null;
    }
  }

  function renderRulaStep(): React.ReactNode {
    switch (wizardStepIndex) {
      case 0:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 1 — Brazo (superior)</h3>
            <NumberField
              label="Flexión del brazo (°)"
              value={rula.upperArm.flexionDeg}
              onChange={(v) => setRula({ ...rula, upperArm: { ...rula.upperArm, flexionDeg: v } })}
              min={-90}
              max={180}
            />
            <CheckboxRow
              label="Hombro elevado"
              checked={!!rula.upperArm.shoulderRaised}
              onChange={(v) => setRula({ ...rula, upperArm: { ...rula.upperArm, shoulderRaised: v } })}
            />
            <CheckboxRow
              label="Brazo abducido"
              checked={!!rula.upperArm.abducted}
              onChange={(v) => setRula({ ...rula, upperArm: { ...rula.upperArm, abducted: v } })}
            />
            <CheckboxRow
              label="Brazo apoyado"
              checked={!!rula.upperArm.supported}
              onChange={(v) => setRula({ ...rula, upperArm: { ...rula.upperArm, supported: v } })}
            />
          </div>
        );
      case 1:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 2 — Antebrazo y muñeca</h3>
            <NumberField
              label="Flexión del antebrazo (°)"
              value={rula.lowerArm.flexionDeg}
              onChange={(v) => setRula({ ...rula, lowerArm: { ...rula.lowerArm, flexionDeg: v } })}
              hint="Rango óptimo 60-100°."
              min={0}
              max={180}
            />
            <CheckboxRow
              label="Antebrazo cruza la línea media o queda fuera del cuerpo"
              checked={!!rula.lowerArm.acrossMidlineOrOut}
              onChange={(v) => setRula({ ...rula, lowerArm: { ...rula.lowerArm, acrossMidlineOrOut: v } })}
            />
            <NumberField
              label="Flexión de muñeca (°)"
              value={rula.wrist.flexionDeg}
              onChange={(v) => setRula({ ...rula, wrist: { ...rula.wrist, flexionDeg: v } })}
              min={-90}
              max={90}
            />
            <CheckboxRow
              label="Muñeca desviada"
              checked={!!rula.wrist.deviated}
              onChange={(v) => setRula({ ...rula, wrist: { ...rula.wrist, deviated: v } })}
            />
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Torsión de muñeca</label>
              <select
                value={rula.wristTwist}
                onChange={(e) => setRula({ ...rula, wristTwist: e.target.value as RulaInput['wristTwist'] })}
                className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
              >
                <option value="mid">En rango medio</option>
                <option value="end">Cerca del final del recorrido</option>
              </select>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 3 — Cuello</h3>
            <NumberField
              label="Flexión del cuello (°)"
              value={rula.neck.flexionDeg}
              onChange={(v) => setRula({ ...rula, neck: { ...rula.neck, flexionDeg: v } })}
              min={-90}
              max={90}
            />
            <CheckboxRow
              label="Cuello en extensión"
              checked={!!rula.neck.inExtension}
              onChange={(v) => setRula({ ...rula, neck: { ...rula.neck, inExtension: v } })}
            />
            <CheckboxRow
              label="Cuello rotado"
              checked={!!rula.neck.twisted}
              onChange={(v) => setRula({ ...rula, neck: { ...rula.neck, twisted: v } })}
            />
            <CheckboxRow
              label="Inclinación lateral del cuello"
              checked={!!rula.neck.sideBent}
              onChange={(v) => setRula({ ...rula, neck: { ...rula.neck, sideBent: v } })}
            />
          </div>
        );
      case 3:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 4 — Tronco y piernas</h3>
            <NumberField
              label="Flexión del tronco (°)"
              value={rula.trunk.flexionDeg}
              onChange={(v) => setRula({ ...rula, trunk: { ...rula.trunk, flexionDeg: v } })}
              min={-90}
              max={180}
            />
            <CheckboxRow
              label="Tronco bien apoyado (sentado, caderas/tronco >90°)"
              checked={!!rula.trunk.wellSupported}
              onChange={(v) => setRula({ ...rula, trunk: { ...rula.trunk, wellSupported: v } })}
            />
            <CheckboxRow
              label="Tronco rotado"
              checked={!!rula.trunk.twisted}
              onChange={(v) => setRula({ ...rula, trunk: { ...rula.trunk, twisted: v } })}
            />
            <CheckboxRow
              label="Inclinación lateral del tronco"
              checked={!!rula.trunk.sideBent}
              onChange={(v) => setRula({ ...rula, trunk: { ...rula.trunk, sideBent: v } })}
            />
            <CheckboxRow
              label="Piernas con apoyo y balance"
              checked={rula.legs.supportedAndBalanced}
              onChange={(v) => setRula({ ...rula, legs: { supportedAndBalanced: v } })}
            />
          </div>
        );
      case 4:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 5 — Uso muscular</h3>
            <CheckboxRow
              label="Postura estática mantenida >1 min"
              checked={!!rula.muscleUse.staticOver1Min}
              onChange={(v) => setRula({ ...rula, muscleUse: { ...rula.muscleUse, staticOver1Min: v } })}
            />
            <CheckboxRow
              label="Repetitividad >4 veces/min"
              checked={!!rula.muscleUse.repeatedOver4Min}
              onChange={(v) => setRula({ ...rula, muscleUse: { ...rula.muscleUse, repeatedOver4Min: v } })}
            />
          </div>
        );
      case 5:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Paso 6 — Fuerza / carga</h3>
            <NumberField
              label="Carga (kg)"
              value={rula.force.kg}
              onChange={(v) => setRula({ ...rula, force: { ...rula.force, kg: v } })}
              min={0}
              max={100}
            />
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Patrón de aplicación</label>
              <select
                value={rula.force.pattern}
                onChange={(e) => setRula({ ...rula, force: { ...rula.force, pattern: e.target.value as RulaInput['force']['pattern'] } })}
                className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
              >
                <option value="intermittent">Intermitente</option>
                <option value="static">Estática</option>
                <option value="repeated">Repetida</option>
                <option value="shock">Choque / aplicación brusca</option>
              </select>
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        >
          <div onClick={close} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex justify-between items-center bg-gradient-to-r from-orange-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                  <Layout className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Nueva Evaluación Ergonómica</h2>
                  <p className="text-sm text-zinc-400">
                    {step === 0
                      ? `Paso 1 de ${totalSteps} — Seleccionar trabajador`
                      : `${kind} — Paso ${step + 1} de ${totalSteps}`}
                  </p>
                </div>
              </div>
              <button
                onClick={close}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-5">
              <div className="h-1 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-all"
                  style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
                />
              </div>

              {step === 0 ? (
                /* ── Step 0: Worker selector (Round 17 R4) ─────────── */
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">
                      Buscar trabajador
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        type="text"
                        value={workerSearch}
                        onChange={(e) => setWorkerSearch(e.target.value)}
                        placeholder="Buscar por nombre, rol, email o id…"
                        aria-label="Buscar trabajador"
                        className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-3 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
                      />
                    </div>
                  </div>

                  {recentWorkers.length > 0 && !workerSearch && (
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        Trabajadores recientes
                      </h4>
                      <div className="grid grid-cols-1 gap-2">
                        {recentWorkers.map((w) => (
                          <button
                            key={`recent-${w.id}`}
                            type="button"
                            onClick={() => {
                              setSelectedWorkerId(w.id);
                              setStep(1);
                            }}
                            className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                              selectedWorkerId === w.id
                                ? 'border-orange-500/50 bg-orange-500/10'
                                : 'border-zinc-200 dark:border-white/10 hover:border-orange-500/40 bg-white dark:bg-zinc-800/40'
                            }`}
                          >
                            <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-500">
                              <UserIcon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{w.name || w.id}</p>
                              <p className="text-[10px] text-zinc-500 truncate">{w.role || w.email || w.id}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                      Todos los trabajadores ({filteredWorkers.length})
                    </h4>
                    <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                      {filteredWorkers.length === 0 ? (
                        <p className="text-xs text-zinc-500 italic p-3">
                          No se encontraron trabajadores. Asegurate de tener un proyecto seleccionado y trabajadores cargados.
                        </p>
                      ) : (
                        filteredWorkers.map((w) => (
                          <button
                            key={`all-${w.id}`}
                            type="button"
                            onClick={() => {
                              setSelectedWorkerId(w.id);
                              setStep(1);
                            }}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                              selectedWorkerId === w.id
                                ? 'border-orange-500/50 bg-orange-500/10'
                                : 'border-zinc-200 dark:border-white/10 hover:border-orange-500/40 bg-white dark:bg-zinc-800/40'
                            }`}
                          >
                            <div className="w-7 h-7 rounded-md bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-500 shrink-0">
                              <UserIcon className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">{w.name || w.id}</p>
                              <p className="text-[10px] text-zinc-500 truncate">{w.role || w.email || w.id}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* ── Steps 1..N: Wizard with method/workstation header ─ */
                <>
                  {selectedWorker && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800/40 border border-zinc-200 dark:border-white/5 text-xs">
                      <UserIcon className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-zinc-700 dark:text-zinc-300 font-bold">{selectedWorker.name || selectedWorker.id}</span>
                      <span className="text-zinc-500">— {selectedWorker.role || selectedWorker.email || selectedWorker.id}</span>
                      <button
                        type="button"
                        onClick={() => setStep(0)}
                        className="ml-auto text-orange-500 hover:text-orange-400 underline underline-offset-2"
                      >
                        Cambiar
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Método</label>
                      <select
                        value={kind}
                        onChange={(e) => {
                          setKind(e.target.value as WizardKind);
                          setStep(1); // restart wizard at first wizard step
                        }}
                        className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
                      >
                        <option value="REBA">REBA (cuerpo entero)</option>
                        <option value="RULA">RULA (extremidades superiores)</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Puesto de trabajo</label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                          type="text"
                          value={workstation}
                          onChange={(e) => setWorkstation(e.target.value)}
                          placeholder="Ej: Línea de soldadura 02"
                          className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-3 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  {kind === 'REBA' ? renderRebaStep() : renderRulaStep()}

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">
                      Observaciones (opcional)
                    </label>
                    <textarea
                      value={observations}
                      onChange={(e) => setObservations(e.target.value)}
                      placeholder="Detalles adicionales del puesto observado..."
                      rows={2}
                      className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm resize-none"
                    />
                  </div>
                </>
              )}

              {step !== 0 && result && actionLevelLabel && (
                <div
                  className={`flex items-center justify-between p-4 rounded-xl border ${ACTION_LEVEL_TONE[actionLevelLabel] ?? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700'}`}
                >
                  <div>
                    <p className="text-[11px] uppercase tracking-wider font-bold opacity-70">Puntaje {kind}</p>
                    <p className="text-2xl font-black tracking-tight">{score}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wider font-bold opacity-70">Nivel de acción</p>
                    <p className="text-sm font-bold">{actionLevelLabel}</p>
                  </div>
                </div>
              )}

              {error && (
                <div role="alert" className="flex items-start gap-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 shrink-0 flex justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-900 dark:text-white bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Atrás
              </button>
              {step < totalSteps - 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(totalSteps - 1, s + 1))}
                  disabled={step === 0 && !selectedWorkerId}
                  title={step === 0 && !selectedWorkerId ? 'Seleccione un trabajador para continuar' : undefined}
                  className="px-4 py-2 rounded-xl bg-orange-500 text-white font-medium text-sm hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-orange-500 flex items-center gap-2"
                >
                  Siguiente
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl bg-orange-500 text-white font-medium text-sm hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar evaluación</span>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

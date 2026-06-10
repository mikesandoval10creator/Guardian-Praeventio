import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Star, Lock, ChevronDown, ChevronRight, Award, Users, User as UserIcon } from 'lucide-react';
import { awardXp, MEDALLAS, evaluateMedallas, type MedallaStats } from '../../services/gamification/positiveXp';

export interface Skill {
  id: string;
  name: string;
  description: string;
  level: 1 | 2 | 3;
  unlocked: boolean;
  prerequisiteIds?: string[];
}

interface SkillTreeProps {
  skills?: Skill[];
  workerId?: string;
  workerName?: string;
  /** Sprint 16 — collective stats used to render medallas. */
  crewStats?: MedallaStats;
  individualStats?: MedallaStats;
  crewName?: string;
}

const DEFAULT_SKILLS: Skill[] = [
  { id: 'rcp1',    name: 'RCP Básico',           description: 'Compresiones y ventilaciones 30:2', level: 1, unlocked: true  },
  { id: 'rcp2',    name: 'RCP Avanzado',          description: 'Uso de DEA y manejo de vía aérea',  level: 2, unlocked: false, prerequisiteIds: ['rcp1'] },
  { id: 'rcp3',    name: 'Instructor RCP',        description: 'Certificado para entrenar equipos', level: 3, unlocked: false, prerequisiteIds: ['rcp2'] },
  { id: 'triage1', name: 'Triage START',           description: 'Clasificación rápida de víctimas', level: 1, unlocked: true  },
  { id: 'triage2', name: 'Triage Avanzado',        description: 'SALT / JumpSTART en múltiples víctimas', level: 2, unlocked: false, prerequisiteIds: ['triage1'] },
  { id: 'rescue1', name: 'Rescate Básico',         description: 'Extricación y traslado seguro',    level: 1, unlocked: true  },
  { id: 'rescue2', name: 'Rescate en Altura',      description: 'Cuerdas y descuelgue de personas', level: 2, unlocked: false, prerequisiteIds: ['rescue1'] },
  { id: 'rescue3', name: 'Espacios Confinados',    description: 'Entrada y rescate en espacios confinados', level: 3, unlocked: false, prerequisiteIds: ['rescue2'] },
  { id: 'hazmat1', name: 'HAZMAT Nivel I',         description: 'Reconocimiento y alerta de peligro', level: 1, unlocked: false },
  { id: 'hazmat2', name: 'HAZMAT Nivel II',        description: 'Contención defensiva y EPP especial', level: 2, unlocked: false, prerequisiteIds: ['hazmat1'] },
];

const LEVEL_COLORS: Record<number, string> = {
  1: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
  2: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
  3: 'border-violet-500/50 bg-violet-500/10 text-violet-400',
};

const LEVEL_BADGE: Record<number, string> = { 1: 'Nivel I', 2: 'Nivel II', 3: 'Nivel III' };

const BRANCHES = ['RCP', 'Triage', 'Rescate', 'HAZMAT'];
const PREFIX_MAP: Record<string, string> = { RCP: 'rcp', Triage: 'triage', Rescate: 'rescue', HAZMAT: 'hazmat' };

const ZERO_STATS: MedallaStats = {
  totalProcessesCompleted: 0,
  daysWithoutIncident: 0,
  alertsResponded: 0,
  wisdomCapsulesCompleted: 0,
  nearMissesReported: 0,
};

/**
 * Sprint 16 — Flow Infinito policy.
 * If any caller imports this and tries to remove XP, no-op + warn. The
 * positive-only XP API is the only legitimate path; this shim exists so a
 * grep for decrementXp/deductXp/removeXp surfaces THIS file (the
 * documented policy gate) instead of disappearing into nothing.
 */
export function decrementXp(_amount: number, _reason?: string): void {

  console.warn('[SkillTree] decrement attempted; ignored — Flow Infinito policy');
}
export const deductXp = decrementXp;
export const removeXp = decrementXp;
export const subtractXp = decrementXp;

/** Re-export so callers can use the canonical positive API. */
export { awardXp };

interface MedallaCardProps {
  id: string;
  label: string;
  description: string;
  unlocked: boolean;
}

function MedallaCard({ id, label, description, unlocked }: MedallaCardProps) {
  // Preload via <link rel="preload"> would require app-level wiring; using
  // a simple <img> with loading="eager" achieves the same UX for 5 small
  // SVGs. Grayscale filter when locked.
  return (
    <div className={`relative flex flex-col items-center gap-1 p-2 rounded-xl border ${
      unlocked
        ? 'border-amber-500/30 bg-amber-500/5'
        : 'border-zinc-800 bg-zinc-900/40'
    }`}>
      <img
        src={`/medallas/${id}.svg`}
        alt={label}
        width={64}
        height={64}
        loading="eager"
        decoding="async"
        className={unlocked ? '' : 'grayscale opacity-50'}
      />
      <p className={`text-[10px] font-bold text-center leading-tight ${unlocked ? 'text-amber-400' : 'text-zinc-500'}`}>
        {label}
      </p>
      <p className="text-[9px] text-zinc-500 text-center leading-tight">{description}</p>
      {!unlocked && (
        <span className="absolute top-1 right-1 text-zinc-600">
          <Lock className="w-3 h-3" />
        </span>
      )}
    </div>
  );
}

export function SkillTree({ skills = DEFAULT_SKILLS, workerName, crewName, crewStats, individualStats }: SkillTreeProps) {
  const [expandedBranch, setExpandedBranch] = useState<string | null>('RCP');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [track, setTrack] = useState<'individual' | 'crew'>('individual');

  const unlockedCount = skills.filter(s => s.unlocked).length;

  const stats = (track === 'crew' ? crewStats : individualStats) ?? ZERO_STATS;
  const unlockedMedalIds = new Set(evaluateMedallas(stats));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/20 rounded-xl">
            <Award className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-widest">Árbol de Habilidades</h3>
            {workerName && <p className="text-[10px] text-zinc-400">{workerName}</p>}
          </div>
        </div>
        <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <span className="text-xs font-black text-amber-400">{unlockedCount}/{skills.length} Skills</span>
        </div>
      </div>

      {/* Dual-track switch */}
      <div className="flex rounded-xl overflow-hidden border border-zinc-800">
        <button
          onClick={() => setTrack('individual')}
          // Audit P0 §1.1 — WCAG 2.5.5 + Apple HIG 44pt + Material 48dp: min 44x44 touch target.
          className={`flex-1 min-h-11 flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-colors ${
            track === 'individual' ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <UserIcon className="w-3.5 h-3.5" /> Mi camino
        </button>
        <button
          onClick={() => setTrack('crew')}
          // Audit P0 §1.1 — WCAG 2.5.5 + Apple HIG 44pt + Material 48dp: min 44x44 touch target.
          className={`flex-1 min-h-11 flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-colors ${
            track === 'crew' ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Users className="w-3.5 h-3.5" /> Mi cuadrilla
        </button>
      </div>

      {track === 'crew' && crewName && (
        <p className="text-[10px] text-emerald-400 text-center -mt-2">Cuadrilla: {crewName}</p>
      )}

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${track === 'crew' ? 'bg-gradient-to-r from-emerald-500 to-amber-500' : 'bg-gradient-to-r from-amber-500 to-emerald-500'}`}
          initial={{ width: 0 }}
          animate={{ width: `${(unlockedCount / skills.length) * 100}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>

      {/* Medallas grid (5 fixed) */}
      <section>
        <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">
          Medallas {track === 'crew' ? 'colectivas' : 'personales'}
        </h4>
        <div className="grid grid-cols-5 gap-2">
          {MEDALLAS.map((m) => (
            <MedallaCard
              key={m.id}
              id={m.id}
              label={m.label}
              description={m.description}
              unlocked={unlockedMedalIds.has(m.id)}
            />
          ))}
        </div>
      </section>

      {/* Branch tree */}
      <div className="space-y-2">
        {BRANCHES.map(branch => {
          const prefix = PREFIX_MAP[branch];
          const branchSkills = skills.filter(s => s.id.startsWith(prefix)).sort((a, b) => a.level - b.level);
          const isOpen = expandedBranch === branch;

          return (
            <div key={branch} className="rounded-xl border border-zinc-800 overflow-hidden">
              <button
                onClick={() => setExpandedBranch(isOpen ? null : branch)}
                className="w-full flex items-center justify-between px-4 py-3 bg-zinc-900/60 hover:bg-zinc-900/80 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-zinc-400" />
                  <span className="text-xs font-black text-white uppercase tracking-wider">{branch}</span>
                  <span className="text-[10px] text-zinc-500">
                    {branchSkills.filter(s => s.unlocked).length}/{branchSkills.length}
                  </span>
                </div>
                {isOpen ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
              </button>

              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 space-y-2 bg-black/20">
                      {branchSkills.map((skill, idx) => (
                        <div key={skill.id} className="flex items-start gap-2">
                          {idx > 0 && (
                            <div className="absolute ml-3.5 -mt-2 w-px h-2 bg-zinc-700" />
                          )}
                          <motion.button
                            onClick={() => setSelectedSkill(selectedSkill?.id === skill.id ? null : skill)}
                            whileHover={{ scale: 1.01 }}
                            className={`flex-1 flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                              skill.unlocked
                                ? LEVEL_COLORS[skill.level]
                                : 'border-zinc-800 bg-zinc-900/40 text-zinc-600'
                            } ${selectedSkill?.id === skill.id ? 'ring-1 ring-white/20' : ''}`}
                          >
                            <div className="shrink-0">
                              {skill.unlocked
                                ? <Star className="w-4 h-4 fill-current" />
                                : <Lock className="w-4 h-4" />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold truncate">{skill.name}</p>
                              <p className="text-[10px] opacity-70 mt-0.5 truncate">{skill.description}</p>
                            </div>
                            <span className="text-[9px] font-black uppercase tracking-widest shrink-0 opacity-70">
                              {LEVEL_BADGE[skill.level]}
                            </span>
                          </motion.button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

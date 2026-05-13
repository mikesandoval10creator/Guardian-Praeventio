// Praeventio Guard — Sprint 51 §246-249: Skill Gap Analyzer + Polivalencia +
// Plan de capacitación por brechas.
//
// Cierra §246 (rotación / cross-training), §247 (plan capacitación brecha
// individual), §248 (matriz polivalencia), §249 (sustitución entre
// trabajadores por skill) de la 2da tanda usuario.
//
// 100% determinístico. Toma snapshots de skills + roles requeridos +
// plantillas de capacitación → genera planes individuales + matriz cuadrilla.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SkillProficiencyLevel =
  | 'none'              // 0 — no aplica
  | 'aware'             // 1 — sabe que existe (sólo charla)
  | 'novice'            // 2 — capacitado pero requiere supervisión
  | 'competent'         // 3 — autorizado autónomo
  | 'proficient'        // 4 — puede enseñar / coachear
  | 'expert';           // 5 — referente técnico

const LEVEL_RANK: Record<SkillProficiencyLevel, number> = {
  none: 0,
  aware: 1,
  novice: 2,
  competent: 3,
  proficient: 4,
  expert: 5,
};

export interface WorkerSkill {
  workerUid: string;
  skillId: string;
  level: SkillProficiencyLevel;
  /** Fecha de certificación o última evaluación. */
  attainedAt: string;
  /** Si la certificación tiene vigencia, fecha de expiración. */
  expiresAt?: string;
  /** UID de quien certificó (instructor / supervisor). */
  certifiedByUid?: string;
}

export interface RequiredSkill {
  skillId: string;
  /** Nivel mínimo aceptable. */
  minLevel: SkillProficiencyLevel;
  /** Si el skill es crítico (la cuadrilla no puede operar sin él). */
  critical: boolean;
  /** Trabajo donde aplica. */
  appliesToTaskCategory?: string;
}

export interface SkillDefinition {
  id: string;
  /** Nombre humano. */
  name: string;
  /** Curso/training canónico para alcanzar level. */
  trainingProgramByLevel: Record<SkillProficiencyLevel, { hours: number; provider?: string }>;
  /** Vigencia en meses (0 = sin vencimiento). */
  validityMonths: number;
  category: 'safety' | 'operational' | 'regulatory' | 'leadership' | 'technical';
}

// ────────────────────────────────────────────────────────────────────────
// Gap detection
// ────────────────────────────────────────────────────────────────────────

export interface SkillGap {
  workerUid: string;
  skillId: string;
  currentLevel: SkillProficiencyLevel;
  requiredLevel: SkillProficiencyLevel;
  gapLevels: number;
  critical: boolean;
  /** Si la cert venció. */
  expired?: boolean;
}

export interface AnalyzeGapsOptions {
  /** Fecha de evaluación — para detectar expiradas. */
  now: Date;
}

export function analyzeWorkerGaps(
  workerSkills: ReadonlyArray<WorkerSkill>,
  requirements: ReadonlyArray<RequiredSkill>,
  options: AnalyzeGapsOptions,
): SkillGap[] {
  const workerUid = workerSkills[0]?.workerUid ?? '';
  const gaps: SkillGap[] = [];
  const skillsById = new Map(workerSkills.map((s) => [s.skillId, s] as const));
  const nowMs = options.now.getTime();

  for (const req of requirements) {
    const has = skillsById.get(req.skillId);
    const hasLevel = has?.level ?? 'none';
    const expired = has?.expiresAt ? Date.parse(has.expiresAt) < nowMs : false;
    const effectiveLevel = expired ? 'none' : hasLevel;
    const gapLevels = Math.max(0, LEVEL_RANK[req.minLevel] - LEVEL_RANK[effectiveLevel]);

    if (gapLevels > 0) {
      gaps.push({
        workerUid,
        skillId: req.skillId,
        currentLevel: effectiveLevel,
        requiredLevel: req.minLevel,
        gapLevels,
        critical: req.critical,
        expired: expired || undefined,
      });
    }
  }

  return gaps;
}

// ────────────────────────────────────────────────────────────────────────
// Individual training plan (§247)
// ────────────────────────────────────────────────────────────────────────

export interface TrainingStep {
  skillId: string;
  skillName: string;
  fromLevel: SkillProficiencyLevel;
  toLevel: SkillProficiencyLevel;
  estimatedHours: number;
  provider?: string;
  /** Si es bloqueante para que el worker pueda hacer su trabajo. */
  critical: boolean;
}

export interface TrainingPlan {
  workerUid: string;
  generatedAt: string;
  steps: TrainingStep[];
  totalHours: number;
  criticalHours: number;
  /** Fecha estimada de completion si se dedica 4 horas/semana. */
  estimatedCompletionWeeks: number;
  /** Si el worker NO puede operar hoy (bloqueado por críticas). */
  blockedFromOperation: boolean;
}

export function buildTrainingPlan(
  gaps: ReadonlyArray<SkillGap>,
  skillsCatalog: ReadonlyArray<SkillDefinition>,
  options: { now: Date; hoursPerWeek?: number },
): TrainingPlan {
  const catalog = new Map(skillsCatalog.map((s) => [s.id, s] as const));
  const steps: TrainingStep[] = [];
  for (const gap of gaps) {
    const def = catalog.get(gap.skillId);
    if (!def) continue;
    const requiredProgram = def.trainingProgramByLevel[gap.requiredLevel];
    if (!requiredProgram) continue;
    steps.push({
      skillId: gap.skillId,
      skillName: def.name,
      fromLevel: gap.currentLevel,
      toLevel: gap.requiredLevel,
      estimatedHours: requiredProgram.hours,
      provider: requiredProgram.provider,
      critical: gap.critical,
    });
  }

  // Sort: críticas primero, luego más cortas (quick wins)
  steps.sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    return a.estimatedHours - b.estimatedHours;
  });

  const totalHours = steps.reduce((s, st) => s + st.estimatedHours, 0);
  const criticalHours = steps.filter((s) => s.critical).reduce((s, st) => s + st.estimatedHours, 0);
  const hoursPerWeek = options.hoursPerWeek ?? 4;
  const blockedFromOperation = steps.some((s) => s.critical);
  const workerUid = gaps[0]?.workerUid ?? '';

  return {
    workerUid,
    generatedAt: options.now.toISOString(),
    steps,
    totalHours,
    criticalHours,
    estimatedCompletionWeeks: Math.ceil(totalHours / hoursPerWeek),
    blockedFromOperation,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Polyvalence matrix (§248)
// ────────────────────────────────────────────────────────────────────────

export interface CrewMember {
  uid: string;
  name?: string;
  skills: WorkerSkill[];
}

export interface PolyvalenceMatrix {
  crewSize: number;
  skillIds: string[];
  /** Para cada skill, cuántos crew members tienen al menos competent. */
  coverageBySkill: Record<string, { count: number; ratio: number }>;
  /** Skills con ≤1 persona competent (single point of failure). */
  singleCovered: string[];
  /** Skills con 0 cobertura (riesgo crítico). */
  zeroCovered: string[];
  /** Score 0-100: balance de cobertura + redundancia. */
  polyvalenceScore: number;
  /** Recomendaciones para mejorar polivalencia. */
  recommendations: string[];
}

export function buildPolyvalenceMatrix(
  crew: ReadonlyArray<CrewMember>,
  requiredSkills: ReadonlyArray<RequiredSkill>,
  options: { now: Date },
): PolyvalenceMatrix {
  const nowMs = options.now.getTime();
  const coverageBySkill: Record<string, { count: number; ratio: number }> = {};
  const singleCovered: string[] = [];
  const zeroCovered: string[] = [];

  for (const req of requiredSkills) {
    let count = 0;
    for (const member of crew) {
      const has = member.skills.find((s) => s.skillId === req.skillId);
      if (!has) continue;
      const expired = has.expiresAt ? Date.parse(has.expiresAt) < nowMs : false;
      if (expired) continue;
      if (LEVEL_RANK[has.level] >= LEVEL_RANK[req.minLevel]) count += 1;
    }
    const ratio = crew.length === 0 ? 0 : count / crew.length;
    coverageBySkill[req.skillId] = { count, ratio };
    if (count === 0) zeroCovered.push(req.skillId);
    else if (count === 1) singleCovered.push(req.skillId);
  }

  // Score: 100 si todas tienen ≥2 covered, penaltiza single y zero
  let polyvalenceScore = 100;
  polyvalenceScore -= zeroCovered.length * 25;
  polyvalenceScore -= singleCovered.length * 10;
  polyvalenceScore = Math.max(0, polyvalenceScore);

  const recommendations: string[] = [];
  for (const sid of zeroCovered) {
    recommendations.push(`URGENTE: Capacitar al menos 1 miembro en ${sid} (cobertura 0).`);
  }
  for (const sid of singleCovered.slice(0, 5)) {
    recommendations.push(`Backup: Sólo 1 persona certificada en ${sid} — capacitar un segundo para evitar SPOF.`);
  }

  return {
    crewSize: crew.length,
    skillIds: requiredSkills.map((r) => r.skillId),
    coverageBySkill,
    singleCovered,
    zeroCovered,
    polyvalenceScore,
    recommendations: recommendations.slice(0, 8),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Substitution finder (§249)
// ────────────────────────────────────────────────────────────────────────

export interface SubstitutionCandidate {
  candidateUid: string;
  matchedSkills: string[];
  /** Skills requeridos que el candidato NO tiene. */
  missingSkills: string[];
  /** Score 0..1 — fracción de skills requeridos cubiertos. */
  coverageScore: number;
  /** Si puede reemplazar sin gaps críticos. */
  canSubstituteSafely: boolean;
}

export function findSubstitutes(
  crew: ReadonlyArray<CrewMember>,
  absentUid: string,
  requirementsForRole: ReadonlyArray<RequiredSkill>,
  options: { now: Date },
): SubstitutionCandidate[] {
  const nowMs = options.now.getTime();
  const candidates: SubstitutionCandidate[] = [];

  for (const member of crew) {
    if (member.uid === absentUid) continue;
    const matched: string[] = [];
    const missing: string[] = [];
    let criticalMissing = false;
    for (const req of requirementsForRole) {
      const has = member.skills.find((s) => s.skillId === req.skillId);
      const expired = has?.expiresAt ? Date.parse(has.expiresAt) < nowMs : false;
      const okLevel = has && !expired && LEVEL_RANK[has.level] >= LEVEL_RANK[req.minLevel];
      if (okLevel) {
        matched.push(req.skillId);
      } else {
        missing.push(req.skillId);
        if (req.critical) criticalMissing = true;
      }
    }
    const total = requirementsForRole.length || 1;
    candidates.push({
      candidateUid: member.uid,
      matchedSkills: matched,
      missingSkills: missing,
      coverageScore: matched.length / total,
      canSubstituteSafely: !criticalMissing,
    });
  }

  // Order: safe substitutes first, then by coverageScore desc
  candidates.sort((a, b) => {
    if (a.canSubstituteSafely !== b.canSubstituteSafely) {
      return a.canSubstituteSafely ? -1 : 1;
    }
    return b.coverageScore - a.coverageScore;
  });

  return candidates;
}

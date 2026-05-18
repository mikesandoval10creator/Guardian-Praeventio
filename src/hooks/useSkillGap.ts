// Praeventio Guard — Skill Gap Analyzer client hook (4 stateless mutators).

import { auth } from '../services/firebase';
import type {
  CrewMember,
  PolyvalenceMatrix,
  RequiredSkill,
  SkillDefinition,
  SkillGap,
  SubstitutionCandidate,
  TrainingPlan,
  WorkerSkill,
} from '../services/skillGap/skillGapAnalyzer';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. analyze-gaps ────────────────────────────────────────────────────

export interface AnalyzeGapsInput {
  workerSkills: WorkerSkill[];
  requirements: RequiredSkill[];
  now?: string;
}
export interface AnalyzeGapsResponse {
  gaps: SkillGap[];
}

export async function analyzeWorkerSkillGaps(
  projectId: string,
  input: AnalyzeGapsInput,
): Promise<AnalyzeGapsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/skills/analyze-gaps`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AnalyzeGapsResponse>(res);
}

// ── 2. build-training-plan ─────────────────────────────────────────────

export interface BuildTrainingPlanInput {
  gaps: SkillGap[];
  skillsCatalog: SkillDefinition[];
  now?: string;
  hoursPerWeek?: number;
}
export interface BuildTrainingPlanResponse {
  plan: TrainingPlan;
}

export async function buildWorkerTrainingPlan(
  projectId: string,
  input: BuildTrainingPlanInput,
): Promise<BuildTrainingPlanResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/skills/build-training-plan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildTrainingPlanResponse>(res);
}

// ── 3. polyvalence-matrix ──────────────────────────────────────────────

export interface PolyvalenceMatrixInput {
  crew: CrewMember[];
  requiredSkills: RequiredSkill[];
  now?: string;
}
export interface PolyvalenceMatrixResponse {
  matrix: PolyvalenceMatrix;
}

export async function buildCrewPolyvalenceMatrix(
  projectId: string,
  input: PolyvalenceMatrixInput,
): Promise<PolyvalenceMatrixResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/skills/polyvalence-matrix`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<PolyvalenceMatrixResponse>(res);
}

// ── 4. find-substitutes ────────────────────────────────────────────────

export interface FindSubstitutesInput {
  crew: CrewMember[];
  absentUid: string;
  requirementsForRole: RequiredSkill[];
  now?: string;
}
export interface FindSubstitutesResponse {
  candidates: SubstitutionCandidate[];
}

export async function findSkillSubstitutes(
  projectId: string,
  input: FindSubstitutesInput,
): Promise<FindSubstitutesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/skills/find-substitutes`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FindSubstitutesResponse>(res);
}

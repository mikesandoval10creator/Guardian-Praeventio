// Praeventio Guard — Root cause client hook (5 mutators).

import { auth } from '../services/firebase';
import type {
  RootCauseAnalysis,
  CauseFactor,
  CauseStats,
} from '../services/rootCause/rootCauseClassifier';
import type {
  PunitiveLanguageReport,
  InvestigationQuestion,
  InvestigationDimension,
} from '../services/rootCause/noBlameInvestigation';

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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. build-analysis (analyzedByUid server-side) ──────────────────────

export interface BuildAnalysisWireInput {
  incidentId: string;
  factors: CauseFactor[];
  primaryFactor: CauseFactor;
  fiveWhys: string[];
  suggestedActions: string[];
  now?: string;
}
export interface BuildAnalysisResponse { analysis: RootCauseAnalysis }

export async function buildRootCauseAnalysis(
  projectId: string,
  input: BuildAnalysisWireInput,
): Promise<BuildAnalysisResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/root-cause/build-analysis`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildAnalysisResponse>(res);
}

// ── 2. compute-stats ───────────────────────────────────────────────────

export interface ComputeStatsInput { analyses: RootCauseAnalysis[] }
export interface ComputeStatsResponse { stats: CauseStats }

export async function computeRootCauseStats(
  projectId: string,
  input: ComputeStatsInput,
): Promise<ComputeStatsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/root-cause/compute-stats`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ComputeStatsResponse>(res);
}

// ── 3. analyze-punitive-language ───────────────────────────────────────

export interface AnalyzePunitiveInput { text: string }
export interface AnalyzePunitiveResponse { report: PunitiveLanguageReport }

export async function analyzePunitiveLanguageRemote(
  projectId: string,
  input: AnalyzePunitiveInput,
): Promise<AnalyzePunitiveResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/root-cause/analyze-punitive-language`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AnalyzePunitiveResponse>(res);
}

// ── 4. get-investigation-questions ─────────────────────────────────────

export interface GetQuestionsInput { dimension: InvestigationDimension }
export interface GetQuestionsResponse { questions: InvestigationQuestion[] }

export async function getInvestigationQuestionsRemote(
  projectId: string,
  input: GetQuestionsInput,
): Promise<GetQuestionsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/root-cause/get-investigation-questions`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<GetQuestionsResponse>(res);
}

// ── 5. get-starter-questionnaire ───────────────────────────────────────

export interface GetStarterResponse { questions: InvestigationQuestion[] }

export async function getStarterInvestigationQuestionnaire(
  projectId: string,
): Promise<GetStarterResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/root-cause/get-starter-questionnaire`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return json<GetStarterResponse>(res);
}

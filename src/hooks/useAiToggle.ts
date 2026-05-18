// Praeventio Guard — AI Toggle client hook (3 stateless mutators).

import { auth } from '../services/firebase';
import type {
  AiCapabilitySnapshot,
  AiModeDecision,
} from '../services/aiToggle/aiModeController';
import type {
  DriftAlert,
  RuleApplicationSample,
  DetectRuleDriftOptions,
} from '../services/aiToggle/ruleDriftDetector';

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

export interface DecideAiModeResponse {
  decision: AiModeDecision;
}

export async function decideAiMode(
  projectId: string,
  snapshot: AiCapabilitySnapshot,
): Promise<DecideAiModeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-mode/decide`,
    { method: 'POST', body: JSON.stringify(snapshot) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as DecideAiModeResponse;
}

export interface RulesOnlyCheckResponse {
  rulesOnly: boolean;
}

export async function checkRulesOnly(
  projectId: string,
  snapshot: AiCapabilitySnapshot,
): Promise<RulesOnlyCheckResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-mode/rules-only-check`,
    { method: 'POST', body: JSON.stringify(snapshot) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as RulesOnlyCheckResponse;
}

export interface RuleDriftResponse {
  alerts: DriftAlert[];
}

export async function detectRuleDrift(
  projectId: string,
  samples: RuleApplicationSample[],
  options?: DetectRuleDriftOptions,
): Promise<RuleDriftResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-mode/rule-drift`,
    { method: 'POST', body: JSON.stringify({ samples, options }) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as RuleDriftResponse;
}

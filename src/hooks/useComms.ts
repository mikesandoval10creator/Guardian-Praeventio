// Praeventio Guard — Communication Map client hook (5 mutators).

import { auth } from '../services/firebase';
import type {
  CommunicationChannel,
  ContactInfo,
  ZoneCoverage,
  EscalationLevel,
  EscalationDecision,
  ContactabilityTest,
  ContactabilityReport,
  ChannelFailoverDecision,
} from '../services/comms/communicationMap';

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

// ── 1. best-channel-for-zone ───────────────────────────────────────────

export interface BestChannelInput {
  contact: ContactInfo;
  zone: ZoneCoverage;
}
export interface BestChannelResponse {
  channel: CommunicationChannel | null;
}

export async function bestCommsChannelForZone(
  projectId: string,
  input: BestChannelInput,
): Promise<BestChannelResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/comms/best-channel-for-zone`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BestChannelResponse>(res);
}

// ── 2. detect-dead-zones ───────────────────────────────────────────────

export interface DetectDeadZonesInput {
  zones: ZoneCoverage[];
  requiredChannels: CommunicationChannel[];
}
export interface DetectDeadZonesResponse {
  deadZones: ZoneCoverage[];
}

export async function detectCommsDeadZones(
  projectId: string,
  input: DetectDeadZonesInput,
): Promise<DetectDeadZonesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/comms/detect-dead-zones`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectDeadZonesResponse>(res);
}

// ── 3. compute-escalation ──────────────────────────────────────────────

export interface ComputeEscalationInput {
  chain: EscalationLevel[];
  minutesSinceTrigger: number;
}
export interface ComputeEscalationResponse {
  decision: EscalationDecision;
}

export async function computeCommsEscalation(
  projectId: string,
  input: ComputeEscalationInput,
): Promise<ComputeEscalationResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/comms/compute-escalation`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ComputeEscalationResponse>(res);
}

// ── 4. build-contactability-report ─────────────────────────────────────

export interface BuildContactabilityInput {
  tests: ContactabilityTest[];
}
export interface BuildContactabilityResponse {
  report: ContactabilityReport;
}

export async function buildCommsContactabilityReport(
  projectId: string,
  input: BuildContactabilityInput,
): Promise<BuildContactabilityResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/comms/build-contactability-report`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildContactabilityResponse>(res);
}

// ── 5. plan-channel-failover ───────────────────────────────────────────

export interface PlanFailoverInput {
  contact: ContactInfo;
  zone: ZoneCoverage;
  isPrimaryDown: boolean;
}
export interface PlanFailoverResponse {
  decision: ChannelFailoverDecision;
}

export async function planCommsChannelFailover(
  projectId: string,
  input: PlanFailoverInput,
): Promise<PlanFailoverResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/comms/plan-channel-failover`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<PlanFailoverResponse>(res);
}

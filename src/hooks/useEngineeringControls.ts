// Praeventio Guard — §42-44 Engineering Controls hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';

export type EngineeringControlLevelAPI =
  | 'elimination'
  | 'substitution'
  | 'engineering'
  | 'administrative'
  | 'epp';

export interface EngineeringControlVerificationAPI {
  verifierUid: string;
  verifiedAt: string;
  result: 'pass' | 'observation' | 'fail';
  evidence?: string;
}

export interface EngineeringControlAPI {
  id: string;
  level: EngineeringControlLevelAPI;
  riskCategory: string;
  name: string;
  description: string;
  responsibleUid: string;
  verificationFrequencyDays: number;
  createdAt: string;
  createdBy: string;
  lastVerifiedAt: string | null;
  verifications: EngineeringControlVerificationAPI[];
}

export interface EngineeringControlsResponse {
  controls: EngineeringControlAPI[];
  warning?: 'partial_read_failure';
}

export interface EngineeringControlsOptions {
  level?:
    | 'engineering'
    | 'admin'
    | 'epp'
    | 'all'
    | EngineeringControlLevelAPI;
  riskCategory?: string;
}

export function useEngineeringControls(
  projectId: string | null,
  opts: EngineeringControlsOptions = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.level) qs.set('level', opts.level);
    if (opts.riskCategory) qs.set('riskCategory', opts.riskCategory);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/engineering-controls${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<EngineeringControlsResponse>(path);
}

export interface EngineeringControlCreatePayload {
  id: string;
  level: EngineeringControlLevelAPI;
  riskCategory: string;
  name: string;
  description: string;
  responsibleUid: string;
  verificationFrequencyDays: number;
}

export async function createEngineeringControl(
  projectId: string,
  payload: EngineeringControlCreatePayload,
): Promise<{ ok: true; control: EngineeringControlAPI }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/engineering-controls`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as { ok: true; control: EngineeringControlAPI };
}

export interface EngineeringControlVerifyPayload {
  result: 'pass' | 'observation' | 'fail';
  evidence?: string;
  /** @deprecated Server derives verifier from the authenticated caller. */
  verifierUid?: string;
}

export async function verifyControl(
  projectId: string,
  id: string,
  payload: EngineeringControlVerifyPayload,
): Promise<{ ok: true; entry: EngineeringControlVerificationAPI }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const { verifierUid: _ignored, ...wirePayload } = payload;
  void _ignored;
  const res = await fetch(
    `/api/sprint-k/${projectId}/engineering-controls/${id}/verify`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(wirePayload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as {
    ok: true;
    entry: EngineeringControlVerificationAPI;
  };
}

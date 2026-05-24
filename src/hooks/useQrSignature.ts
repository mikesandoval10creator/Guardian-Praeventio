// Praeventio Guard — F.5 QR Signature mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import type {
  QrSignatureChallenge,
  SignedAcknowledgement,
  SignatureItemKind,
} from '../services/qrSignature/qrSignatureService';
import { apiAuthHeader } from '../lib/apiAuth';

export async function requestQrSignatureChallenge(
  projectId: string,
  itemId: string,
  kind: SignatureItemKind,
  ttlMinutes?: number,
): Promise<QrSignatureChallenge> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/qr-signature/challenge`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify({ itemId, kind, ttlMinutes }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as { challenge: QrSignatureChallenge };
  return data.challenge;
}

export interface QrAcknowledgementPayload {
  challengeId: string;
  workerUid: string;
  biometricUsed?: boolean;
  signedAt: string;
}

export async function persistQrAcknowledgement(
  projectId: string,
  payload: QrAcknowledgementPayload,
): Promise<SignedAcknowledgement> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/qr-signature/acknowledge`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as {
    acknowledgement: SignedAcknowledgement;
  };
  return data.acknowledgement;
}

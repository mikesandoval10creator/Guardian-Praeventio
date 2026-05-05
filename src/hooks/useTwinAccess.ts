// SPDX-License-Identifier: MIT
//
// Sprint 25 — Digital Twin Triple-Gate Authentication (ADR 0011)
//
// Acceso al Digital Twin requiere TRES gates simultáneos:
//   1. Project membership (Firebase Auth + assertProjectMember)
//   2. Identity (Google OAuth verified email)
//   3. Biometric step-up (huella/Face ID o WebAuthn passkey)
//
// Sin los 3 gates, NO acceso. Sin excepciones (excepto demo project).
//
// La razón filosófica: la geometría 3D de la faena, posición de
// extintores, rutas de evacuación — todo eso es propiedad industrial
// de la empresa. Sería ilógico mostrarle el interior a un desconocido.

import { useEffect, useState, useCallback, useRef } from 'react';

export type TwinAccessState =
  | 'checking'
  | 'unauthenticated'
  | 'not_member'
  | 'email_unverified'
  | 'biometric_required'
  | 'biometric_failed'
  | 'biometric_unavailable'
  | 'granted';

export interface TwinAccessSnapshot {
  state: TwinAccessState;
  projectId: string;
  workerUid: string | null;
  /** Epoch ms del último step-up exitoso. null si no granted. */
  grantedAtMs: number | null;
  /** Step-up expira después de N min de inactividad. Default 30. */
  stepUpTtlMs: number;
  /** Trigger explícito del step-up biometric. */
  requestStepUp: () => Promise<void>;
  /** Revoca acceso ahora. */
  revoke: () => void;
  /** Refresh inactividad timer (call en cada interacción del user con el twin). */
  ping: () => void;
}

export interface TwinAccessOptions {
  /** Sólo para tests: inyectar verificadores en lugar de usar implementaciones reales. */
  fakers?: {
    getCurrentUser?: () => { uid: string; email: string; emailVerified: boolean } | null;
    isProjectMember?: (uid: string, projectId: string) => Promise<boolean>;
    isDemoProject?: (projectId: string) => boolean;
    runBiometric?: () => Promise<{ ok: boolean; method: 'fingerprint' | 'face' | 'passkey' | 'unavailable' }>;
    now?: () => number;
  };
  /** Override TTL (default 30 min). */
  stepUpTtlMs?: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export function useTwinAccess(
  projectId: string,
  options: TwinAccessOptions = {},
): TwinAccessSnapshot {
  const stepUpTtlMs = options.stepUpTtlMs ?? DEFAULT_TTL_MS;
  // Stable refs — avoid re-creating callbacks each render when caller
  // passes a fresh options object. This is what makes the gate-check
  // useEffect fire ONCE per projectId change instead of every render.
  const fakersRef = useRef(options.fakers ?? {});
  fakersRef.current = options.fakers ?? {};
  const nowFn = (options.fakers?.now ?? Date.now);

  const [state, setState] = useState<TwinAccessState>('checking');
  const [workerUid, setWorkerUid] = useState<string | null>(null);
  const [grantedAtMs, setGrantedAtMs] = useState<number | null>(null);
  const lastInteractionRef = useRef<number>(nowFn());

  const checkGates = useCallback(async () => {
    setState('checking');
    const fakers = fakersRef.current;
    const now = fakers.now ?? Date.now;

    // Demo project shortcut — gate 3 only is skipped, gates 1+2 still apply
    const isDemo = fakers.isDemoProject
      ? fakers.isDemoProject(projectId)
      : projectId === 'demo-faena-praeventio';

    // Gate 1 — auth
    const user = fakers.getCurrentUser ? fakers.getCurrentUser() : null;
    if (!user) {
      setState('unauthenticated');
      setWorkerUid(null);
      return;
    }
    setWorkerUid(user.uid);

    // Gate 2 — verified email (proxy for "Google OAuth verified")
    if (!user.emailVerified) {
      setState('email_unverified');
      return;
    }

    // Gate 1.5 — project membership
    const isMember = fakers.isProjectMember
      ? await fakers.isProjectMember(user.uid, projectId)
      : false;
    if (!isMember) {
      setState('not_member');
      return;
    }

    if (isDemo) {
      // Demo project: skip biometric gate (Gate 3)
      setState('granted');
      setGrantedAtMs(now());
      return;
    }

    // Gate 3 — biometric step-up needed
    setState('biometric_required');
  }, [projectId]);

  const requestStepUp = useCallback(async () => {
    const fakers = fakersRef.current;
    const now = fakers.now ?? Date.now;
    if (!fakers.runBiometric) {
      // Real implementation in Sprint 26 will lazy-load
      // @aparajita/capacitor-biometric-auth and @simplewebauthn/browser
      setState('biometric_unavailable');
      return;
    }
    const result = await fakers.runBiometric();
    if (result.method === 'unavailable') {
      setState('biometric_unavailable');
      return;
    }
    if (!result.ok) {
      setState('biometric_failed');
      return;
    }
    setState('granted');
    setGrantedAtMs(now());
    lastInteractionRef.current = now();
  }, []);

  const revoke = useCallback(() => {
    setState('biometric_required');
    setGrantedAtMs(null);
  }, []);

  const ping = useCallback(() => {
    const now = fakersRef.current.now ?? Date.now;
    lastInteractionRef.current = now();
  }, []);

  // Initial gate check on mount + projectId change
  useEffect(() => {
    void checkGates();
  }, [checkGates]);

  // Inactivity expiry watcher
  useEffect(() => {
    if (state !== 'granted') return;
    const now = fakersRef.current.now ?? Date.now;
    const interval = setInterval(() => {
      const idleMs = now() - lastInteractionRef.current;
      if (idleMs > stepUpTtlMs) {
        setState('biometric_required');
        setGrantedAtMs(null);
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [state, stepUpTtlMs]);

  return {
    state,
    projectId,
    workerUid,
    grantedAtMs,
    stepUpTtlMs,
    requestStepUp,
    revoke,
    ping,
  };
}

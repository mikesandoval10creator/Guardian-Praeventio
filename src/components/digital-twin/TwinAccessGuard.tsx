// SPDX-License-Identifier: MIT
//
// Sprint 25 — TwinAccessGuard (ADR 0011)
//
// Wrapper que enforce el triple-gate auth para Digital Twin. Cualquier
// componente que muestra geometría 3D, mesh, polígonos, posición de
// extintores, simulaciones de fuego, rutas de evacuación DEBE
// renderizarse dentro de <TwinAccessGuard>.
//
// PRs que rendericen Site25DPanel / DigitalTwinFaena / FireRiskTwin
// sin guard son rechazados en code review.

import React, { useEffect } from 'react';
import { Lock, Fingerprint, AlertTriangle, ShieldCheck, Loader2 } from 'lucide-react';
import { useTwinAccess, type TwinAccessOptions } from '../../hooks/useTwinAccess';

export interface TwinAccessGuardProps {
  /** Project ID cuyo twin se quiere mostrar. */
  projectId: string;
  /** Children que se renderizan SOLO cuando state === 'granted'. */
  children: React.ReactNode;
  /** Pass-through a useTwinAccess. Útil en tests para inyectar fakers. */
  hookOptions?: TwinAccessOptions;
  /** Callback opcional invocado al granted. */
  onGranted?: () => void;
  /** Callback opcional invocado al revoke/expire. */
  onRevoked?: () => void;
}

export function TwinAccessGuard({
  projectId,
  children,
  hookOptions,
  onGranted,
  onRevoked,
}: TwinAccessGuardProps) {
  const access = useTwinAccess(projectId, hookOptions);

  useEffect(() => {
    if (access.state === 'granted') onGranted?.();
  }, [access.state, onGranted]);

  useEffect(() => {
    if (access.state === 'biometric_required' && access.grantedAtMs === null) {
      onRevoked?.();
    }
  }, [access.state, access.grantedAtMs, onRevoked]);

  if (access.state === 'granted') {
    return (
      <div
        onMouseDown={() => access.ping()}
        onTouchStart={() => access.ping()}
        onKeyDown={() => access.ping()}
        className="contents"
      >
        {children}
      </div>
    );
  }

  return <TwinAccessLockScreen access={access} />;
}

function TwinAccessLockScreen({
  access,
}: {
  access: ReturnType<typeof useTwinAccess>;
}) {
  const { state, requestStepUp } = access;

  return (
    <div
      role="dialog"
      aria-label="Acceso restringido al Digital Twin"
      className="flex flex-col items-center justify-center min-h-[60vh] p-6 bg-zinc-950 text-zinc-100"
    >
      <div className="max-w-md w-full bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-2xl p-6 text-center">
        {state === 'checking' && (
          <>
            <Loader2 className="w-12 h-12 text-teal-400 animate-spin mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-bold mb-2">Verificando acceso…</h2>
            <p className="text-sm text-zinc-400">
              Revisando tu pertenencia al proyecto y verificación de identidad.
            </p>
          </>
        )}

        {state === 'unauthenticated' && (
          <>
            <Lock className="w-12 h-12 text-amber-400 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-bold mb-2">Inicia sesión con Google</h2>
            <p className="text-sm text-zinc-400 mb-4">
              El Digital Twin contiene información sensible de la faena. Para acceder,
              necesitamos verificar tu identidad con Google.
            </p>
            <p className="text-xs text-zinc-500">ADR 0011 · Triple-gate authentication</p>
          </>
        )}

        {state === 'email_unverified' && (
          <>
            <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-bold mb-2">Verifica tu correo</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Para acceder al Digital Twin necesitamos un correo verificado. Revisa
              tu bandeja de entrada o reenviá el correo de verificación desde tu perfil.
            </p>
          </>
        )}

        {state === 'not_member' && (
          <>
            <Lock className="w-12 h-12 text-rose-400 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-bold mb-2">No eres miembro de este proyecto</h2>
            <p className="text-sm text-zinc-400 mb-4">
              El Digital Twin es propiedad industrial de la empresa cliente. Para acceder
              necesitas ser miembro confirmado del proyecto. Pide al supervisor que te invite.
            </p>
          </>
        )}

        {state === 'biometric_required' && (
          <>
            <Fingerprint className="w-12 h-12 text-teal-400 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-bold mb-2">Verificación biométrica</h2>
            <p className="text-sm text-zinc-400 mb-6">
              Confirma que eres tú con tu huella, Face ID o passkey. Esto protege
              el plano de la faena en caso de que tu dispositivo cambie de manos.
            </p>
            <button
              onClick={requestStepUp}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white rounded-xl font-medium transition-colors"
            >
              Verificar identidad
            </button>
            <p className="text-xs text-zinc-500 mt-4">
              ADR 0011 · La sesión expira tras 30 min de inactividad
            </p>
          </>
        )}

        {state === 'biometric_failed' && (
          <>
            <AlertTriangle className="w-12 h-12 text-rose-400 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-bold mb-2">Verificación rechazada</h2>
            <p className="text-sm text-zinc-400 mb-4">
              La huella o el passkey no coincidió. Podés intentar de nuevo.
            </p>
            <button
              onClick={requestStepUp}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-medium"
            >
              Reintentar
            </button>
          </>
        )}

        {state === 'biometric_unavailable' && (
          <>
            <ShieldCheck className="w-12 h-12 text-amber-400 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-bold mb-2">Biometría no disponible</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Tu dispositivo no tiene huella o Face ID configurado. Podés
              registrar una passkey WebAuthn como alternativa desde Configuración.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

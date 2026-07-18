// SPDX-License-Identifier: MIT
//
// WebAuthnKeysSection — Sprint 30 Bucket KK.
//
// UI para que el usuario gestione sus llaves de seguridad WebAuthn
// (FIDO2 / passkeys). Backend completo desde Sprint 19 — esto cierra la
// gap F-F del audit Day-1.
//
// Funcionalidad:
//   • Lista las credenciales registradas via la Firestore Web SDK.
//   • Botón "Registrar nueva llave" → ceremony register + verify.
//   • Botón "Eliminar" por credencial con confirmación inline.
//
// El cleanup confirm modal usa state local (no un portal) para mantener
// la sección embebible dentro del acordeón "Seguridad y Privacidad" sin
// interferir con el resto del tree.

import React, { useEffect, useState, useCallback } from 'react';
import { Fingerprint, Plus, ShieldCheck, AlertTriangle, Loader2, Info } from 'lucide-react';
import { useFirebase } from '../../contexts/FirebaseContext';
import {
  isWebAuthnSupported,
  registerNewAuthenticator,
  WebAuthnCancelledError,
  WebAuthnNotSupportedError,
} from '../../services/auth/webauthnClient';
import { logger } from '../../utils/logger';
import { humanErrorMessage } from '../../lib/humanError';


export interface WebAuthnCredentialRow {
  credentialId: string;
  nickname?: string;
  deviceType?: string;
  transports?: string[];
  registeredAt: number;
  lastUsedAt: number | null;
}

export interface WebAuthnKeysSectionProps {
  /**
   * Inyectable para tests — fetcher de la lista de credenciales del usuario.
   * Producción: GET `/api/auth/webauthn/credentials` (read-only, server-side,
   * identidad desde el token). NO se lee Firestore directo desde el cliente —
   * la colección canónica `webauthn_credentials` es server-only (default-deny).
   */
  loadCredentials?: (uid: string) => Promise<WebAuthnCredentialRow[]>;
  /** Inyectable para tests — reemplazo del fetch global. */
  fetchImpl?: typeof fetch;
}

// Read-only list of the caller's enrolled keys. There is intentionally NO
// delete loader — self-serve removal of an MFA credential is disabled by
// design (stolen-device protection, B17/Fase 5). Rotation = registrar una
// nueva llave; remover un dispositivo perdido = flujo de recuperación.
async function defaultLoadCredentials(uid: string): Promise<WebAuthnCredentialRow[]> {
  void uid; // identity is taken from the verified token, server-side
  const { apiAuthHeaderOrThrow } = await import('../../lib/apiAuth');
  const authHeader = await apiAuthHeaderOrThrow();
  const res = await fetch('/api/auth/webauthn/credentials', {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    throw new Error(`webauthn_credentials_list_failed:${res.status}`);
  }
  const data = await res.json();
  const rows = Array.isArray(data?.credentials) ? data.credentials : [];
  return rows.map((d: Record<string, unknown>) => ({
    credentialId: String(d.credentialId ?? ''),
    transports: Array.isArray(d.transports) ? (d.transports as string[]) : undefined,
    registeredAt: Number(d.registeredAt ?? 0),
    lastUsedAt:
      d.lastUsedAt === null || d.lastUsedAt === undefined ? null : Number(d.lastUsedAt),
  }));
}

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

export function WebAuthnKeysSection({
  loadCredentials = defaultLoadCredentials,
  fetchImpl,
}: WebAuthnKeysSectionProps = {}) {
  const { user } = useFirebase();
  const [credentials, setCredentials] = useState<WebAuthnCredentialRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState<boolean>(false);
  const [nickname, setNickname] = useState<string>('');
  const supported = isWebAuthnSupported();

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const rows = await loadCredentials(user.uid);
      setCredentials(rows);
      setError(null);
    } catch (err) {
      logger.error?.('webauthn_credentials_load_failed', { err: String(err) });
      setError('No se pudieron cargar las credenciales.');
    } finally {
      setLoading(false);
    }
  }, [user, loadCredentials]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRegister = async () => {
    if (!user) return;
    setRegistering(true);
    setError(null);
    try {
      // Plan v2 B3 — apiAuthHeader unified (Bearer ${idToken} en prod,
      // E2E <secret>:<uid> en MODE=test). El refactor de
      // registerNewAuthenticator a `authHeader` permite que los specs E2E
      // ejerciten este flow sin minteo de custom token.
      const { apiAuthHeaderOrThrow } = await import('../../lib/apiAuth');
      const authHeader = await apiAuthHeaderOrThrow();
      await registerNewAuthenticator({
        authHeader,
        nickname: nickname.trim() || undefined,
        fetchImpl,
      });
      setNickname('');
      await refresh();
    } catch (err) {
      if (err instanceof WebAuthnNotSupportedError) {
        setError('Tu navegador no soporta WebAuthn / passkeys.');
      } else if (err instanceof WebAuthnCancelledError) {
        setError('Registro cancelado.');
      } else {
        logger.error?.('webauthn_register_failed', { err: String(err) });
        setError('No se pudo registrar la llave. Intenta de nuevo.');
      }
    } finally {
      setRegistering(false);
    }
  };

  if (!supported) {
    return (
      <div
        data-testid="webauthn-unsupported"
        className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300"
      >
        <div className="flex items-center gap-2 text-sm font-bold">
          <AlertTriangle className="w-4 h-4" />
          WebAuthn no disponible
        </div>
        <p className="text-xs mt-1 opacity-80">
          Tu navegador no soporta llaves de seguridad. Usa Chrome, Edge, Safari
          o Firefox actualizados.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="webauthn-section" className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20 shrink-0">
          <Fingerprint className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-bold text-zinc-900 dark:text-white">
            Llaves de seguridad (WebAuthn)
          </h4>
          <p className="text-xs text-zinc-600 dark:text-zinc-500">
            Registra una passkey, llave física FIDO2 o el lector biométrico de
            tu dispositivo para acceso sin contraseña.
          </p>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-xs text-zinc-500 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Cargando…
        </div>
      ) : credentials.length === 0 ? (
        <div
          data-testid="webauthn-empty"
          className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 text-xs text-zinc-600 dark:text-zinc-400"
        >
          No tienes llaves registradas todavía.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="webauthn-list">
          {credentials.map((cred) => (
            <li
              key={cred.credentialId}
              data-testid={`webauthn-credential-${cred.credentialId}`}
              className="p-3 rounded-lg bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                  {cred.nickname || 'Llave sin nombre'}
                </p>
                <p className="text-[10px] text-zinc-500">
                  {cred.deviceType ?? 'desconocido'} ·{' '}
                  {(cred.transports ?? []).join(', ') || 'transport ?'}
                </p>
                <p className="text-[10px] text-zinc-400">
                  Registrada: {formatDate(cred.registeredAt)} · Último uso:{' '}
                  {formatDate(cred.lastUsedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Protección de cuenta (B17, Fase 5): la eliminación de llaves NO está
          disponible para el usuario por diseño. Si pierdes un dispositivo,
          registra una llave nueva y usa el flujo de recuperación de cuenta —
          así un teléfono robado no puede borrar tus accesos y dejarte fuera. */}
      {credentials.length > 0 && (
        <div
          data-testid="webauthn-no-delete-note"
          className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-700 dark:text-sky-300 flex items-start gap-2"
        >
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Por tu seguridad no puedes <strong>eliminar</strong> una llave desde
            aquí. Para reemplazar un dispositivo perdido o robado, registra una
            llave nueva y usa la recuperación de cuenta con tu administrador. Así
            nadie que tome tu teléfono puede borrar tus accesos y dejarte sin tu
            información.
          </span>
        </div>
      )}

      {/* Registrar */}
      <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-white/5">
        <label
          htmlFor="webauthn-nickname"
          className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest"
        >
          Nombre de la llave (opcional)
        </label>
        <input
          id="webauthn-nickname"
          type="text"
          placeholder="Ej. iPhone Trabajo, YubiKey 5C"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none"
        />
        <button
          type="button"
          onClick={handleRegister}
          disabled={registering}
          data-testid="webauthn-register-btn"
          className="w-full py-2 bg-[#4db6ac] hover:bg-[#3fa39a] disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 transition-colors"
        >
          {registering ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Registrando…
            </>
          ) : (
            <>
              <Plus className="w-3 h-3" />
              Registrar nueva llave
            </>
          )}
        </button>
        {error && (
          <p
            data-testid="webauthn-error"
            role="alert"
            className="text-xs text-rose-500 flex items-center gap-1"
          >
            <ShieldCheck className="w-3 h-3" />
            {humanErrorMessage(error)}
          </p>
        )}
      </div>
    </div>
  );
}

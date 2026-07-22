// SPDX-License-Identifier: MIT
// Health Vault v2 — authenticated, consent-bound professional viewer.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';

import { MedicalDisclaimer } from '../components/health/MedicalDisclaimer';
import { useFirebase } from '../contexts/FirebaseContext';
import { useBiometricAuth } from '../hooks/useBiometricAuth';
import { apiAuthHeader } from '../lib/apiAuth';
import type { HealthRecord } from '../services/health/vaultRecord';

type SafeRecord = Omit<HealthRecord, 'fileUri'> & { fileAvailable?: boolean };

type ViewerState =
  | { kind: 'checking' }
  | { kind: 'login_required' }
  | { kind: 'legacy_reissue' }
  | { kind: 'professional_enrollment' }
  | { kind: 'verification_pending'; status: string }
  | { kind: 'webauthn_required' }
  | { kind: 'opening' }
  | { kind: 'authorized'; ownerName: string; records: SafeRecord[]; expiresAt: number }
  | { kind: 'error'; title: string; message: string };

type VaultRouteState = { vaultSecret?: string } | null;

function formatDate(value: number | string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

function serverError(body: { error?: string; message?: string }, status: number) {
  if (body.message) return body.message;
  if (body.error === 'revoked') return 'El paciente revocó este acceso.';
  if (body.error === 'expired') return 'Este acceso expiró. Pide al paciente uno nuevo.';
  if (body.error === 'recipient_mismatch') return 'Este acceso fue autorizado para otro profesional.';
  if (body.error === 'recipient_confirmation_required') {
    return 'El paciente todavía debe confirmar tu identidad profesional.';
  }
  if (status === 401) return 'Tu sesión no es válida. Inicia sesión e intenta nuevamente.';
  return 'No pudimos completar el acceso clínico seguro. Intenta nuevamente.';
}

export function HealthVaultViewer() {
  const { tokenId = '', secret: legacySecret } = useParams();
  const location = useLocation();
  const { user } = useFirebase() as any;
  const { createHealthProfessionalAssertion } = useBiometricAuth();
  const [secret] = useState(() => {
    if (legacySecret) return '';
    const routeSecret = (location.state as VaultRouteState)?.vaultSecret;
    if (typeof routeSecret === 'string' && routeSecret) return routeSecret;
    const fragment = window.location.hash.replace(/^#/, '');
    if (fragment) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    }
    return fragment;
  });
  const [state, setState] = useState<ViewerState>(() =>
    legacySecret ? { kind: 'legacy_reissue' } : { kind: 'checking' },
  );
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const returnState = useMemo(
    () => ({ returnTo: `/vault/share/${encodeURIComponent(tokenId)}`, vaultSecret: secret }),
    [tokenId, secret],
  );

  useEffect(() => {
    if (legacySecret) return;
    if (!user?.uid) {
      setState({ kind: 'login_required' });
      return;
    }
    if (!tokenId || !secret) {
      setState({
        kind: 'error',
        title: 'Enlace incompleto',
        message: 'El enlace no contiene el código seguro. Pide al paciente que lo genere nuevamente.',
      });
      return;
    }
    let cancelled = false;
    async function checkProfessional() {
      try {
        const authHeader = await apiAuthHeader();
        if (!authHeader) throw new Error('authentication_required');
        const response = await fetch('/api/health-professionals/me', {
          headers: { Authorization: authHeader },
        });
        if (cancelled) return;
        if (response.status === 404) {
          setState({ kind: 'professional_enrollment' });
          return;
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(serverError(body, response.status));
        const status = body.identity?.status;
        if (status !== 'provisional' && status !== 'verified') {
          setState({ kind: 'verification_pending', status: String(status ?? 'pending') });
          return;
        }
        setState({ kind: 'webauthn_required' });
      } catch (error: any) {
        if (!cancelled) {
          setState({
            kind: 'error',
            title: 'No pudimos verificar tu perfil',
            message: error?.message ?? 'Intenta nuevamente.',
          });
        }
      }
    }
    void checkProfessional();
    return () => {
      cancelled = true;
    };
  }, [legacySecret, secret, tokenId, user?.uid]);

  async function openVault() {
    setState({ kind: 'opening' });
    try {
      const [authHeader, assertion] = await Promise.all([
        apiAuthHeader(),
        createHealthProfessionalAssertion(tokenId),
      ]);
      if (!authHeader || !assertion) {
        setState({
          kind: 'error',
          title: 'Dispositivo no compatible',
          message:
            'Este acceso exige una huella o llave WebAuthn verificable por el servidor. Usa un dispositivo compatible.',
        });
        return;
      }
      const sessionResponse = await fetch(`/api/health-vault/view/${tokenId}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ secret, assertion }),
      });
      const sessionBody = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok) {
        throw new Error(serverError(sessionBody, sessionResponse.status));
      }
      const nextSessionToken = String(sessionBody.sessionToken ?? '');
      if (!nextSessionToken) throw new Error('La sesión clínica no pudo iniciarse.');
      setSessionToken(nextSessionToken);
      const recordsResponse = await fetch(`/api/health-vault/view/${tokenId}/records`, {
        headers: {
          Authorization: authHeader,
          'X-Health-Vault-Session': nextSessionToken,
        },
      });
      const recordsBody = await recordsResponse.json().catch(() => ({}));
      if (!recordsResponse.ok) {
        throw new Error(serverError(recordsBody, recordsResponse.status));
      }
      setState({
        kind: 'authorized',
        ownerName: String(recordsBody.ownerName ?? 'Paciente'),
        records: Array.isArray(recordsBody.records) ? recordsBody.records : [],
        expiresAt: Number(recordsBody.expiresAt),
      });
    } catch (error: any) {
      setState({
        kind: 'error',
        title: 'No se pudo abrir el Health Vault',
        message: error?.message ?? 'Intenta nuevamente.',
      });
    }
  }

  async function openFile(recordId: string) {
    if (!sessionToken) return;
    try {
      const authHeader = await apiAuthHeader();
      if (!authHeader) throw new Error('authentication_required');
      const response = await fetch(`/api/health-vault/view/${tokenId}/file/${recordId}`, {
        headers: {
          Authorization: authHeader,
          'X-Health-Vault-Session': sessionToken,
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(serverError(body, response.status));
      }
      const url = URL.createObjectURL(await response.blob());
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      setState({
        kind: 'error',
        title: 'No se pudo abrir el archivo',
        message: error?.message ?? 'Intenta nuevamente.',
      });
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950" data-testid="health-vault-viewer">
      <MedicalDisclaimer variant="banner" />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {(state.kind === 'checking' || state.kind === 'opening') && (
          <p role="status" className="text-secondary-token">
            {state.kind === 'opening' ? 'Verificando tu identidad y consentimiento…' : 'Comprobando acceso seguro…'}
          </p>
        )}

        {state.kind === 'login_required' && (
          <ActionCard title="Identifícate como profesional de salud">
            <p>El QR no entrega datos por sí solo. Inicia sesión para verificar tu identidad profesional.</p>
            <Link
              to="/login"
              state={returnState}
              className="inline-block mt-3 rounded-md bg-teal-700 px-4 py-2 text-sm text-white"
            >
              Iniciar sesión y volver
            </Link>
          </ActionCard>
        )}

        {state.kind === 'legacy_reissue' && (
          <ErrorCard
            title="Este enlace antiguo ya no muestra datos médicos"
            message="Por seguridad, pide al paciente que genere un acceso nuevo ligado a tu identidad profesional."
          />
        )}

        {state.kind === 'professional_enrollment' && (
          <ProfessionalEnrollment onPending={() => setState({ kind: 'verification_pending', status: 'pending' })} />
        )}

        {state.kind === 'verification_pending' && (
          <ActionCard title="Tu verificación profesional está pendiente">
            <p>
              Aún no se liberó información clínica. Un revisor debe comprobar tu registro y dejar la decisión auditada.
            </p>
          </ActionCard>
        )}

        {state.kind === 'webauthn_required' && (
          <ActionCard title="Confirma tu presencia">
            <p>Usa tu huella o llave de seguridad registrada para abrir sólo los registros autorizados.</p>
            <button
              type="button"
              onClick={() => void openVault()}
              className="mt-3 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Verificar huella y abrir
            </button>
          </ActionCard>
        )}

        {state.kind === 'error' && <ErrorCard title={state.title} message={state.message} />}
        {state.kind === 'authorized' && (
          <AuthorizedView
            ownerName={state.ownerName}
            records={state.records}
            expiresAt={state.expiresAt}
            onOpenFile={openFile}
          />
        )}
      </main>
    </div>
  );
}

function ProfessionalEnrollment({ onPending }: { onPending: () => void }) {
  const { registerCredential } = useBiometricAuth();
  const [displayName, setDisplayName] = useState('');
  const [rut, setRut] = useState('');
  const [registryNumber, setRegistryNumber] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function enroll(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const credential = await registerCredential(
        'Verifica tu identidad para registrar tu perfil profesional',
      );
      if (!credential.success) {
        throw new Error(
          'No pudimos registrar una huella o llave verificable. Usa un navegador y dispositivo compatibles con passkeys.',
        );
      }
      const authHeader = await apiAuthHeader();
      if (!authHeader) throw new Error('Inicia sesión nuevamente.');
      const response = await fetch('/api/health-professionals/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ displayName, rut, registryNumber }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? 'No se pudo enviar la verificación.');
      setSubmitting(false);
      onPending();
    } catch (submitError: any) {
      setSubmitting(false);
      setError(submitError?.message ?? 'No se pudo enviar la verificación.');
    }
  }

  return (
    <form onSubmit={enroll} className="rounded-xl border border-teal-200 bg-white p-5 space-y-3">
      <h2 className="font-bold">Registrar identidad profesional</h2>
      <p className="text-sm">
        Este registro es independiente de cualquier empresa o proyecto. Primero registrarás una
        huella o llave de seguridad verificable por el servidor; nunca enviamos tu huella a Praeventio.
      </p>
      <input aria-label="Nombre profesional" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required className="w-full rounded border p-2" />
      <input aria-label="RUT profesional" value={rut} onChange={(event) => setRut(event.target.value)} required className="w-full rounded border p-2" />
      <input aria-label="Número de registro profesional" value={registryNumber} onChange={(event) => setRegistryNumber(event.target.value)} required className="w-full rounded border p-2" />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-60"
      >
        {submitting ? 'Registrando seguridad…' : 'Registrar huella y enviar para revisión'}
      </button>
    </form>
  );
}

function ActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-teal-200 bg-white p-5">
      <h2 className="font-bold text-zinc-900">{title}</h2>
      <div className="mt-2 text-sm text-zinc-700">{children}</div>
    </section>
  );
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5">
      <h2 className="font-bold text-amber-950">{title}</h2>
      <p className="mt-1 text-sm text-amber-900">{message}</p>
    </section>
  );
}

function AuthorizedView({
  ownerName,
  records,
  expiresAt,
  onOpenFile,
}: {
  ownerName: string;
  records: SafeRecord[];
  expiresAt: number;
  onOpenFile: (recordId: string) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-teal-200 bg-white p-5">
        <h1 className="text-lg font-bold">Health Vault de {ownerName}</h1>
        <p className="text-xs text-zinc-600">Acceso válido hasta {formatDate(expiresAt)}</p>
      </header>
      <ul className="space-y-3" data-testid="records-list">
        {records.map((record) => (
          <li key={record.id} className="rounded-xl border bg-white p-4">
            <h3 className="font-semibold">{record.meta.title}</h3>
            <p className="text-xs text-zinc-600">{formatDate(record.meta.issueDate ?? record.uploadedAt)}</p>
            {record.fileAvailable && (
              <button type="button" onClick={() => void onOpenFile(record.id)} className="mt-2 text-sm text-teal-800 underline">
                Abrir archivo de forma segura
              </button>
            )}
          </li>
        ))}
      </ul>
      <p role="note" className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-xs">
        {tFallback()}
      </p>
    </div>
  );
}

function tFallback() {
  return 'Praeventio nunca diagnostica. El paciente eligió estos registros y puede revocar el acceso.';
}

export default HealthVaultViewer;

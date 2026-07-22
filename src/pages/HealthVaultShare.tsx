// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV — HealthVaultShare (worker logueado).
//
// Página /my-data/share. El trabajador genera un QR para compartir su
// cartera médica con un médico tratante. Praeventio NO diagnostica; el
// QR es sólo el canal de transporte. Cumple Ley 20.584 + 21.719 + 16.744.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { MedicalDisclaimer } from '../components/health/MedicalDisclaimer';
import { useFirebase } from '../contexts/FirebaseContext';
import type {
  HealthAccessPurpose,
  VaultShareScope,
} from '../services/health/vaultShare';
import type { HealthRecord } from '../services/health/vaultRecord';
import { apiAuthHeader } from '../lib/apiAuth';
import { humanErrorFromResponse, humanErrorMessage } from '../lib/humanError';


interface CreatedShare {
  grantId: string;
  secret: string;
  qrPayload: string;
  expiresAt: number;
  consentText: string;
}

interface ProfessionalOption {
  uid: string;
  displayName: string;
  registryNumber: string;
  status: 'provisional' | 'verified';
}

type SelectableRecord = Omit<HealthRecord, 'fileUri'> & { fileAvailable?: boolean };

interface ActiveShareSummary {
  version?: number;
  id: string;
  scope: VaultShareScope;
  topic?: string;
  createdAt: number;
  expiresAt: number;
  consumeCount: number;
  maxConsumes: number;
  revokedAt: number | null;
  status?: 'pending' | 'active' | 'revoked' | 'expired';
  recipientProfessionalUid?: string;
  recipientClaim?: {
    professionalUid: string;
    displayName: string;
    registryNumber: string;
    requestedAt: number;
  };
}

const SCOPE_LABELS: Record<VaultShareScope, string> = {
  full: 'Toda la cartera',
  recent: 'Últimos 90 días',
  topic: 'Por tema (selección manual)',
};

const PURPOSE_LABELS: Record<HealthAccessPurpose, string> = {
  continuity_of_care: 'Continuidad de atención',
  second_opinion: 'Segunda opinión',
  diagnostic_review: 'Revisión diagnóstica',
  occupational_health: 'Salud ocupacional',
};

export function HealthVaultShare() {
  const { t } = useTranslation();
  const { user, db } = useFirebase() as any;

  const [scope, setScope] = useState<VaultShareScope>('full');
  const [ttlHours, setTtlHours] = useState(24);
  const [purpose, setPurpose] = useState<HealthAccessPurpose>('continuity_of_care');
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([]);
  const [records, setRecords] = useState<SelectableRecord[]>([]);
  const [selectedProfessionalUid, setSelectedProfessionalUid] = useState('');
  const [professionalQuery, setProfessionalQuery] = useState('');
  const [openInvitation, setOpenInvitation] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [choicesLoading, setChoicesLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [createdShare, setCreatedShare] = useState<CreatedShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveShareSummary[]>([]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    let cancelled = false;
    async function loadChoices() {
      try {
        const authHeader = await apiAuthHeader();
        if (!authHeader) throw new Error('authentication_required');
        const [recordsResponse, professionalsResponse] = await Promise.all([
          fetch('/api/health-vault/records', {
            headers: { Authorization: authHeader },
          }),
          fetch('/api/health-professionals/search?limit=50', {
            headers: { Authorization: authHeader },
          }),
        ]);
        if (!recordsResponse.ok || !professionalsResponse.ok) {
          throw new Error('health_vault_temporarily_unavailable');
        }
        const [recordsBody, professionalsBody] = await Promise.all([
          recordsResponse.json(),
          professionalsResponse.json(),
        ]);
        if (cancelled) return;
        setRecords(Array.isArray(recordsBody.records) ? recordsBody.records : []);
        setProfessionals(
          Array.isArray(professionalsBody.professionals)
            ? professionalsBody.professionals
            : [],
        );
      } catch (loadError: any) {
        if (!cancelled) {
          setError(humanErrorMessage(loadError?.message ?? 'unknown_error'));
        }
      } finally {
        if (!cancelled) setChoicesLoading(false);
      }
    }
    void loadChoices();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || professionalQuery.trim().length < 2) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const authHeader = await apiAuthHeader();
        if (!authHeader) return;
        const response = await fetch(
          `/api/health-professionals/search?q=${encodeURIComponent(professionalQuery.trim())}&limit=20`,
          { headers: { Authorization: authHeader } },
        );
        if (!response.ok || cancelled) return;
        const body = await response.json();
        if (!cancelled) {
          setProfessionals(Array.isArray(body.professionals) ? body.professionals : []);
        }
      } catch {
        // The initial directory remains available; the user can retry typing.
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [professionalQuery, user?.uid]);

  // Keep the owner's grant list live. Open invitations are claimed by a
  // different account, so a one-shot read would leave the patient unable to
  // confirm the claimant until the whole page was reloaded.
  useEffect(() => {
    if (!user?.uid || !db) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    async function subscribe() {
      try {
        const { collection, onSnapshot, query, orderBy } = await import('firebase/firestore');
        const ref = collection(db, 'users', user.uid, 'health_vault_shares');
        const stopListening = onSnapshot(
          query(ref, orderBy('createdAt', 'desc')),
          (snap) => {
            if (cancelled) return;
            setActive(
              snap.docs.map((d: any) => {
                const data = d.data();
                return {
                  version: data.version,
                  id: data.id,
                  scope: data.scope,
                  topic: data.topic,
                  createdAt: data.createdAt,
                  expiresAt: data.expiresAt,
                  consumeCount: data.sessionCount ?? data.consumeCount ?? 0,
                  maxConsumes: data.maxSessions ?? data.maxConsumes ?? 0,
                  revokedAt: data.revokedAt ?? null,
                  status: data.status,
                  recipientProfessionalUid: data.recipientProfessionalUid,
                  recipientClaim: data.recipientClaim,
                };
              }),
            );
          },
          () => {
            // soft-fail: the grant list is informative and Firestore retries
            // transient listener failures internally.
          },
        );
        if (cancelled) {
          stopListening();
          return;
        }
        unsubscribe = stopListening;
      } catch {
        // soft-fail: the grant list is informative
      }
    }
    void subscribe();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [user?.uid, db, createdShare]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // apiAuthHeader() returns the FULL header string with the `Bearer `
      // (or `E2E `) prefix. verifyAuth.ts requires that prefix — sending the
      // raw idToken made every POST /share fail with 401. Centralizing here
      // also wires the E2E path so the QR flow works in Playwright.
      const authHeader = await apiAuthHeader();
      const res = await fetch('/api/health-vault/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({
          version: 2,
          scope,
          resourceIds: selectedRecordIds,
          ...(openInvitation ? {} : { recipientProfessionalUid: selectedProfessionalUid }),
          purpose,
          ttlHours,
          maxSessions: 5,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `error_${res.status}`);
      }
      const data = (await res.json()) as CreatedShare;
      setCreatedShare(data);
    } catch (err: any) {
      setError(humanErrorMessage(err?.message ?? 'unknown_error'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    setRevokeError(null);
    try {
      // Same Bearer-prefix requirement as handleSubmit — use apiAuthHeader().
      const authHeader = await apiAuthHeader();
      const response = await fetch(`/api/health-vault/share/${tokenId}/revoke`, {
        method: 'POST',
        headers: { ...(authHeader ? { 'Authorization': authHeader } : {}) },
      });
      if (!response.ok) {
        throw new Error(await humanErrorFromResponse(response));
      }
      setActive((prev) =>
        prev.map((s) =>
          s.id === tokenId ? { ...s, revokedAt: Date.now() } : s,
        ),
      );
    } catch (revokeFailure) {
      setRevokeError(humanErrorMessage(revokeFailure));
    }
  }

  async function handleConfirmRecipient(share: ActiveShareSummary) {
    if (!share.recipientClaim) return;
    setRevokeError(null);
    try {
      const authHeader = await apiAuthHeader();
      const response = await fetch(
        `/api/health-vault/share/${share.id}/confirm-recipient`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: JSON.stringify({
            professionalUid: share.recipientClaim.professionalUid,
          }),
        },
      );
      if (!response.ok) throw new Error(await humanErrorFromResponse(response));
      setActive((previous) => previous.map((candidate) =>
        candidate.id === share.id
          ? {
              ...candidate,
              status: 'active',
              recipientProfessionalUid: share.recipientClaim?.professionalUid,
              recipientClaim: undefined,
            }
          : candidate,
      ));
    } catch (confirmationFailure) {
      setRevokeError(humanErrorMessage(confirmationFailure));
    }
  }

  function copyLink() {
    if (!createdShare) return;
    void navigator.clipboard?.writeText(createdShare.qrPayload);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <MedicalDisclaimer variant="card" />

        <header>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {t('healthVaultShare.title', 'Compartir cartera médica')}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            {t('healthVaultShare.subtitle', 'Genera un QR temporal para que tu médico tratante lo escanee. Tú decides el alcance, la duración y puedes revocarlo cuando quieras.')}
          </p>
        </header>

        {!createdShare && (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"
          >
            <label className="block">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {t('healthVaultShare.scope', 'Alcance')}
              </span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as VaultShareScope)}
                className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 text-sm"
              >
                <option value="full">{SCOPE_LABELS.full}</option>
                <option value="recent">{SCOPE_LABELS.recent}</option>
                <option value="topic">{SCOPE_LABELS.topic}</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Profesional destinatario
              </span>
              <input
                aria-label="Buscar profesional"
                value={professionalQuery}
                onChange={(event) => setProfessionalQuery(event.target.value)}
                disabled={openInvitation}
                placeholder="Busca por nombre o registro"
                className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 text-sm"
              />
              <select
                aria-label="Profesional destinatario"
                value={openInvitation ? '' : selectedProfessionalUid}
                onChange={(event) => setSelectedProfessionalUid(event.target.value)}
                disabled={openInvitation}
                className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 text-sm"
              >
                <option value="">Selecciona un profesional verificado</option>
                {professionals.map((professional) => (
                  <option key={professional.uid} value={professional.uid}>
                    {professional.displayName} · {professional.registryNumber} ·{' '}
                    {professional.status === 'verified' ? 'verificación oficial' : 'verificación provisional'}
                  </option>
                ))}
              </select>
              <label className="mt-2 flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={openInvitation}
                  onChange={(event) => setOpenInvitation(event.target.checked)}
                />
                Mi médico aún no aparece. Crear un QR abierto que no mostrará datos hasta que yo
                confirme su identidad profesional verificada.
              </label>
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Registros autorizados
              </legend>
              {choicesLoading && <p className="text-xs text-zinc-500">Cargando opciones…</p>}
              {!choicesLoading && records.length === 0 && (
                <p className="text-xs text-zinc-500">No tienes registros disponibles para compartir.</p>
              )}
              {records.map((record) => (
                <label key={record.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedRecordIds.includes(record.id)}
                    onChange={(event) =>
                      setSelectedRecordIds((current) =>
                        event.target.checked
                          ? [...current, record.id]
                          : current.filter((id) => id !== record.id),
                      )
                    }
                  />
                  <span>{record.meta.title}</span>
                </label>
              ))}
            </fieldset>

            <label className="block">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Finalidad del acceso
              </span>
              <select
                aria-label="Finalidad del acceso"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as HealthAccessPurpose)}
                className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 text-sm"
              >
                {Object.entries(PURPOSE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Duración: {ttlHours}h{' '}
                <span className="text-xs text-zinc-500">(1h - 168h)</span>
              </span>
              <input
                type="range"
                min={1}
                max={168}
                step={1}
                value={ttlHours}
                onChange={(e) => setTtlHours(Number(e.target.value))}
                className="mt-2 block w-full"
              />
            </label>

            {error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                Error: {humanErrorMessage(error)}
              </p>
            )}

            {(selectedProfessionalUid || openInvitation) && selectedRecordIds.length > 0 && (
              <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs text-teal-900">
                Autorizarás exactamente {selectedRecordIds.length} registro(s) al profesional
                {openInvitation ? ' que confirmes después de escanear el QR' : ' seleccionado'} para{' '}
                {PURPOSE_LABELS[purpose].toLocaleLowerCase('es-CL')}, por hasta{' '}
                {ttlHours} hora(s). Puedes revocar el acceso en cualquier momento.
              </div>
            )}

            <button
              type="submit"
              disabled={
                submitting ||
                choicesLoading ||
                (!selectedProfessionalUid && !openInvitation) ||
                selectedRecordIds.length === 0
              }
              className="w-full rounded-md bg-teal-600 hover:bg-teal-700 disabled:bg-zinc-400 px-4 py-2 text-sm font-semibold text-white"
            >
              {submitting ? t('healthVaultShare.generating', 'Generando…') : t('healthVaultShare.generateQr', 'Generar QR')}
            </button>
          </form>
        )}

        {createdShare && (
          <section className="space-y-4 rounded-xl border border-teal-200 dark:border-teal-800/50 bg-white dark:bg-zinc-900 p-5">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              {t('healthVaultShare.qrReady', 'QR listo para tu médico')}
            </h2>
            <div className="bg-white p-4 rounded-md flex items-center justify-center">
              <QRCode value={createdShare.qrPayload} size={220} />
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 break-all">
              {createdShare.qrPayload}
            </p>
            <p className="text-xs text-zinc-700 dark:text-zinc-300">
              {createdShare.consentText}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copyLink}
                className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm"
              >
                {t('healthVaultShare.copyLink', 'Copiar link')}
              </button>
              <button
                type="button"
                onClick={() => setCreatedShare(null)}
                className="flex-1 rounded-md bg-teal-600 hover:bg-teal-700 px-3 py-2 text-sm text-white"
              >
                {t('healthVaultShare.generateAnother', 'Generar otro')}
              </button>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {t('healthVaultShare.yourShares', 'Tus enlaces compartidos')}
          </h2>
          {revokeError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {humanErrorMessage(revokeError)}
            </p>
          )}
          {active.length === 0 && (
            <p className="text-xs italic text-zinc-500">Aún no has generado ninguno.</p>
          )}
          <ul className="space-y-2">
            {active.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-xs"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-medium text-zinc-800 dark:text-zinc-200">
                      {SCOPE_LABELS[s.scope]}
                      {s.topic ? ` — ${s.topic}` : ''}
                    </p>
                    <p className="text-zinc-500">
                      Visualizaciones: {s.consumeCount}/{s.maxConsumes}
                    </p>
                    <p className="text-zinc-500">
                      Expira: {new Date(s.expiresAt).toLocaleString('es-CL')}
                    </p>
                    {s.recipientClaim && s.status === 'pending' && (
                      <div className="mt-2 rounded-md border border-teal-200 bg-teal-50 p-2 text-teal-950">
                        <p>
                          Solicitud de {s.recipientClaim.displayName} Â· registro{' '}
                          {s.recipientClaim.registryNumber}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleConfirmRecipient(s)}
                          className="mt-1 font-semibold underline"
                        >
                          Confirmar este profesional
                        </button>
                      </div>
                    )}
                    {s.revokedAt && (
                      <p className="text-amber-700 dark:text-amber-400">
                        Revocado: {new Date(s.revokedAt).toLocaleString('es-CL')}
                      </p>
                    )}
                  </div>
                  {!s.revokedAt && Date.now() < s.expiresAt && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(s.id)}
                      className="self-start text-red-700 dark:text-red-400 underline"
                    >
                      Revocar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default HealthVaultShare;

// Praeventio Guard — Round 14 (R5 agent): worker-side claim creation form.
//
// Flow:
//   1. Worker writes a free-text claim (≤500 chars) and picks a category.
//   2. Worker names 2 referees (name + email each).
//   3. On submit: trigger WebAuthn via the existing useBiometricAuth hook.
//      If unsupported, the worker can tick a "yo declaro" fallback box
//      (we still log a downgrade reason for the audit trail).
//   4. POST to /api/curriculum/claim with the ID token.
//   5. Backend generates the 2 referee tokens, sends magic-link emails
//      via Resend, returns { claimId } once the work is durable.
//
// We deliberately keep the WebAuthn assertion opaque — the hook returns
// a boolean, not a credential payload, because Round 13's WebAuthn flow
// is a local-only proof-of-presence (see `src/hooks/useBiometricAuth.ts`).
// The claim doc captures `webauthnCredentialId` only when the navigator
// returns one; otherwise we record `fallbackAttest=true` with a reason.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, UserCheck, Fingerprint } from 'lucide-react';
import { Button, Card } from '../shared/Card';
import { useFirebase } from '../../contexts/FirebaseContext';
import { auth } from '../../services/firebase';
import { useBiometricAuth } from '../../hooks/useBiometricAuth';
import type { ClaimCategory } from '../../services/curriculum/claims';

const CATEGORY_LABELS: Record<ClaimCategory, string> = {
  experience: 'Experiencia laboral',
  certification: 'Certificación',
  incident_record: 'Registro de incidentes',
  other: 'Otro',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ClaimFormProps {
  onCreated?: (claimId: string) => void;
  onCancel?: () => void;
}

export function ClaimForm({ onCreated, onCancel }: ClaimFormProps) {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { isSupported, authenticate } = useBiometricAuth();
  const categoryLabelI18n: Record<ClaimCategory, string> = {
    experience: t('curriculum.category_experience', 'Experiencia laboral'),
    certification: t('curriculum.category_certification', 'Certificación'),
    incident_record: t('curriculum.category_incident_record', 'Registro de incidentes'),
    other: t('curriculum.category_other', 'Otro'),
  };

  const [claim, setClaim] = useState('');
  const [category, setCategory] = useState<ClaimCategory>('experience');
  const [r1Name, setR1Name] = useState('');
  const [r1Email, setR1Email] = useState('');
  const [r2Name, setR2Name] = useState('');
  const [r2Email, setR2Email] = useState('');
  const [fallbackAttest, setFallbackAttest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function validate(): string | null {
    const trimmed = claim.trim();
    if (!trimmed) return t('curriculum.error_empty_claim', 'Escribe el contenido del claim antes de firmarlo.');
    if (trimmed.length > 500) return t('curriculum.error_claim_too_long', 'El claim no puede superar 500 caracteres.');
    if (!r1Name.trim() || !r2Name.trim()) return t('curriculum.error_referee_names_required', 'Ambos nombres de referencia son obligatorios.');
    if (!EMAIL_RE.test(r1Email) || !EMAIL_RE.test(r2Email)) return t('curriculum.error_invalid_email', 'Revisa los emails de las referencias — alguno no es válido.');
    if (r1Email.trim().toLowerCase() === r2Email.trim().toLowerCase()) return t('curriculum.error_same_email', 'Las dos referencias deben tener emails distintos.');
    if (!isSupported && !fallbackAttest) return t('curriculum.error_no_biometric', 'Tu dispositivo no soporta huella; debes confirmar la declaración manual para continuar.');
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!user || !auth.currentUser) {
      setError(t('curriculum.error_inactive_session', 'Tu sesión no está activa. Inicia sesión nuevamente.'));
      return;
    }
    setSubmitting(true);
    try {
      // Step 1: WebAuthn proof-of-presence (or fallback "yo declaro").
      let webauthnOk = false;
      let fallbackReason: string | undefined;
      if (isSupported) {
        webauthnOk = await authenticate(t('curriculum.biometric_prompt', 'Firma tu claim: "{{preview}}..."', { preview: claim.slice(0, 60) }));
        if (!webauthnOk) {
          throw new Error(t('curriculum.error_biometric_fail', 'No pudimos confirmar la huella. Cancela y vuelve a intentar.'));
        }
      } else {
        fallbackReason = 'webauthn_unsupported_device';
      }

      // Step 2: POST to backend.
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/curriculum/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          claim: claim.trim(),
          category,
          referees: [
            { name: r1Name.trim(), email: r1Email.trim() },
            { name: r2Name.trim(), email: r2Email.trim() },
          ],
          signedByWorker: {
            // We don't expose the raw assertion (the hook abstracts it);
            // record only the signal of method.
            webauthnCredentialId: webauthnOk ? 'local-presence' : undefined,
            fallbackAttest: !webauthnOk,
            fallbackReason,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t('curriculum.error_create_claim', 'No se pudo crear el claim.'));
      setSuccess(true);
      onCreated?.(data.claimId);
    } catch (err: any) {
      setError(err?.message || t('curriculum.error_unknown', 'Error desconocido al crear el claim.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <Card className="p-6 space-y-4 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
        <h3 className="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-white">
          {t('curriculum.success_title', 'Claim enviado')}
        </h3>
        <p className="text-sm text-zinc-500">
          {t('curriculum.success_message', 'Las dos personas que nombraste recibirán un email con un enlace mágico para co-firmar. Tu claim quedará verificado cuando ambas firmen (máximo 14 días).')}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-emerald-500/10">
          <ShieldCheck className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white">
            {t('curriculum.form_title', 'Nuevo claim verificable')}
          </h3>
          <p className="text-xs text-zinc-500">
            {t('curriculum.form_subtitle', 'Tu palabra firmada con huella + 2 referencias = currículum a prueba de fraude.')}
          </p>
        </div>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">
            {t('curriculum.field_category', 'Categoría')}
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ClaimCategory)}
            className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-white"
          >
            {(Object.keys(CATEGORY_LABELS) as ClaimCategory[]).map((k) => (
              <option key={k} value={k}>{categoryLabelI18n[k]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">
            {t('curriculum.field_claim', 'Tu claim ({{count}}/500)', { count: claim.trim().length })}
          </label>
          <textarea
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={t('curriculum.field_claim_placeholder', 'Ej: He trabajado 5 años como capataz de seguridad en obra sin incidentes graves.')}
            className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-white resize-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('curriculum.referee_1', 'Referencia 1')}</p>
            <input
              value={r1Name}
              onChange={(e) => setR1Name(e.target.value)}
              placeholder={t('curriculum.placeholder_name', 'Nombre')}
              className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm"
            />
            <input
              value={r1Email}
              onChange={(e) => setR1Email(e.target.value)}
              placeholder={t('curriculum.placeholder_email', 'Email')}
              type="email"
              className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm"
            />
          </div>
          <div className="space-y-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('curriculum.referee_2', 'Referencia 2')}</p>
            <input
              value={r2Name}
              onChange={(e) => setR2Name(e.target.value)}
              placeholder={t('curriculum.placeholder_name', 'Nombre')}
              className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm"
            />
            <input
              value={r2Email}
              onChange={(e) => setR2Email(e.target.value)}
              placeholder={t('curriculum.placeholder_email', 'Email')}
              type="email"
              className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm"
            />
          </div>
        </div>

        {!isSupported && (
          <label className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
            <input
              type="checkbox"
              checked={fallbackAttest}
              onChange={(e) => setFallbackAttest(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t('curriculum.fallback_attest', 'Tu dispositivo no soporta firma biométrica. Marca esta casilla para declarar manualmente que el contenido del claim es verídico (queda registrado en el log de auditoría).')}
            </span>
          </label>
        )}

        {error && (
          <div className="flex items-center gap-2 text-rose-500 text-xs font-bold bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              {t('common.cancel', 'Cancelar')}
            </Button>
          )}
          <Button type="submit" disabled={submitting} className="gap-2">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : isSupported ? <Fingerprint className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
            {submitting ? t('curriculum.signing', 'Firmando...') : isSupported ? t('curriculum.submit_biometric', 'Firmar con huella y enviar') : t('curriculum.submit_manual', 'Declarar y enviar')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

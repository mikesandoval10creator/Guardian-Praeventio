// Praeventio Guard — MFA TOTP real (RFC 6238).
//
// Antes esta página era `setTimeout(1.5s)` simulando enrollment con
// "QR Simulado" y recovery codes hardcoded. AHORA implementa TOTP
// completo:
//
//   - generateSecret() RFC 6238 (20 bytes HMAC-SHA1, @noble/hashes)
//   - QR code real con otpauth:// URI compatible con Google
//     Authenticator, Authy, 1Password, Microsoft Authenticator
//   - Verificación del primer código con clock drift ±30s
//   - 10 recovery codes single-use (SHA-256 hashed, NO plaintext en storage)
//   - Persistencia local cifrada via encryptedKvStore (KEK device-bound)
//   - Disable requiere código válido (anti-takeover si la sesión es robada)

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  Key,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Copy,
  Download,
  Lock,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { Card, Button } from '../components/shared/Card';
import {
  startEnrollment,
  confirmEnrollment,
  useRecoveryCode,
  countAvailableRecoveryCodes,
  disableEnrollment,
  TotpEnrollmentError,
  type TotpEnrollmentDraft,
  type TotpEnrolledRecord,
} from '../services/auth/totpEnrollment';
import {
  getEncrypted,
  setEncrypted,
  deleteEncrypted,
} from '../services/security/encryptedKvStore';
import { useFirebase } from '../contexts/FirebaseContext';

// Pre-2026-07 this was a single fixed key shared by every account on the
// device, so the next user to log in inherited the previous user's enrollment.
// The record is now stored per uid, and the userUid inside the record is
// checked against the authenticated user before it is trusted.
const MFA_STORAGE_KEY_LEGACY = 'mfa:totp:record:v1';

function mfaStorageKey(uid: string): string {
  return `${MFA_STORAGE_KEY_LEGACY}:${uid}`;
}

type ViewState =
  | 'loading'
  | 'not-enrolled'
  | 'enrolling-show-qr'
  | 'enrolled'
  | 'disabling';

export function SecurityShield() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const [view, setView] = useState<ViewState>('loading');
  const [draft, setDraft] = useState<TotpEnrollmentDraft | null>(null);
  const [record, setRecord] = useState<TotpEnrolledRecord | null>(null);
  const [verifyInput, setVerifyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);

  // Carga el record persistido del usuario autenticado. Depende de `user`:
  // on a shared device the component can outlive a sign-out/sign-in, and a
  // mount-only effect would keep showing the previous account's enrollment.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A legacy unscoped record belongs to whoever enrolled last on this
      // device. It can't be attributed to anyone safely, so it is destroyed
      // rather than migrated — adopting an MFA secret we can't tie to the
      // current user is the very bug this replaces.
      try {
        await deleteEncrypted(MFA_STORAGE_KEY_LEGACY);
      } catch {
        /* best-effort purge — never block the page on it */
      }
      if (!user) {
        if (!cancelled) setView('not-enrolled');
        return;
      }
      try {
        const stored = (await getEncrypted(mfaStorageKey(user.uid))) as
          | TotpEnrolledRecord
          | null;
        if (cancelled) return;
        // Defense in depth: the uid inside the record is the authority, not
        // the key it was found under.
        if (
          stored &&
          stored.status === 'enrolled' &&
          stored.userUid === user.uid
        ) {
          setRecord(stored);
          setView('enrolled');
        } else {
          setRecord(null);
          setView('not-enrolled');
        }
      } catch {
        if (!cancelled) setView('not-enrolled');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleStartEnrollment = useCallback(() => {
    setError(null);
    setSuccess(null);
    if (!user) {
      setError(
        t('mfa.errorNoUser', 'Debes iniciar sesión para activar MFA.') as string,
      );
      return;
    }
    const newDraft = startEnrollment({
      userUid: user.uid,
      accountName: user.email ?? user.uid,
      issuer: 'Praeventio',
    });
    setDraft(newDraft);
    setView('enrolling-show-qr');
  }, [user, t]);

  const handleConfirmCode = useCallback(async () => {
    setError(null);
    if (!draft || !user) return;
    try {
      const newRecord = confirmEnrollment({ draft, userCode: verifyInput });
      await setEncrypted(mfaStorageKey(user.uid), newRecord);
      setRecord(newRecord);
      setView('enrolled');
      setSuccess(
        t(
          'mfa.successEnrolled',
          'MFA activada. Guarda los códigos de recuperación en un lugar seguro.',
        ) as string,
      );
      setVerifyInput('');
      setShowRecoveryCodes(true);
    } catch (err) {
      if (err instanceof TotpEnrollmentError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [draft, verifyInput, t, user]);

  const handleStartDisable = useCallback(() => {
    setError(null);
    setSuccess(null);
    setVerifyInput('');
    setView('disabling');
  }, []);

  const handleConfirmDisable = useCallback(async () => {
    setError(null);
    if (!record || !user) return;
    const ok = disableEnrollment({ record, userCode: verifyInput });
    if (!ok) {
      setError(
        t(
          'mfa.errorDisableInvalid',
          'Código inválido — MFA NO se ha desactivado.',
        ) as string,
      );
      return;
    }
    await deleteEncrypted(mfaStorageKey(user.uid));
    setRecord(null);
    setDraft(null);
    setView('not-enrolled');
    setSuccess(t('mfa.successDisabled', 'MFA desactivada.') as string);
    setVerifyInput('');
  }, [record, verifyInput, t, user]);

  const handleCancelEnrollment = useCallback(() => {
    setDraft(null);
    setVerifyInput('');
    setError(null);
    setView('not-enrolled');
  }, []);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setSuccess(`${label} copiado.`);
      setTimeout(() => setSuccess(null), 2000);
    });
  }, []);

  const downloadRecoveryCodes = useCallback(() => {
    if (!draft) return;
    const text = [
      'Praeventio Guard — Códigos de recuperación MFA',
      `Usuario: ${user?.email ?? user?.uid ?? '—'}`,
      `Generados: ${new Date().toISOString()}`,
      '',
      'Cada código es de un solo uso. Guarda este archivo en un lugar seguro.',
      'Si pierdes acceso a tu Authenticator app, usa uno de estos códigos.',
      '',
      ...draft.recoveryCodesPlaintext.map(
        (c, i) => `${(i + 1).toString().padStart(2, '0')}. ${c}`,
      ),
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `praeventio-mfa-recovery-codes-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [draft, user]);

  return (
    <div
      data-testid="security-shield-page"
      data-view={view}
      className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6"
    >
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Shield className="w-8 h-8 text-indigo-500" aria-hidden="true" />
            {t('securityShield.title', 'Autenticación de dos factores')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('securityShield.subtitle', 'MFA TOTP — RFC 6238')}
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-indigo-500 bg-indigo-500/10 border-indigo-500/20">
          <Lock className="w-5 h-5" aria-hidden="true" />
          <span
            className="font-bold uppercase tracking-wider text-sm"
            data-testid="mfa-status-badge"
          >
            {view === 'enrolled'
              ? t('mfa.statusActive', 'MFA Activa')
              : t('mfa.statusInactive', 'MFA Inactiva')}
          </span>
        </div>
      </header>

      {error && (
        <div
          data-testid="mfa-error"
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2"
        >
          <AlertTriangle
            className="w-4 h-4 text-rose-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-xs text-rose-300">{error}</p>
        </div>
      )}

      {success && (
        <div
          data-testid="mfa-success"
          role="status"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 flex items-start gap-2"
        >
          <CheckCircle2
            className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-xs text-emerald-300">{success}</p>
        </div>
      )}

      {view === 'loading' && (
        <Card className="p-8 border-white/5 text-center">
          <p
            className="text-sm text-secondary animate-pulse"
            data-testid="mfa-loading"
          >
            {t('mfa.loading', 'Cargando estado MFA…')}
          </p>
        </Card>
      )}

      {view === 'not-enrolled' && (
        <Card className="p-6 border-white/5 space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-rose-500/10">
              <AlertTriangle
                className="w-6 h-6 text-rose-400"
                aria-hidden="true"
              />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-primary mb-1">
                {t('mfa.notEnrolledTitle', 'MFA no está activa')}
              </h2>
              <p className="text-sm text-secondary leading-relaxed">
                {t(
                  'mfa.notEnrolledDesc',
                  'Tu cuenta es vulnerable a phishing y robo de credenciales. Activa la autenticación de dos factores con Google Authenticator, Authy o 1Password.',
                )}
              </p>
            </div>
          </div>
          <Button
            onClick={handleStartEnrollment}
            data-testid="mfa-start-enrollment"
            className="w-full"
          >
            <Key className="w-4 h-4 mr-2" aria-hidden="true" />
            {t('mfa.enableButton', 'Activar MFA')}
          </Button>
        </Card>
      )}

      {view === 'enrolling-show-qr' && draft && (
        <Card className="p-6 border-white/5 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-primary mb-2 flex items-center gap-2">
              <Smartphone
                className="w-5 h-5 text-indigo-500"
                aria-hidden="true"
              />
              {t(
                'mfa.step1Title',
                'Paso 1: escanea el QR con tu Authenticator app',
              )}
            </h2>
            <p className="text-xs text-secondary mb-4 leading-relaxed">
              {t(
                'mfa.step1Desc',
                'Abre Google Authenticator, Authy, 1Password o Microsoft Authenticator y escanea este código. Si no puedes escanear, ingresa el secret manualmente.',
              )}
            </p>
          </div>

          <div className="flex flex-col items-center gap-4">
            <div
              className="p-4 bg-white rounded-xl"
              data-testid="mfa-qr-container"
            >
              <QRCodeCanvas
                value={draft.provisioningUri}
                size={220}
                level="M"
              />
            </div>
            <div className="w-full">
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-token mb-1">
                {t('mfa.secretLabel', 'Secret (para entrada manual)')}
              </p>
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-elevated border border-default-token">
                <code
                  data-testid="mfa-secret-display"
                  className="text-xs font-mono text-secondary flex-1 break-all"
                >
                  {draft.secretBase32.match(/.{1,4}/g)!.join(' ')}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(draft.secretBase32, 'Secret')}
                  className="p-1.5 rounded hover:bg-white/5"
                  aria-label={t('mfa.copySecret', 'Copiar secret') as string}
                >
                  <Copy className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-default-token">
            <h3 className="text-sm font-bold text-primary">
              {t('mfa.step2Title', 'Paso 2: ingresa el código de 6 dígitos')}
            </h3>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={verifyInput}
              onChange={(e) =>
                setVerifyInput(e.target.value.replace(/\D/g, ''))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && verifyInput.length === 6) {
                  void handleConfirmCode();
                }
              }}
              data-testid="mfa-code-input"
              placeholder="123456"
              className="w-full px-4 py-3 rounded-md border border-default-token bg-elevated text-primary text-2xl font-mono text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                onClick={handleConfirmCode}
                disabled={verifyInput.length !== 6}
                data-testid="mfa-confirm-code"
                className="flex-1"
              >
                {t('mfa.confirmButton', 'Confirmar y activar')}
              </Button>
              <Button
                variant="secondary"
                onClick={handleCancelEnrollment}
                data-testid="mfa-cancel-enrollment"
              >
                {t('common.cancel', 'Cancelar')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {view === 'enrolled' && record && (
        <>
          <Card className="p-6 border-white/5 space-y-4">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-emerald-500/10">
                <CheckCircle2
                  className="w-6 h-6 text-emerald-400"
                  aria-hidden="true"
                />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-primary mb-1">
                  {t('mfa.enrolledTitle', 'MFA está activa')}
                </h2>
                <p className="text-sm text-secondary leading-relaxed mb-2">
                  {t(
                    'mfa.enrolledDesc',
                    'Tu cuenta está protegida por autenticación de dos factores. Al iniciar sesión necesitarás el código de tu Authenticator app.',
                  )}
                </p>
                <p
                  className="text-xs text-muted-token"
                  data-testid="mfa-enrolled-at"
                >
                  {t('mfa.enrolledAt', 'Activada')}:{' '}
                  {new Date(record.enrolledAtIso).toLocaleString()}
                </p>
                <p
                  className="text-xs text-muted-token mt-1"
                  data-testid="mfa-recovery-count"
                >
                  {t(
                    'mfa.recoveryCount',
                    'Códigos de recuperación disponibles',
                  )}
                  :{' '}
                  <span
                    className={
                      countAvailableRecoveryCodes(record) <= 2
                        ? 'text-rose-400 font-bold'
                        : 'text-emerald-400 font-bold'
                    }
                  >
                    {countAvailableRecoveryCodes(record)}/
                    {record.recoveryCodeHashes.length}
                  </span>
                </p>
              </div>
            </div>

            <Button
              variant="danger"
              onClick={handleStartDisable}
              data-testid="mfa-disable"
              className="w-full"
            >
              {t('mfa.disableButton', 'Desactivar MFA')}
            </Button>
          </Card>

          {showRecoveryCodes && draft && (
            <Card className="p-6 border-amber-500/30 bg-amber-500/5 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="w-5 h-5 text-amber-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-base font-bold text-amber-200 mb-1">
                    {t('mfa.recoveryTitle', 'Guarda estos códigos AHORA')}
                  </h3>
                  <p className="text-xs text-amber-100/80">
                    {t(
                      'mfa.recoveryDesc',
                      'Si pierdes tu teléfono, estos códigos son la única forma de recuperar tu cuenta. Cada uno funciona UNA sola vez. No se mostrarán de nuevo.',
                    )}
                  </p>
                </div>
              </div>

              <ul
                data-testid="mfa-recovery-codes"
                className="grid grid-cols-2 gap-2 font-mono text-sm"
              >
                {draft.recoveryCodesPlaintext.map((code, i) => (
                  <li
                    key={i}
                    data-testid={`mfa-recovery-code-${i}`}
                    className="p-2 rounded bg-elevated border border-default-token text-secondary text-center tracking-widest"
                  >
                    {code}
                  </li>
                ))}
              </ul>

              <div className="flex gap-2">
                <Button
                  onClick={downloadRecoveryCodes}
                  data-testid="mfa-download-recovery"
                  className="flex-1"
                >
                  <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                  {t('mfa.downloadRecovery', 'Descargar .txt')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    copyToClipboard(
                      draft.recoveryCodesPlaintext.join('\n'),
                      'Códigos',
                    )
                  }
                  data-testid="mfa-copy-recovery"
                >
                  <Copy className="w-4 h-4 mr-2" aria-hidden="true" />
                  {t('mfa.copyRecovery', 'Copiar todos')}
                </Button>
              </div>
              <Button
                variant="secondary"
                onClick={() => setShowRecoveryCodes(false)}
                data-testid="mfa-hide-recovery"
                className="w-full text-xs"
              >
                {t('mfa.recoverySaved', 'Ya los guardé — ocultar')}
              </Button>
            </Card>
          )}
        </>
      )}

      {view === 'disabling' && record && (
        <Card className="p-6 border-rose-500/30 bg-rose-500/5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-primary mb-2 flex items-center gap-2">
              <ShieldAlert
                className="w-5 h-5 text-rose-400"
                aria-hidden="true"
              />
              {t('mfa.disableTitle', 'Desactivar MFA')}
            </h2>
            <p className="text-sm text-secondary leading-relaxed">
              {t(
                'mfa.disableDesc',
                'Para desactivar MFA necesitas ingresar un código actual de tu Authenticator app. Esto previene que un atacante con tu sesión activa pueda desactivar la protección.',
              )}
            </p>
          </div>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={verifyInput}
            onChange={(e) => setVerifyInput(e.target.value.replace(/\D/g, ''))}
            data-testid="mfa-disable-input"
            placeholder="123456"
            className="w-full px-4 py-3 rounded-md border border-rose-500/30 bg-elevated text-primary text-2xl font-mono text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-rose-500/40"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={handleConfirmDisable}
              disabled={verifyInput.length !== 6}
              data-testid="mfa-confirm-disable"
              className="flex-1"
            >
              {t('mfa.confirmDisable', 'Confirmar desactivación')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setView('enrolled');
                setVerifyInput('');
                setError(null);
              }}
              data-testid="mfa-cancel-disable"
            >
              {t('common.cancel', 'Cancelar')}
            </Button>
          </div>
        </Card>
      )}

      <p className="text-[10px] text-muted-token italic text-center">
        {t(
          'mfa.standardNote',
          'Implementación RFC 6238 — compatible con Google Authenticator, Authy, 1Password, Microsoft Authenticator.',
        )}
      </p>
    </div>
  );
}

export default SecurityShield;

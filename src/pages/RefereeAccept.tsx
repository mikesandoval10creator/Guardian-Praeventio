// Praeventio Guard — Round 14 (R5 agent): magic-link landing for referees.
//
// Route: /curriculum/referee/:token
//
// Public (NO auth required). The token in the URL is the raw 32-byte hex
// referee token; the server hashes it and looks up the matching claim.
//
// Flow:
//   1. On mount, GET /api/curriculum/referee/:token  → returns {
//        claimText, workerName, refereeName, status, alreadySigned
//      } or 404/410 if invalid/expired.
//   2. The page renders a co-sign card.
//   3. Three actions:
//      • "Co-firmar con huella"  — LOCAL device biometric (proof-of-presence).
//        Recorded server-side as a 'device_attested' co-sign, NOT a
//        cryptographically verified WebAuthn signature: a magic-link referee
//        is unauthenticated and has no enrolled credential (see F4).
//      • "Co-firmar (estándar)"  — opaque acknowledgement timestamp.
//      • "Rechazar"              — declines the claim.
//   4. POST /api/curriculum/referee/:token  with the chosen method.
//   5. Show success / error / "ya firmado" states.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, Fingerprint, X, UserCheck } from 'lucide-react';
import { useBiometricAuth } from '../hooks/useBiometricAuth';

interface RefereePreview {
  claimText: string;
  workerName: string;
  workerEmail: string;
  refereeName: string;
  refereeEmail: string;
  category: string;
  status: 'pending_referees' | 'verified' | 'rejected' | 'expired';
  alreadySigned: boolean;
  expiresAt: string;
}

export function RefereeAccept() {
  const { t } = useTranslation();
  const { token = '' } = useParams<{ token: string }>();
  const { isSupported, authenticate } = useBiometricAuth();

  const [preview, setPreview] = useState<RefereePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'webauthn' | 'standard' | 'decline' | null>(null);
  const [submitted, setSubmitted] = useState<'signed' | 'declined' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load preview on mount. The GET path is read-only; an attacker that
  // brute-forced a token would still need to POST to actually sign,
  // and the server's rate limiter applies to both verbs.
  useEffect(() => {
    if (!token) {
      setLoadError('Enlace inválido.');
      return;
    }
    fetch(`/api/curriculum/referee/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setLoadError(data?.error || 'No se pudo cargar el claim.');
          return;
        }
        setPreview(data);
      })
      .catch(() => setLoadError('No se pudo cargar el claim. Revisa tu conexión.'));
  }, [token]);

  async function submit(method: 'webauthn' | 'standard' | 'decline') {
    if (!preview) return;
    setSubmitting(method);
    setSubmitError(null);
    try {
      let signature = '';
      if (method === 'webauthn') {
        if (!isSupported) {
          throw new Error('Tu dispositivo no soporta firma biométrica. Usa "Co-firmar (estándar)".');
        }
        const ok = await authenticate(`Co-firma el claim de ${preview.workerName}`);
        if (!ok) throw new Error('No se pudo confirmar la huella. Vuelve a intentar.');
        // Local device proof-of-presence only — the server records this as a
        // 'device_attested' co-sign, NOT a cryptographically verified WebAuthn
        // signature (a magic-link referee has no enrolled credential). The
        // marker string is honest about what this actually represents. The
        // POST body still sends method:'webauthn' as the biometric INTENT
        // (the route allow-list is {webauthn,standard}); the server coerces it.
        signature = `device-attested:${new Date().toISOString()}`;
      } else if (method === 'standard') {
        signature = `standard:${new Date().toISOString()}`;
      } else {
        signature = `decline:${new Date().toISOString()}`;
      }

      const res = await fetch(`/api/curriculum/referee/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: method === 'decline' ? 'decline' : 'cosign',
          method: method === 'decline' ? 'standard' : method,
          signature,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'No se pudo registrar tu respuesta.');
      setSubmitted(method === 'decline' ? 'declined' : 'signed');
    } catch (err: any) {
      setSubmitError(err?.message || 'Error desconocido.');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/30 via-zinc-950 to-blue-950/20 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="bg-surface border border-default-token rounded-3xl overflow-hidden shadow-2xl">
          <div className="bg-elevated/50 px-8 pt-8 pb-6 text-center border-b border-default-token">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-7 h-7 text-emerald-500" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-1">{t('refereeAccept.brand', 'Praeventio Guard')}</p>
            <h1 className="text-xl font-black text-primary-token uppercase tracking-tight">{t('refereeAccept.title', 'Co-firmar Claim')}</h1>
          </div>

          <div className="px-8 py-7 space-y-6">
            {/* Loading */}
            {!preview && !loadError && (
              <div className="flex justify-center py-6">
                <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
              </div>
            )}

            {/* Load error */}
            {loadError && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <AlertTriangle className="w-10 h-10 text-rose-500" />
                <p className="text-sm font-bold text-primary-token">{t('refereeAccept.linkUnavailable', 'Enlace no disponible')}</p>
                <p className="text-xs text-muted-token">{loadError}</p>
              </div>
            )}

            {/* Preview + actions */}
            {preview && !submitted && (
              <>
                <div className="space-y-3">
                  <p className="text-xs text-muted-token">
                    Hola <span className="text-primary-token font-bold">{preview.refereeName}</span>.
                    {' '}
                    <span className="text-primary-token font-bold">{preview.workerName}</span> te nombró referencia
                    en este claim:
                  </p>
                  <blockquote className="bg-elevated/50 border-l-4 border-emerald-500 rounded-xl p-3 text-sm text-secondary-token italic">
                    "{preview.claimText}"
                  </blockquote>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-token">
                    Categoría: {preview.category}
                  </p>
                </div>

                {preview.alreadySigned && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs">
                    <CheckCircle2 className="w-4 h-4" />
                    Ya firmaste este claim anteriormente. Gracias.
                  </div>
                )}

                {!preview.alreadySigned && preview.status === 'pending_referees' && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-token text-center">¿Confirmas la veracidad del claim?</p>
                    <button
                      onClick={() => submit('webauthn')}
                      disabled={!!submitting || !isSupported}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black uppercase tracking-widest text-sm transition-colors disabled:opacity-40"
                    >
                      {submitting === 'webauthn' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                      {t('refereeAccept.cosignBiometric', 'Co-firmar con huella')}
                    </button>
                    <button
                      onClick={() => submit('standard')}
                      disabled={!!submitting}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-elevated hover:bg-elevated/80 text-primary-token font-black uppercase tracking-widest text-sm transition-colors disabled:opacity-40"
                    >
                      {submitting === 'standard' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                      {t('refereeAccept.cosignStandard', 'Co-firmar (estándar)')}
                    </button>
                    <button
                      onClick={() => submit('decline')}
                      disabled={!!submitting}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-black uppercase tracking-widest text-sm transition-colors disabled:opacity-40"
                    >
                      {submitting === 'decline' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                      {t('refereeAccept.decline', 'Rechazar')}
                    </button>
                    {!isSupported && (
                      <p className="text-[10px] text-muted-token text-center">
                        La huella no está disponible en este dispositivo. Usa "estándar".
                      </p>
                    )}
                  </div>
                )}

                {submitError && (
                  <div className="flex items-center gap-2 text-rose-500 text-xs font-bold bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {submitError}
                  </div>
                )}

                {preview.status !== 'pending_referees' && !preview.alreadySigned && (
                  <p className="text-xs text-muted-token text-center">
                    Este claim ya está {preview.status === 'verified' ? 'verificado' : preview.status === 'expired' ? 'expirado' : 'rechazado'}.
                  </p>
                )}
              </>
            )}

            {submitted === 'signed' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-3 py-6 text-center"
              >
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                <p className="text-lg font-black text-primary-token uppercase tracking-tight">{t('refereeAccept.signedTitle', 'Co-firma registrada')}</p>
                <p className="text-sm text-muted-token">{t('refereeAccept.signedBody', 'Gracias por respaldar este claim.')}</p>
              </motion.div>
            )}
            {submitted === 'declined' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-3 py-6 text-center"
              >
                <X className="w-12 h-12 text-rose-500" />
                <p className="text-lg font-black text-primary-token uppercase tracking-tight">{t('refereeAccept.declinedTitle', 'Rechazo registrado')}</p>
                <p className="text-sm text-muted-token">{t('refereeAccept.declinedBody', 'El trabajador será notificado.')}</p>
              </motion.div>
            )}
          </div>
        </div>

        <p className="text-center text-[10px] text-muted-token mt-4 font-bold uppercase tracking-widest">
          © {new Date().getFullYear()} Praeventio Guard
        </p>
      </motion.div>
    </div>
  );
}

export default RefereeAccept;

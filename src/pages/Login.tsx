import { motion } from 'framer-motion';
import { logger } from '../utils/logger';
import { useTranslation } from 'react-i18next';
import { signInWithGoogle, logOut, auth, db } from '../services/firebase';
import { LogIn, Zap, WifiOff, ArrowLeft } from 'lucide-react';
import { Button } from '../components/shared/Card';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useBiometricAuth } from '../hooks/useBiometricAuth';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { analytics, userIdHash } from '../services/analytics';

// localStorage flag: set ONLY after a server-persisted WebAuthn credential
// exists (registerCredential succeeded). Drives whether we offer the
// biometric step-up button. The legacy 'praeventio_biometric_id' flag is
// intentionally NOT read — it tracked a local-only rawId that the server
// /verify endpoint can never validate (unknown_credential), so trusting it
// would render a guaranteed-fail button.
const WEBAUTHN_ENROLLED_KEY = 'praeventio_webauthn_enrolled';

export default function Login() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  // Real server-verified WebAuthn hook (same one every other signing flow
  // uses). `authenticate(reason, 'login')` is fail-closed: it fetches a
  // server-issued challenge, runs the platform ceremony, and round-trips
  // the assertion through POST /api/auth/webauthn/verify (signature +
  // monotonic-counter replay check, server-side). It returns false on
  // unreachable server, 401, replay, or an unenrolled credential.
  const { isSupported, authenticate, registerCredential } = useBiometricAuth();
  const [hasEnrolledCredential, setHasEnrolledCredential] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    // Only offer the biometric step-up button when (a) the platform
    // supports WebAuthn AND (b) we have previously persisted a SERVER
    // credential on this device. Without (b), /verify would always return
    // unknown_credential and the button would be a guaranteed fail.
    if (isSupported) {
      try {
        setHasEnrolledCredential(
          localStorage.getItem(WEBAUTHN_ENROLLED_KEY) === '1',
        );
      } catch {
        setHasEnrolledCredential(false);
      }
    }
  }, [isSupported]);

  // After a primary Google sign-in, best-effort enroll a SERVER-verifiable
  // WebAuthn credential so future logins can step up biometrically. Uses
  // the real registerCredential() ceremony (/register/options +
  // /register/verify) which persists the public key server-side — unlike
  // the legacy registerBiometric() which only kept a local rawId the
  // server could never validate. Failures are non-fatal: the user is
  // already signed in; they just won't see the biometric button next time.
  const maybeEnrollCredential = async (uid: string) => {
    if (!isSupported) return;
    try {
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (!userSnap.exists()) {
        try {
          analytics.track('auth.user.signed_up', {
            provider: 'google',
            user_id_hash: await userIdHash(uid),
          });
        } catch { /* analytics must never break user flow */ }
        // Brand-new account: the server seeds the user doc on first login;
        // enrollment can happen on the next visit once the doc exists.
        return;
      }
      try {
        analytics.track('auth.user.signed_in', {
          provider: 'google',
          mfa_used: false,
        });
      } catch { /* analytics must never break user flow */ }
      const result = await registerCredential(
        t('auth.biometric_enroll_reason', 'Registra tu biometría para próximos ingresos'),
      );
      if (result.success) {
        try { localStorage.setItem(WEBAUTHN_ENROLLED_KEY, '1'); } catch { /* private mode */ }
        setHasEnrolledCredential(true);
      }
    } catch (e) {
      logger.debug('Biometric enrollment skipped', { error: e });
    }
  };

  const handleLogin = async () => {
    if (!isOnline) return;
    setAuthError(null);
    setIsLoading(true);
    try {
      await signInWithGoogle();
      const user = auth.currentUser;
      if (user) {
        await maybeEnrollCredential(user.uid);
      }
    } catch (error) {
      logger.error('Error logging in', { error });
      setAuthError(t('auth.login_failed', 'No se pudo iniciar sesión. Intentá de nuevo.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (!hasEnrolledCredential) return;
    setAuthError(null);
    setIsLoading(true);
    try {
      // STEP 1: establish the Firebase session. WebAuthn here is
      // server-verified STEP-UP proof-of-presence — the /challenge and
      // /verify endpoints sit behind verifyAuth, so a session must exist
      // before the assertion can be cryptographically checked.
      await signInWithGoogle();
      const user = auth.currentUser;
      if (!user) {
        setAuthError(t('auth.biometric_failed', 'La verificación biométrica falló.'));
        return;
      }
      // STEP 2: REQUIRE a server-verified WebAuthn assertion. authenticate
      // with purpose 'login' is fail-closed — false means the server
      // rejected the assertion (replay/expiry/unknown credential) OR the
      // challenge endpoint was unreachable. Either way we MUST NOT keep the
      // session: tear it down so an unverified presence cannot proceed.
      const verified = await authenticate(
        t('auth.biometric_login_prompt', 'Confirma tu identidad'),
        'login',
      );
      if (!verified) {
        try { await logOut(); } catch (e) { logger.warn('signOut after failed biometric failed', { error: e }); }
        setAuthError(t('auth.biometric_failed', 'La verificación biométrica falló.'));
      }
      // verified === true: session stands; FirebaseContext's onAuthStateChanged
      // routes the user onward exactly as the Google path does.
    } catch (error) {
      logger.error('Biometric verification failed', { error });
      try { await logOut(); } catch { /* best-effort fail-closed sign-out */ }
      setAuthError(t('auth.biometric_failed', 'La verificación biométrica falló.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main
      role="main"
      aria-labelledby="login-heading"
      className="min-h-screen flex items-center justify-center bg-canvas text-primary-token p-4 sm:p-6 font-sans relative"
    >
      <div className="max-w-md w-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="bg-elevated rounded-[2rem] sm:rounded-3xl p-6 sm:p-10 shadow-mode-lg border border-default-token relative overflow-hidden"
        >
          {/* Background Accents (decorative — hidden from a11y tree) */}
          <div aria-hidden="true" className="absolute -top-24 -right-24 w-48 h-48 bg-[#4db6ac]/10 rounded-full blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />

          <div className="relative z-10">
            <Link
              to="/"
              className="inline-flex items-center gap-2 min-h-[44px] text-muted-token hover:text-primary-token transition-colors font-medium text-xs uppercase tracking-wider mb-8"
              aria-label={t('auth.back_home', 'Volver al inicio')}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              {t('auth.back_home', 'Volver al inicio')}
            </Link>

            <div className="flex flex-col items-center mb-8 sm:mb-10">
              <picture>
                <source srcSet="/mascot.webp" type="image/webp" />
                <img
                  src="/mascot.png"
                  alt="Guardian Praeventio"
                  className="w-24 h-24 sm:w-28 sm:h-28 object-contain drop-shadow-xl mb-2"
                />
              </picture>
              <h1 id="login-heading" className="text-2xl sm:text-3xl font-black uppercase tracking-tighter leading-none mb-2 text-center">
                Guardian Praeventio
              </h1>
              <span className="text-[8px] sm:text-[10px] font-bold accent-text uppercase tracking-widest text-center">
                {t('login.tagline', 'Identidad y Conciencia')}
              </span>
            </div>

            <div className="space-y-4 sm:space-y-6 mb-8 sm:mb-10">
              <div className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl bg-canvas border border-default-token">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 mt-0.5 sm:mt-1 shrink-0" aria-hidden="true" />
                <div>
                  <h2 className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1">{t('login.biometric_title', 'Protección Biométrica')}</h2>
                  <p className="text-[10px] sm:text-[11px] text-muted-token leading-relaxed">
                    {t('login.biometric_desc', 'Tus datos médicos y proyectos sellados bajo biometría (Face ID / Huella).')}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3" role="group" aria-label={t('auth.signin_methods', 'Métodos de inicio de sesión')}>
              {hasEnrolledCredential ? (
                <Button
                  type="button"
                  onClick={handleBiometricLogin}
                  disabled={!isOnline || isLoading}
                  aria-busy={isLoading}
                  aria-describedby={authError ? 'auth-error' : undefined}
                  aria-label={t('auth.biometric_login', 'Usar Biometría (Face ID / Huella)')}
                  className={`w-full py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[10px] sm:text-xs flex items-center justify-center gap-2 sm:gap-3 transition-all shadow-xl ${
                    !isOnline
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none'
                      : 'bg-[#4db6ac] hover:bg-[#3a9e95] text-white hover:scale-[1.02] active:scale-[0.98]'
                  }`}
                >
                  <Zap className="w-5 h-5" aria-hidden="true" />
                  {t('auth.biometric_login', 'Usar Biometría (Face ID / Huella)')}
                </Button>
              ) : null}

              <Button
                type="button"
                onClick={handleLogin}
                disabled={!isOnline || isLoading}
                aria-busy={isLoading}
                aria-describedby={authError ? 'auth-error' : undefined}
                aria-label={hasEnrolledCredential
                  ? t('auth.login_other_way', 'Iniciar de otra forma')
                  : t('auth.login_with_google', 'Iniciar con Google')}
                className={`w-full py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[10px] sm:text-xs flex items-center justify-center gap-2 sm:gap-3 transition-all shadow-xl ${
                  !isOnline
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none'
                    : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:scale-[1.02] active:scale-[0.98]'
                }`}
              >
                {!isOnline ? (
                  <>
                    <WifiOff className="w-4 h-4" aria-hidden="true" />
                    {t('auth.requires_connection', 'Requiere Conexión')}
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" aria-hidden="true" />
                    {hasEnrolledCredential
                      ? t('auth.login_other_way', 'Iniciar de otra forma')
                      : t('auth.login_with_google', 'Iniciar con Google')}
                  </>
                )}
              </Button>
            </div>

            {/* Auth error region — referenced by aria-describedby on the
                buttons so screen readers announce the failure right
                after a failed attempt. role="alert" makes it polite-live
                without needing focus management. */}
            {authError && (
              <p
                id="auth-error"
                role="alert"
                aria-live="assertive"
                className="mt-4 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs text-center font-medium"
              >
                {authError}
              </p>
            )}

            <p className="mt-6 sm:mt-8 text-center text-[8px] sm:text-[10px] text-muted-token font-medium uppercase tracking-widest leading-relaxed px-4">
              {t('auth.consent_notice', 'Al ingresar, aceptas nuestra red de conciencia y protocolos de seguridad.')}
            </p>
          </div>
        </motion.div>
      </div>
    </main>
  );
}

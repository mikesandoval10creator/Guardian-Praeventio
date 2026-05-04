import { motion } from 'framer-motion';
import { logger } from '../utils/logger';
import { useTranslation } from 'react-i18next';
import { signInWithGoogle, auth, db } from '../services/firebase';
import { LogIn, ShieldCheck, Zap, Activity, WifiOff, ArrowLeft } from 'lucide-react';
import { Button } from '../components/shared/Card';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { isBiometricSupported, verifyBiometric, registerBiometric } from '../utils/biometrics';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';

export default function Login() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const [hasBiometric, setHasBiometric] = useState(false);
  const [biometricCredential, setBiometricCredential] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    isBiometricSupported().then(supported => {
      if (supported) {
        setHasBiometric(true);
        const savedCred = localStorage.getItem('praeventio_biometric_id');
        if (savedCred) {
          setBiometricCredential(savedCred);
        }
      }
    });
  }, []);

  const syncBiometricToCloud = async (uid: string, credId: string) => {
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        biometricKeys: arrayUnion(credId)
      });
    } catch (e) {
      logger.warn('Could not sync DB but local key exists', { error: e });
    }
  };

  const handleLogin = async () => {
    if (!isOnline) return;
    setAuthError(null);
    setIsLoading(true);
    try {
      await signInWithGoogle();
      const user = auth.currentUser;

      if (user && hasBiometric && !biometricCredential) {
        // Sign in occurred on a new device or cleared cache, register biometrics
        try {
          // Re-sync: first check if we already have it linked in Firestore
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          if (userSnap.exists()) {
             // Let's create a new passkey specifically for this new device session
             const credId = await registerBiometric(user.uid, user.email || 'user');
             localStorage.setItem('praeventio_biometric_id', credId);
             await syncBiometricToCloud(user.uid, credId);
          }
        } catch(e) {
           logger.debug('Biometric registration skipped', { error: e });
        }
      } else if (user && hasBiometric && biometricCredential) {
         // Already registered, just make sure cloud knows about this device's key
         await syncBiometricToCloud(user.uid, biometricCredential);
      }
    } catch (error) {
      logger.error('Error logging in', { error });
      setAuthError(t('auth.login_failed', 'No se pudo iniciar sesión. Intentá de nuevo.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (!biometricCredential) return;
    setAuthError(null);
    setIsLoading(true);
    try {
      const verified = await verifyBiometric(biometricCredential);
      if (verified) {
        // En una app Capacitor real, aquí inyectaríamos el refresh token o usaríamos signInWithCustomToken.
        // Simularemos invocando a Google Sign In sin forzar selección de cuenta si el navegador lo permite
        await signInWithGoogle();
      } else {
        setAuthError(t('auth.biometric_failed', 'La verificación biométrica falló.'));
      }
    } catch(error) {
      logger.error('Biometric verification failed', { error });
      setAuthError(t('auth.biometric_failed', 'La verificación biométrica falló.'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main
      role="main"
      aria-labelledby="login-heading"
      className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-6 font-sans relative"
    >
      <div className="max-w-md w-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="bg-white dark:bg-zinc-900 rounded-[2rem] sm:rounded-3xl p-6 sm:p-10 shadow-2xl border border-zinc-200 dark:border-zinc-800 relative overflow-hidden"
        >
          {/* Background Accents (decorative — hidden from a11y tree) */}
          <div aria-hidden="true" className="absolute -top-24 -right-24 w-48 h-48 bg-[#4db6ac]/10 rounded-full blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />

          <div className="relative z-10">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors font-medium text-xs uppercase tracking-wider mb-8"
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
              <span className="text-[8px] sm:text-[10px] font-bold text-[#4db6ac] dark:text-[#d4af37] uppercase tracking-widest text-center">
                Identidad y Conciencia
              </span>
            </div>

            <div className="space-y-4 sm:space-y-6 mb-8 sm:mb-10">
              <div className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 mt-0.5 sm:mt-1 shrink-0" aria-hidden="true" />
                <div>
                  <h2 className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1">Protección Biométrica</h2>
                  <p className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Tus datos médicos y proyectos sellados bajo biometría (Face ID / Huella).
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3" role="group" aria-label={t('auth.signin_methods', 'Métodos de inicio de sesión')}>
              {biometricCredential ? (
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
                aria-label={biometricCredential
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
                    {biometricCredential
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

            <p className="mt-6 sm:mt-8 text-center text-[8px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-widest leading-relaxed px-4">
              {t('auth.consent_notice', 'Al ingresar, aceptas nuestra red de conciencia y protocolos de seguridad.')}
            </p>
          </div>
        </motion.div>
      </div>
    </main>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie } from 'lucide-react';

/**
 * Banner de consentimiento de cookies.
 *
 * Cumple con el requisito de listado público del Marketplace y con la
 * orientación general de la Ley 19.628 / GDPR para visitantes europeos.
 * El componente:
 *   - Se monta en `RootLayout.tsx` (top-level), por lo que es visible en
 *     cualquier página después del login.
 *   - Persiste la decisión del usuario en localStorage bajo la clave
 *     `praeventio_cookie_consent` con valores `'accepted'` o `'essential-only'`.
 *   - No carga librerías externas — usa framer-motion (ya dep) para la
 *     animación in/out.
 *
 * El componente NO carga ni descarga scripts de analytics directamente; se
 * limita a registrar la elección. Otras partes de la app que quieran activar
 * tracking analítico deben leer la clave `praeventio_cookie_consent` de
 * localStorage antes de inicializar SDKs no esenciales.
 */
const STORAGE_KEY = 'praeventio_cookie_consent';
type ConsentValue = 'accepted' | 'essential-only';

function readStoredConsent(): ConsentValue | null {
  // localStorage puede no estar disponible (SSR, modo privado estricto, etc.)
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'accepted' || stored === 'essential-only') return stored;
    return null;
  } catch {
    return null;
  }
}

function writeStoredConsent(value: ConsentValue): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, value);
    // Dispatch an event so the rest of the app can react (e.g. enable
    // analytics) without polling.
    window.dispatchEvent(new CustomEvent('praeventio_cookie_consent_changed', { detail: value }));
  } catch {
    // Falla silenciosa — el banner volverá a aparecer en la próxima carga.
  }
}

/**
 * Initial state is computed lazily from localStorage so we read the stored
 * consent synchronously on first render — no `'pending'` placeholder state,
 * no one-frame mount flicker for users who already consented.
 *
 * Safe in this codebase because the rest of the app is CSR React (no SSR),
 * so `window.localStorage` is reachable during render. `readStoredConsent`
 * already guards `typeof window === 'undefined'` and try/catches storage
 * errors (private mode, locked-down kiosk profiles, etc.), so the lazy
 * initializer never throws.
 */
export function CookieConsent() {
  const [consent, setConsent] = useState<ConsentValue | null>(() => readStoredConsent());
  const acceptButtonRef = useRef<HTMLButtonElement | null>(null);

  // Auto-foco en "Aceptar" cuando el banner aparece, para accesibilidad
  // por teclado. No usamos focus trap completo porque el banner es no-modal:
  // el resto de la página sigue siendo navegable.
  useEffect(() => {
    if (consent === null && acceptButtonRef.current) {
      acceptButtonRef.current.focus();
    }
  }, [consent]);

  const handleAccept = () => {
    writeStoredConsent('accepted');
    setConsent('accepted');
  };

  const handleEssentialOnly = () => {
    writeStoredConsent('essential-only');
    setConsent('essential-only');
  };

  // Si ya hay una decisión, el banner permanece oculto.
  if (consent !== null) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="cookie-consent"
        role="dialog"
        aria-labelledby="cookie-consent-title"
        aria-describedby="cookie-consent-description"
        aria-live="polite"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="fixed bottom-0 left-0 right-0 z-[60] px-4 pb-4 sm:px-6 sm:pb-6 pointer-events-none"
      >
        <div className="max-w-3xl mx-auto bg-zinc-950/95 backdrop-blur-xl border border-emerald-500/20 rounded-2xl shadow-2xl shadow-emerald-500/10 p-5 sm:p-6 pointer-events-auto">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Cookie className="w-4 h-4 text-emerald-400" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h2
                id="cookie-consent-title"
                className="text-white font-black text-sm sm:text-base mb-1"
              >
                Cookies y privacidad
              </h2>
              <p
                id="cookie-consent-description"
                className="text-zinc-400 text-xs sm:text-sm leading-relaxed"
              >
                Usamos cookies estrictamente necesarias para autenticación y sesión. Cookies analíticas opcionales. Lee más en nuestra{' '}
                <Link
                  to="/privacy"
                  className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 font-bold"
                >
                  Política de Privacidad
                </Link>
                .
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end">
            <button
              type="button"
              onClick={handleEssentialOnly}
              className="px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl border border-white/10 text-zinc-300 hover:text-white hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            >
              Solo esenciales
            </button>
            <button
              ref={acceptButtonRef}
              type="button"
              onClick={handleAccept}
              className="px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl bg-emerald-500 text-zinc-950 hover:bg-emerald-400 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            >
              Aceptar
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export default CookieConsent;

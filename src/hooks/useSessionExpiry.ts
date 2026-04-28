import { useEffect } from 'react';
import { auth, logOut, onAuthStateChanged } from '../services/firebase';

const SESSION_MAX_MS = 8 * 60 * 60 * 1000; // 8-hour shift maximum (one work shift)
const STALE_AGE_MS = 24 * 60 * 60 * 1000; // a stored first-login older than this is considered stale and reset
const FIRST_LOGIN_KEY_PREFIX = 'praeventio_first_login_';

/**
 * Builds the localStorage key for a given uid.
 * Format: `praeventio_first_login_<uid>`
 */
export function firstLoginKey(uid: string): string {
  return `${FIRST_LOGIN_KEY_PREFIX}${uid}`;
}

/**
 * Reads (and lazily initializes) the first-login timestamp for a uid.
 * - If no value is stored, writes `now` and returns it.
 * - If the stored value is older than 24h, treats it as stale, overwrites with `now`,
 *   and returns the new value (so a worker who returns the next day starts a new shift).
 */
function readOrInitFirstLogin(uid: string, now: number): number {
  const key = firstLoginKey(uid);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && now - parsed <= STALE_AGE_MS) {
        return parsed;
      }
    }
  } catch {
    // localStorage unavailable (private mode, SSR, etc.) — fall through to in-memory now
  }
  try {
    localStorage.setItem(key, String(now));
  } catch {}
  return now;
}

/**
 * Clears the stored first-login timestamp for a uid.
 * Call this on explicit logout so the next login starts a fresh 8h shift.
 */
export function clearFirstLogin(uid: string): void {
  try {
    localStorage.removeItem(firstLoginKey(uid));
  } catch {}
}

function notifyShiftEnded() {
  const msg = 'Tu turno terminó (8h). Inicia sesión de nuevo para continuar.';
  try {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(msg);
      return;
    }
  } catch {}
  console.warn('[SessionExpiry]', msg);
}

export function useSessionExpiry() {
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const now = Date.now();
      const firstLoginTs = readOrInitFirstLogin(user.uid, now);
      const expiry = firstLoginTs + SESSION_MAX_MS;

      // Clock-skew safety: if the computed expiry is already past on first check,
      // force logout immediately rather than wait for the interval to tick.
      if (now >= expiry) {
        console.warn('[SessionExpiry] Session exceeded 8h limit — forcing re-auth');
        notifyShiftEnded();
        try {
          await logOut();
        } catch (err) {
          console.error('[SessionExpiry] logOut failed', err);
        }
      }
    };

    // Re-check immediately whenever auth state flips to a non-null user, then
    // every 15 minutes while the user remains signed in.
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        // Initialize first-login lazily and run a check.
        readOrInitFirstLogin(user.uid, Date.now());
        void check();
        if (interval == null) {
          interval = setInterval(check, 15 * 60 * 1000);
        }
      } else if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    });

    // Also do an immediate synchronous check in case the user is already signed in
    // by the time this hook mounts (auth state listener races).
    void check();

    return () => {
      unsub();
      if (interval != null) clearInterval(interval);
    };
  }, []);
}

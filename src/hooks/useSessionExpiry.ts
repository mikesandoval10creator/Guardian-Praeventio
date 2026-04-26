import { useEffect } from 'react';
import { auth, logOut } from '../services/firebase';

const SESSION_MAX_MS = 8 * 60 * 60 * 1000; // 8-hour shift maximum

export function useSessionExpiry() {
  useEffect(() => {
    const check = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const lastSignIn = user.metadata.lastSignInTime;
      if (!lastSignIn) return;

      const elapsed = Date.now() - new Date(lastSignIn).getTime();
      if (elapsed > SESSION_MAX_MS) {
        console.warn('[SessionExpiry] Session exceeded 8h limit — forcing re-auth');
        await logOut();
      }
    };

    check();

    // Re-check every 15 minutes
    const interval = setInterval(check, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
}

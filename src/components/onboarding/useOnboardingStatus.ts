// Sprint 24 Bucket KK.4 — onboarded-flag hook.
//
// Reads `users/{uid}.onboarded` directly from Firestore so the App-level
// redirect guard doesn't need to bloat `FirebaseContext` (which is shared
// across the whole app). Returns:
//   • null   → still loading (don't redirect yet — avoids flash)
//   • true   → user has completed the wizard
//   • false  → user must be sent to `/onboarding`
//
// Re-runs whenever `uid` changes (sign-in / sign-out). Errors fall back
// to `true` so a transient Firestore hiccup never traps an existing user
// on the wizard.

import { useEffect, useState } from 'react';
import { db, doc, getDoc } from '../../services/firebase';

export function useOnboardingStatus(uid: string | undefined | null): boolean | null {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setOnboarded(null);
      return;
    }

    setOnboarded(null);
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (cancelled) return;
        if (!snap.exists()) {
          // Brand-new user document → needs onboarding.
          setOnboarded(false);
          return;
        }
        const data = snap.data() as { onboarded?: unknown };
        setOnboarded(data?.onboarded === true);
      } catch {
        // Fail-open: don't trap users on the wizard if Firestore is flaky.
        if (!cancelled) setOnboarded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  return onboarded;
}

// Sprint 24 Bucket KK.2 — Onboarding page.
//
// Thin wrapper around `<OnboardingWizard>` that wires the
// "wizard finished" callback to a navigation back to /dashboard.
// The wizard handles all state, validation and the network call to
// `/api/onboarding/complete` itself.

import React from 'react';
import { OnboardingWizard } from '../components/onboarding/OnboardingWizard';

export function Onboarding() {
  return (
    <OnboardingWizard
      onComplete={() => {
        // B.6 — HARD browser navigation, not react-router's navigate().
        // A soft client-side navigate() raced the freshly-written
        // `users/{uid}.onboarded` flag: the App.tsx redirect guard still
        // held the stale value and bounced the user straight back into
        // the wizard. location.assign() forces a full reload so the
        // guard re-reads the fresh flag from Firestore.
        location.assign('/dashboard');
      }}
    />
  );
}

export default Onboarding;

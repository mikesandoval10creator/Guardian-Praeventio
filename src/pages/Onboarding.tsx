// Sprint 24 Bucket KK.2 — Onboarding page.
//
// Thin wrapper around `<OnboardingWizard>` that wires the
// "wizard finished" callback to a navigation back to /dashboard.
// The wizard handles all state, validation and the network call to
// `/api/onboarding/complete` itself.

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingWizard } from '../components/onboarding/OnboardingWizard';

export function Onboarding() {
  const navigate = useNavigate();
  return (
    <OnboardingWizard
      onComplete={() => {
        // Hard-redirect to the dashboard. The auto-redirect guard in
        // App.tsx will read `users/{uid}.onboarded` and let the
        // request through this time.
        navigate('/dashboard', { replace: true });
      }}
    />
  );
}

export default Onboarding;

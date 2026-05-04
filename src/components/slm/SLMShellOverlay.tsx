// Sprint 20 — Bucket Nu — Wire-up
//
// `<SLMShellOverlay>` renders the global `<OfflineSLMBanner>` whenever
// the device drops offline. Mounted once at the shell level so it shows
// regardless of which route is active — landing, dashboard, driving
// overlay, emergency overlay all share this component.
//
// Behaviour:
//   • Reads `isOnline` and `pendingCount` from `SLMContext`.
//   • When online, renders nothing (no DOM cost when the network is up).
//   • When offline, mounts `<OfflineSLMBanner>` in `forceVisible` mode at
//     the top of the viewport, with a fixed position so route content
//     scrolling underneath does not displace it.
//   • Reads the runtime `AppMode` from `AppModeContext` and resolves
//     it into the banner's discrete `OfflineBannerMode`. Runtime
//     "normal" splits into `normal-light` / `normal-dark` based on
//     whatever `<html>` class the AppModeProvider has applied (`dark`
//     ↔ dark, otherwise light).
//
// Why "fixed top": the banner is informational, not blocking. Sticking
// to the top is the conventional treatment (same as `EmergencyAlertBanner`)
// and keeps it out of the way of the route content underneath. The
// underlying `<OfflineSLMBanner>` already animates the entrance with
// framer-motion, so we don't add additional motion here.
//
// SSR-safe: uses `typeof document` guards before reading the html class,
// so the component renders identically server-side (where it's just
// "online" and produces nothing).

import React from 'react';

import { useAppMode } from '../../contexts/AppModeContext';
import {
  OfflineSLMBanner,
  type OfflineBannerMode,
} from './OfflineSLMBanner';
import { useSLM } from './SLMProvider';

/**
 * Resolve the runtime `AppMode` (`'normal' | 'driving' | 'emergency'`)
 * into the banner's 4-way visual mode. Runtime "normal" is split into
 * light/dark by reading the `dark` class the AppModeProvider applies to
 * `<html>` — that's the same signal the rest of the design system uses,
 * so the banner stays in lock-step with the global theme without a
 * second source of truth.
 */
function resolveBannerMode(
  mode: 'normal' | 'driving' | 'emergency',
): OfflineBannerMode {
  if (mode === 'driving') return 'driving';
  if (mode === 'emergency') return 'emergency';

  if (typeof document === 'undefined') return 'normal-light';
  return document.documentElement.classList.contains('dark')
    ? 'normal-dark'
    : 'normal-light';
}

export function SLMShellOverlay(): React.ReactElement | null {
  const { isOnline, pendingCount } = useSLM();
  const { mode } = useAppMode();

  if (isOnline) return null;

  const bannerMode = resolveBannerMode(mode);

  return (
    <div
      data-testid="slm-shell-overlay"
      className="fixed top-0 left-0 right-0 z-50 pointer-events-auto"
    >
      <OfflineSLMBanner
        pendingCount={pendingCount}
        mode={bannerMode}
        forceVisible
      />
    </div>
  );
}

export default SLMShellOverlay;

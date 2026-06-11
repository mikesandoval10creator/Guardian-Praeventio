// @vitest-environment jsdom
//
// Praeventio Guard — Fase 5 D2 slice 1 (2026-06-11).
//
// Pins the resolution of the /safe-driving route COLLISION:
// `App.tsx` mounts `SafeDrivingMode` at `safe-driving` (driver mode with
// the SOS button — life-safety, stays put) while `OperationsRoutes.tsx`
// used to mount `SafeDriving` (incident reporting + pre-drive checklist)
// at the SAME path, making one of the two pages unreachable in
// production (dead life-safety capability).
//
// Contract pinned here:
//   • `safe-driving`       → SafeDrivingMode (App.tsx inline route wins,
//                            OperationsRoutes must NOT redeclare the path)
//   • `driving-incidents`  → SafeDriving (re-pathed, reachable again)
//
// The test mirrors App.tsx sibling ordering: the route groups are spread
// BEFORE the inline `safe-driving` route, so any duplicate path inside
// OperationsRoutes would shadow the inline SafeDrivingMode mount.

import { Suspense } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { OperationsRoutes } from './OperationsRoutes';

// Only the matched route's lazy chunk is loaded by Suspense, so mocking
// the single page under test keeps this hermetic (no Google Maps, no
// Firestore, no contexts).
vi.mock('../pages/SafeDriving', () => ({
  SafeDriving: () => <div data-testid="safe-driving-page" />,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Suspense fallback={<div data-testid="suspense-fallback" />}>
        <Routes>
          <Route path="/">
            {/* Mirrors App.tsx: route groups first… */}
            {OperationsRoutes}
            {/* …then the inline safe-driving route (SafeDrivingMode). */}
            <Route
              path="safe-driving"
              element={<div data-testid="safe-driving-mode-page" />}
            />
            <Route path="*" element={<div data-testid="route-fallback" />} />
          </Route>
        </Routes>
      </Suspense>
    </MemoryRouter>,
  );
}

describe('OperationsRoutes — driving route collision (D2 slice 1)', () => {
  it('safe-driving resolves to SafeDrivingMode (no shadow from OperationsRoutes)', async () => {
    renderAt('/safe-driving');
    expect(await screen.findByTestId('safe-driving-mode-page')).toBeTruthy();
    expect(screen.queryByTestId('safe-driving-page')).toBeNull();
  });

  it('driving-incidents resolves to SafeDriving (incident reporting page reachable)', async () => {
    renderAt('/driving-incidents');
    expect(await screen.findByTestId('safe-driving-page')).toBeTruthy();
    expect(screen.queryByTestId('route-fallback')).toBeNull();
  });

  it('OperationsRoutes does not redeclare the safe-driving path', () => {
    const paths = OperationsRoutes.map(
      (r) => (r.props as { path?: string }).path,
    );
    expect(paths).not.toContain('safe-driving');
    expect(paths).toContain('driving-incidents');
  });
});

// @vitest-environment jsdom
//
// Proves the pulmonary-ergonomics persistence is a POST-render EFFECT, not a
// render-phase side effect (React correctness). The old code called
// writeNodesDebounced + logger.info from inside a render-phase IIFE; the fix
// moves them into a useEffect.
//
// HOW THE RENDER-PURITY TEST WORKS (robust against React 19 / RTL 16):
// We render a <Marker/> sibling BEFORE <BioAnalysis/>. Marker's useEffect
// flips a module flag `committed = true`. Our writeNodesDebounced mock records
// the flag's value at call time. Effects run child-first in render order, so
// Marker's effect (sibling rendered first) runs BEFORE BioAnalysis's own
// effect. Therefore:
//   • a render-phase write (OLD/bug) is observed while committed === false,
//   • an effect-phase write (NEW/fix) is observed while committed === true.
// This was verified empirically; a `vi.spyOn(React,'useEffect')` approach does
// NOT work here because BioAnalysis imports `useEffect` as a named binding.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

// Module flag flipped by <Marker/>'s effect (i.e. after the render phase has
// committed). The persistence mock records this flag at each call. These live
// in a `vi.hoisted` holder because `vi.mock` is hoisted above normal `const`s.
const H = vi.hoisted(() => {
  const state = {
    committed: false,
    writeCalls: [] as { committed: boolean; nodes: unknown; ctx: unknown }[],
  };
  const writeNodesDebounced = vi.fn((nodes: unknown, ctx: unknown) => {
    state.writeCalls.push({ committed: state.committed, nodes, ctx });
  });
  return { state, writeNodesDebounced };
});
const writeNodesDebounced = H.writeNodesDebounced;

vi.mock('../services/zettelkasten/persistence/writeNode', () => ({
  writeNodesDebounced: H.writeNodesDebounced,
}));

// generatePulmonaryNode stays the REAL pure engine (not mocked): for the
// default PEF=550 L/min, altitude=0, the engine returns a node (Δp = 800 ·
// 550/60000 = 7.33 Pa > 1.0 Pa critical), so the effect persists once.

// Boundary mocks so the page mounts under jsdom without network / native deps.
vi.mock('@mediapipe/tasks-vision', () => ({
  FaceLandmarker: {
    createFromOptions: vi.fn(),
    FACE_LANDMARKS_TESSELATION: [],
    FACE_LANDMARKS_RIGHT_EYE: [],
    FACE_LANDMARKS_LEFT_EYE: [],
    FACE_LANDMARKS_FACE_OVAL: [],
  },
  PoseLandmarker: { createFromOptions: vi.fn(), POSE_CONNECTIONS: [] },
  ObjectDetector: { createFromOptions: vi.fn() },
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  DrawingUtils: class {},
}));
vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u1' } }),
}));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-1' } }),
}));
vi.mock('../hooks/useRiskEngine', () => ({ useRiskEngine: () => ({ addNode: vi.fn() }) }));
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('../components/shared/PremiumFeatureGuard', () => ({
  PremiumFeatureGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

import { render, cleanup } from '@testing-library/react';
import { BioAnalysis } from './BioAnalysis';

function Marker() {
  React.useEffect(() => {
    H.state.committed = true;
  }, []);
  return null;
}

beforeEach(() => {
  H.state.committed = false;
  writeNodesDebounced.mockClear();
  H.state.writeCalls.length = 0;
  cleanup();
});

describe('BioAnalysis — pulmonary persistence is effect-driven, not render-phase', () => {
  it('never writes during the render phase (every write is post-commit)', () => {
    // Marker is rendered BEFORE BioAnalysis so its effect commits the flag
    // ahead of BioAnalysis's own effect. A render-phase write would be
    // recorded with committed === false and fail this assertion — which is
    // exactly what the OLD render-phase IIFE did.
    render(
      <>
        <Marker />
        <BioAnalysis />
      </>,
    );
    expect(writeNodesDebounced).toHaveBeenCalled();
    for (const call of H.state.writeCalls) {
      expect(call.committed).toBe(true);
    }
  });

  it('writes via effect exactly once with the active project id', () => {
    render(
      <>
        <Marker />
        <BioAnalysis />
      </>,
    );
    expect(writeNodesDebounced).toHaveBeenCalledTimes(1);
    expect(H.state.writeCalls[0].ctx).toMatchObject({ projectId: 'proj-1' });
  });
});

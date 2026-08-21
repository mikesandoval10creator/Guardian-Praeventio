// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// ── Mocks (hoisted-safe pattern) ────────────────────────────────────

const __mocks = {
  processAudioWithAI: vi.fn(),
  generateActionPlan: vi.fn(),
  addNode: vi.fn(),
};

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/offlineKnowledge', () => ({
  getOfflineResponse: vi.fn(),
  savePendingOfflineQuery: vi.fn(),
  getPendingOfflineQueries: vi.fn().mockResolvedValue([]),
  clearPendingOfflineQueries: vi.fn(),
}));

vi.mock('../../utils/pwa-offline', () => ({
  isOnline: () => true,
}));

vi.mock('../../utils/randomId', () => ({
  randomId: () => 'mock-id-123',
}));

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({
    nodes: [],
    loading: false,
    error: null,
    addNode: (...args: unknown[]) => __mocks.addNode(...args),
    addConnection: vi.fn(),
  }),
}));

vi.mock('../../hooks/useAmbientNoise', () => ({
  useAmbientNoise: () => ({
    noiseLevel: 0,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-test' } }),
}));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'user-test' } }),
}));

vi.mock('../../services/geminiService', () => ({
  processAudioWithAI: (...args: unknown[]) => __mocks.processAudioWithAI(...args),
  generateActionPlan: (...args: unknown[]) => __mocks.generateActionPlan(...args),
}));

vi.mock('framer-motion', () => ({
  motion: { div: 'div', button: 'button' },
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { GuardianVoiceAssistant } from './GuardianVoiceAssistant.js';

describe('GuardianVoiceAssistant — finally-fix verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('smoke: component mounts without crashing', () => {
    const { container } = render(<GuardianVoiceAssistant />);
    expect(container).toBeTruthy();
  });

  it('source file: `processAudio` no longer has a synchronous `finally { setIsProcessing(false) }` pattern', async () => {
    // Read the source of the component and verify the regression-fixing
    // shape: the `finally { setIsProcessing(false) }` block must enclose
    // at least one `await` between the function entry and the closure
    // of the finally. This guards against someone re-introducing the
    // original bug (setIsProcessing(false) running on the synchronous
    // tick after a microtask).
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      // The test originally read from a separate worktree at M:/tmp/... which
      // no longer exists. Read from the canonical repo path resolved relative
      // to the file's own location so this guard works in CI (where the
      // repo lives at /home/runner/work/... on Linux) and on local Windows
      // (where it lives at M:/Guardian Praeventio/repo).
      // vitest sets cwd to the repo root during tests, so './' resolves
      // to the repo regardless of host OS.
      './src/components/ai/GuardianVoiceAssistant.tsx',
      'utf-8',
    );
    expect(src.length).toBeGreaterThan(0);
    const start = src.indexOf('processAudio = async (blob: Blob)');
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let end = start;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const body = src.slice(start, end);
    const hasPromiseWrap = body.includes('new Promise') && body.includes('readAsDataURL');
    expect(hasPromiseWrap).toBe(true);
    const setTrueIdx = body.indexOf('setIsProcessing(true)');
    const finallyIdx = body.indexOf('finally');
    expect(setTrueIdx).toBeGreaterThan(-1);
    expect(finallyIdx).toBeGreaterThan(-1);
    const between = body.slice(setTrueIdx, finallyIdx);
    expect(between).toMatch(/\bawait\b/);
  });
});

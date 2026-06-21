// @vitest-environment jsdom
//
// Praeventio Guard — wiring/integration test for the F.2 compliance traffic
// light AS IT IS MOUNTED on the Dashboard.
//
// The sibling `ComplianceTrafficLight.test.tsx` is a pure presentation test
// (hand-built props handed straight to the component). This file proves the
// REAL data path the Dashboard actually uses:
//
//   useComplianceTrafficLight(projectId)   ← src/hooks/useComplianceTrafficLight.ts
//     → useEndpoint(/api/compliance/:projectId/traffic-light)  (real)
//       → authedFetch (real)
//         → fetch  ← the ONLY thing mocked (network boundary)
//   …then the server-shaped `{ result: ComplianceTrafficLightView }` payload
//   is fed into the real <ComplianceTrafficLight> exactly as Dashboard.tsx
//   does (compact variant, null-guarded).
//
// This catches a class of bug the presentation test cannot: a payload-shape
// mismatch between the server route (`{ result: view }`) and the hook
// (`data?.result`), or a coverage-aware view that the badge renders wrong.
// Mocking only `fetch` keeps the hook → fetch → render seam REAL.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ComplianceTrafficLight } from './ComplianceTrafficLight.js';
import { useComplianceTrafficLight } from '../../hooks/useComplianceTrafficLight.js';
import type { ComplianceTrafficLightView } from '../../services/compliance/trafficLightCoverage.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return _k;
    },
  }),
}));

// Mock ONLY the auth-header resolver so authedFetch doesn't reach Firebase.
// The fetch itself stays real (we stub the global) — that is the network seam.
vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeaders: async () => ({ Authorization: 'E2E test-secret:test-uid' }),
}));

// Minimal Dashboard-shaped consumer: identical wiring to src/pages/Dashboard.tsx
// (hook result → null-guarded compact badge). Kept tiny so the test exercises
// the real hook + real component without dragging the full Dashboard tree.
function DashboardComplianceSlot({ projectId }: { projectId: string | null }) {
  const { result } = useComplianceTrafficLight(projectId);
  return result ? (
    <div data-testid="compliance-traffic-light">
      <ComplianceTrafficLight result={result} variant="compact" />
    </div>
  ) : (
    <div data-testid="no-compliance-light" />
  );
}

/** Server-route-shaped view (only `legal` sourced; rest honest 'unknown'). */
function makeServerView(
  overrides: Partial<ComplianceTrafficLightView> = {},
): ComplianceTrafficLightView {
  return {
    overall: 'green',
    score: 100,
    computedAt: '2026-06-20T10:00:00.000Z',
    sourcedCount: 1,
    totalCount: 8,
    byCategory: [
      { category: 'legal', light: 'green', summary: 'Obligaciones legales al día', criticalItemIds: [], warningCount: 0 },
      { category: 'documentation', light: 'unknown', summary: '', criticalItemIds: [], warningCount: 0 },
      { category: 'training', light: 'unknown', summary: '', criticalItemIds: [], warningCount: 0 },
      { category: 'epp', light: 'unknown', summary: '', criticalItemIds: [], warningCount: 0 },
      { category: 'emergencies', light: 'unknown', summary: '', criticalItemIds: [], warningCount: 0 },
      { category: 'occupational_health', light: 'unknown', summary: '', criticalItemIds: [], warningCount: 0 },
      { category: 'maintenance', light: 'unknown', summary: '', criticalItemIds: [], warningCount: 0 },
      { category: 'audits', light: 'unknown', summary: '', criticalItemIds: [], warningCount: 0 },
    ],
    ...overrides,
  };
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ComplianceTrafficLight wiring (Dashboard data path)', () => {
  it('no proyecto → la badge no se monta (path null, sin fetch)', () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<DashboardComplianceSlot projectId={null} />);

    expect(screen.getByTestId('no-compliance-light')).toBeInTheDocument();
    // Hook gate: path === null → useEndpoint never calls fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cobertura parcial → la badge muestra "1/8 cat." (honesto, no /100)', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe('/api/compliance/proj-123/traffic-light');
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: makeServerView() }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<DashboardComplianceSlot projectId="proj-123" />);

    // Real hook resolves → real component renders.
    const badge = await screen.findByTestId('compliance-traffic-light-compact');
    // Coverage-aware: 7 categories are 'unknown' ⇒ never show a fabricated
    // "/100"; show the sourced/total coverage instead.
    expect(badge).toHaveTextContent('1/8 cat.');
    expect(badge).not.toHaveTextContent('/100');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('todas las categorías sourced → la badge muestra score "/100"', async () => {
    const fullView = makeServerView({
      overall: 'yellow',
      score: 87,
      sourcedCount: 8,
      byCategory: makeServerView().byCategory.map((c) => ({
        ...c,
        light: 'green' as const,
        summary: 'OK',
      })),
    });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: fullView }),
    } as unknown as Response));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<DashboardComplianceSlot projectId="proj-xyz" />);

    const badge = await screen.findByTestId('compliance-traffic-light-compact');
    expect(badge).toHaveTextContent('87/100');
  });

  it('403 del server (no-miembro) → la badge NO se monta (error, sin datos falsos)', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden' }),
    } as unknown as Response));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<DashboardComplianceSlot projectId="proj-denied" />);

    // The hook surfaces an error and result stays null → Dashboard renders
    // nothing rather than a fabricated all-clear.
    await waitFor(() => {
      expect(screen.getByTestId('no-compliance-light')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('compliance-traffic-light-compact')).not.toBeInTheDocument();
  });
});

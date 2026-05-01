// @vitest-environment node
//
// Praeventio Guard — RiskNetwork page: ?node= deep-link tests.
//
// Background: in Round 12, agent D3 wired Projects.tsx so a climate-risk row
// click navigates to `/risk-network?node=<id>`. The destination page used to
// ignore that param, so users landed on a generic graph view. This file
// drives — TDD-style — the work to:
//   1. Read `node` from the URL on mount via `useSearchParams`.
//   2. Validate it against the loaded node set from `useRiskEngine`.
//   3. Persist the (validated) selection in component state, surfaced on the
//      page root as `data-selected-node-id` so downstream graph wiring (and
//      these tests) can observe it without prop-drilling.
//
// Why no @testing-library/react and no MemoryRouter render?
//   • @testing-library/react is not installed in this repo (see the same
//     note in src/hooks/useInvoicePolling.test.ts). React 19 ships `act`,
//     but rendering a page that imports `useSearchParams` from
//     react-router-dom requires a router context AND a DOM (jsdom).
//   • jsdom is not installed either — although vitest.config.ts maps
//     `*.test.tsx` to the jsdom environment, the package was never added
//     to devDependencies (this is the first .tsx test in the repo). The
//     scope rules for this round forbid adding new dependencies.
//
// Resolution: extract the URL-resolution logic into a pure helper
// `resolveSelectedNodeIdFromSearch` that is exhaustively tested here, and
// have the React component delegate to it from a `useEffect`. The
// component itself remains a thin wrapper over a pure function — the
// classic functional-core / imperative-shell split — so the deep-link
// contract is fully covered without a render.
//
// Tests 1/2/3 from the round-13 spec are realised as `via.helper` cases
// that mirror the URL-mount scenarios: present id, absent param, unknown
// id. Additional cases harden edge inputs (whitespace, empty node set
// during loading) that would otherwise be silent regressions.

import { describe, expect, it, vi } from 'vitest';

// RiskNetwork.tsx transitively imports `react-force-graph-2d`/`-3d`, which
// touch `window` at module-load time. Under the `node` test environment
// (forced above so we don't depend on jsdom, which is not installed in
// this repo) those imports throw before our pure helper can be reached.
// Stub them out — we never invoke them from these tests.
vi.mock('../components/shared/KnowledgeGraph', () => ({
  KnowledgeGraph: () => null,
}));
vi.mock('../components/risk-network/RiskNetworkExplorer', () => ({
  RiskNetworkExplorer: () => null,
}));
vi.mock('../components/risk-network/RiskNetworkHealth', () => ({
  RiskNetworkHealth: () => null,
}));
vi.mock('../components/risk-network/RiskNetworkManager', () => ({
  RiskNetworkManager: () => null,
}));
vi.mock('../components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: unknown }) => children,
}));
vi.mock('../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ nodes: [], loading: false }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));
vi.mock('../services/geminiService', () => ({
  analyzeRiskNetwork: vi.fn(),
  predictAccidents: vi.fn(),
}));
vi.mock('idb-keyval', () => ({
  get: vi.fn(),
  set: vi.fn(),
}));

import { resolveSelectedNodeIdFromSearch } from './RiskNetwork';

describe('resolveSelectedNodeIdFromSearch — deep-link contract', () => {
  it('1. /risk-network?node=ABC123 with ABC123 loaded → returns "ABC123"', () => {
    // Mirror of Round 13 Test 1: page mounted with a known node id in the
    // URL must surface that id as the selection.
    const params = new URLSearchParams('?node=ABC123');
    const known = new Set(['ABC123', 'OTHER']);
    expect(resolveSelectedNodeIdFromSearch(params, known)).toBe('ABC123');
  });

  it('2. /risk-network with no ?node= → returns null (default behaviour)', () => {
    // Mirror of Round 13 Test 2: no param, no selection. The component
    // treats null as the "show generic graph" path.
    const params = new URLSearchParams('');
    const known = new Set(['ABC123']);
    expect(resolveSelectedNodeIdFromSearch(params, known)).toBeNull();
  });

  it('3. /risk-network?node=GHOST when GHOST is not in the loaded set → returns null', () => {
    // Mirror of Round 13 Test 3: deep link to a node we haven't loaded
    // (deleted? wrong project?) must NOT crash and must NOT pretend the
    // node exists. Falling back to null lets the page render its default
    // view exactly as if the param were missing.
    const params = new URLSearchParams('?node=GHOST');
    const known = new Set(['ABC123', 'OTHER']);
    expect(resolveSelectedNodeIdFromSearch(params, known)).toBeNull();
  });

  it('returns null when the node set is empty (data still loading)', () => {
    // Edge: useRiskEngine emits `{ nodes: [], loading: true }` on the very
    // first render. We don't want to "select" against an empty set — the
    // useEffect will re-run when nodes arrive.
    const params = new URLSearchParams('?node=ABC123');
    expect(resolveSelectedNodeIdFromSearch(params, new Set())).toBeNull();
  });

  it('rejects whitespace-only ?node= values defensively', () => {
    // A bookmark with `?node=%20%20` shouldn't match a node whose id is
    // literally two spaces; in practice node ids are crypto.randomUUID()s
    // but we trim defensively so a stray space in a hand-edited URL doesn't
    // surface as a phantom selection.
    const params = new URLSearchParams('?node=%20%20');
    expect(resolveSelectedNodeIdFromSearch(params, new Set(['ABC']))).toBeNull();
  });

  it('returns null when ?node= is present but empty (e.g. /risk-network?node=)', () => {
    const params = new URLSearchParams('?node=');
    expect(resolveSelectedNodeIdFromSearch(params, new Set(['ABC']))).toBeNull();
  });

  it('matches exact id (case-sensitive) — does not coerce', () => {
    // crypto.randomUUID() is hex-lowercase; treating the id as case-
    // insensitive could collide with future migrations to base32-style
    // ids. Stay strict: only an exact match counts.
    const params = new URLSearchParams('?node=abc123');
    const known = new Set(['ABC123']);
    expect(resolveSelectedNodeIdFromSearch(params, known)).toBeNull();
  });

  it('ignores additional query params and returns the matched id', () => {
    // The Projects.tsx caller appends only `?node=`, but other callers
    // (or analytics tooling) may stuff extra params on the URL. Be liberal
    // about what we accept.
    const params = new URLSearchParams('?node=ABC123&utm_source=projects');
    expect(resolveSelectedNodeIdFromSearch(params, new Set(['ABC123']))).toBe('ABC123');
  });
});

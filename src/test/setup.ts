// Vitest setup file — loaded for every test, regardless of environment.
//
// Round 15 (I3) — `@testing-library/jest-dom` is now installed. Its
// custom matchers (`toBeInTheDocument`, `toHaveTextContent`, etc.) make
// sense only in a jsdom environment; in a node test they'd attach to
// `expect` harmlessly but never match anything. Since this setup file
// runs for both environments, we conditionally import the matchers when
// `globalThis.document` is defined (i.e. jsdom). This avoids loading
// DOM-shaped helpers into the heavier backend test surface.
//
// Component test files declare `// @vitest-environment jsdom` at the
// top — that's where these matchers will be active.
//
// Sprint 39 P0.3 follow-up: when `globals: false` (our config), Vitest
// does NOT auto-wire `afterEach(cleanup)`. Previously this caused
// cross-test DOM contamination — tests for the same component would
// see elements from previous renders, leading to spurious failures
// like "found 1, expected 0". We register the cleanup hook here so
// every jsdom test gets a fresh DOM. Reference:
// https://testing-library.com/docs/react-testing-library/api/#cleanup
if (typeof globalThis.document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { afterEach } = await import('vitest');
  // Sprint Plan 2026-05-23 Fase B.2 — `@testing-library/dom` peer del
  // paquete `@testing-library/react` está declarado en package.json + lock,
  // pero faltó en algunos `npm install` parciales (offline / sin
  // --legacy-peer-deps). Cuando falta, todo el suite de hook tests muere
  // con "Cannot find module '@testing-library/dom'". Para no romper tests
  // que NO usan cleanup (ej. hand-rolled renderHook con react-dom/client
  // directo), envolvemos el import en try/catch. Si la lib carga, cleanup
  // queda registrado. Si no, los tests siguen corriendo sin cleanup
  // (cada test es responsable de su propio unmount).
  try {
    const { cleanup } = await import('@testing-library/react');
    afterEach(() => {
      cleanup();
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[test/setup] @testing-library/react no disponible (peer @testing-library/dom faltante). ' +
      'cleanup() global desactivado — los tests deben unmount manualmente.',
      err,
    );
  }

  // jsdom (>= v22) ships without `window.matchMedia`. GSAP's gsap-core
  // (v4) calls `_win.matchMedia(query)` inside `MatchMedia.add()` when
  // any component constructs a `Card` (gsap.scope wraps it). Without
  // this stub every Card-mounting test crashes with
  // `TypeError: _win.matchMedia is not a function`. We provide the
  // minimum surface MediaQueryList shape that GSAP queries.
  const win = globalThis as unknown as Window & typeof globalThis;
  if (typeof win.matchMedia !== 'function') {
    const matchMediaStub = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    // Define on both `window` and `globalThis` because GSAP can resolve
    // `_win` from either depending on bundler scope.
    Object.defineProperty(win, 'matchMedia', {
      writable: true,
      configurable: true,
      value: matchMediaStub,
    });
  }
}

export {};

// ── §2.31 open-handle detector (opt-in) ──────────────────────────────────
// The CI "Tests" job intermittently (~30-40%) runs to its 30-min timeout and
// is killed because the vitest worker never exits — a test leaves an open
// handle (timer / socket / gRPC channel) post-run. This detector is INERT in
// normal runs; set `DETECT_HANDLES=1` to snapshot Node's active resources at
// file load vs `afterAll`, attributing any new lingering handle to the test
// file that leaked it. Usage:
//   DETECT_HANDLES=1 npx vitest run src/__tests__/server 2>&1 | grep LEAK
if (process.env.DETECT_HANDLES === '1') {
  const { afterAll } = await import('vitest');
  // Resource types that legitimately persist (the worker's own plumbing) and
  // must not be flagged as leaks.
  const BENIGN = new Set([
    'TTYWrap',
    'PipeWrap',
    'ProcessWrap',
    'TickObject',
    'Immediate',
    'FSReqCallback',
    'MessagePort',
  ]);
  // vitest's own worker plumbing keeps a single `Timeout` alive even for a
  // trivial empty test — verified empirically. Treat exactly +1 Timeout as
  // benign; +2 or more is a real app-leaked timer worth attributing.
  const baseline = countResources();
  afterAll(() => {
    const after = countResources();
    const leaks: string[] = [];
    for (const [kind, n] of Object.entries(after)) {
      if (BENIGN.has(kind)) continue;
      let delta = n - (baseline[kind] ?? 0);
      if (kind === 'Timeout') delta -= 1; // discount vitest's own heartbeat
      if (delta > 0) leaks.push(`${kind}+${delta}`);
    }
    if (leaks.length > 0) {
      // Attribute by running file-by-file (DETECT_HANDLES=1 npx vitest run <file>).
      const worker = process.env.VITEST_WORKER_ID ?? '?';
      // eslint-disable-next-line no-console
      console.error(`[LEAK] worker=${worker} ${leaks.join(' ')}`);
    }
  });
}

function countResources(): Record<string, number> {
  const out: Record<string, number> = {};
  // Node 20+: getActiveResourcesInfo returns string names of active handles.
  const info = (
    process as unknown as { getActiveResourcesInfo?: () => string[] }
  ).getActiveResourcesInfo?.() ?? [];
  for (const kind of info) out[kind] = (out[kind] ?? 0) + 1;
  return out;
}

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

// ── §2.31 open-handle diagnostic (gated, opt-in) ──────────────────────────
// The CI "Tests" job intermittently hangs to its 30-min timeout because a
// forked worker won't exit — a test left an open handle (timer / socket /
// server) it never tore down. This block, enabled ONLY with DETECT_HANDLES=1,
// snapshots `process.getActiveResourcesInfo()` before/after each test FILE and
// warns when a file leaves a NEW timer/socket-shaped handle behind, naming the
// file so the leak can be pinned. Zero effect on normal runs (env-gated).
//   Usage: DETECT_HANDLES=1 npx vitest run <files> --no-file-parallelism 2>&1 | grep DETECT_HANDLES
if (process.env.DETECT_HANDLES === '1') {
  const { beforeAll, afterAll, expect } = await import('vitest');
  const LEAKY = /Timeout|Immediate|TCP|Socket|Pipe|FSReq|FileHandle|Server|TTY|Worker|ChildProcess/i;
  const tally = (arr: string[]): Record<string, number> =>
    arr.reduce<Record<string, number>>((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {});
  let before: Record<string, number> = {};
  beforeAll(() => {
    before = tally(process.getActiveResourcesInfo?.() ?? []);
  });
  afterAll(() => {
    const after = tally(process.getActiveResourcesInfo?.() ?? []);
    const leaked = Object.keys(after)
      .map((k) => [k, after[k] - (before[k] ?? 0)] as const)
      .filter(([k, d]) => d > 0 && LEAKY.test(k))
      .map(([k, d]) => `${k}+${d}`);
    if (leaked.length) {
      let file = '?';
      try {
        file = String(expect.getState().testPath ?? '?').replace(/.*[\\/]/, '');
      } catch {
        /* testPath unavailable */
      }
      // eslint-disable-next-line no-console
      console.warn(`[DETECT_HANDLES] ${file} leaked: ${leaked.join(' ')}`);
    }
  });
}

export {};

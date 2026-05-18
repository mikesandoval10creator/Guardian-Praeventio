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
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });

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

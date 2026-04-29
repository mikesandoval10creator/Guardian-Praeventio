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
if (typeof (globalThis as any).document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}

export {};

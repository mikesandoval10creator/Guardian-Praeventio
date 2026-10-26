# Vite+ local verification workflow

## Scope

Use Vite+ as an **opt-in task runner**, not as a replacement for Guardian's
compiler, lint rules, tests, or build pipeline. The project-local `vite-plus`
dependency is pinned in `package.json` and `package-lock.json`; no global `vp`
installation or `vp migrate` is required.

Use the Node/npm versions required by `package.json` (the initial observation
used Node 24.22.1 and npm 11.12.1). Install normally with `npm ci`, respecting
the repository's `.npmrc` and install-script policy.

## Commands

```bash
# During local iteration: cache only the existing TypeScript check.
npm run typecheck:fast

# Cached TypeScript check followed by the FULL, freshly executed lint chain.
npm run verify:fast

# Before a PR: execute the canonical TypeScript and lint commands without vp.
npm run verify:fresh

# Contract tests: command wiring and success/failure propagation.
npm run test:toolchain

# Integration tests: real Vite+ and TypeScript, with deliberate invalid inputs.
npm run test:toolchain:cache
```

`verify:fresh` is **types + lint**, not a substitute for relevant unit,
integration, Firestore-emulator, build, Android, or E2E gates. Run the tests
required by the actual change, and wait for the existing PR checks.

Continue to use the original `dev`, `test`, `test:rules`, `prebuild`, `build`,
`typecheck`, and `typecheck:ci` commands. In particular, development still starts
Express with Vite middleware; do not start a separate `vp dev` server.

## Safety boundaries

- `typecheck:fast` delegates to `vp run --cache typecheck`. It runs the same
  TypeScript compiler, heap setting, and `tsconfig.json` as the canonical
  `typecheck` script; it does not switch to a different type checker.
- `verify:fast` runs `npm run lint` directly after a successful type check.
  ESLint, the Firestore open-read ratchet, user-facing-error guard, PGP
  disclosure ratchet, and honesty gate are not cached or removed.
- Shell `&&` preserves failure propagation: a failed type check stops the
  chain; a failed lint step fails the overall command.
- CI retains its existing uncached lint and `typecheck:ci` gates. The CI
  typecheck job also runs both new regression suites. Local cache hits never
  replace fresh PR evidence.
- No shared/remote cache or build/test caching is enabled by this change.
  Treat the local cache as a development convenience, not an attestation.
- Vite Task supplies a cleaned environment to cached tasks. This is suitable
  for the current pure TypeScript script, which explicitly sets its heap.
  Re-evaluate tracking before adding environment-dependent behavior to that
  script. Do not generalize `--cache` to deployment, signing, model downloads,
  Firestore-emulator tests, or commands that depend on external services.

## Reading the output

On a reusable result, Vite+ explicitly reports:

```text
cache hit, replaying
```

That means **the compiler did not execute again**. Report it as a cached local
result. On a changed input, Vite+ reports a cache miss and executes the command.
A source edit ordinarily requires another full TypeScript run; this phase does
not make that compiler itself faster.

The cache lives under `node_modules/.vite/task-cache`, already covered by the
repository's `node_modules` ignore rule. To remove task results locally:

```bash
npm exec -- vp cache clean
```

## Executable regression coverage

The workflow contract suite invokes npm in temporary fixture projects and
checks success, early type-check failure, and lint failure for both commands.
The cache suite invokes the installed Vite+ CLI and real TypeScript compiler
against a small temporary project; it proves:

- A first check executes and an unchanged successful check is reused.
- An imported source change invalidates the prior result and fails with TS2322.
- Failed checks are not cached.
- Restoring the original inputs can reuse the original successful result.
- A new file included by `tsconfig` cannot hide behind the previous result.
- A compiler configuration change invalidates the prior result.

These tests do not prove that every possible future environment-dependent
script is cache-safe. Keep the cache boundary narrow.

## Initial local observation

A sequential Windows observation on the same installed worktree, with
Vite+ 1.4.0, TypeScript 5.8.3, Vite 8.3.4 and Vitest 5.0.5:

- Fresh types + full lint (`verify:fresh`): **89.707 s**, exit 0.
- Invalidated-cache types + full lint (`verify:fast`): **92.458 s**, exit 0.
- Reusable-cache types + full lint (`verify:fast`): **29.155 s**, exit 0.

The warm run was 67.5% shorter than the fresh run in this observation. This is
one run per mode, including the same npm/runtime wrapper; it is not a statistical
benchmark or a promise for other machines. The cold run shows that tracking has
an overhead. All three lint runs reported the same 2,547 existing warnings and
zero errors, and executed every custom lint guard successfully. No warning
baseline or safety gate was relaxed to obtain the result.

The trade-off is additional development-only dependencies. npm also resolves
PostCSS from 8.5.29 to 8.5.31 to satisfy the new toolchain's transitive range;
existing direct Vite, Vitest, TypeScript and ESLint dependencies are unchanged.
This workflow does not claim to clear the repository's existing npm audit debt.

## Upstream references

- [Task runner](https://viteplus.dev/guide/run)
- [Task caching and automatic input tracking](https://viteplus.dev/guide/cache)
- [Task cache configuration](https://viteplus.dev/config/run)

Do not run `vp migrate` as part of normal setup: full toolchain migration has
not been approved or validated by this additive integration.

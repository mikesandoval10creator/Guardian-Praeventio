# ADR-0009: Mobile CI signing supersedes ADR-0006 (local-build deferral)

**Fecha**: 2026-05-04
**Sprint**: 21 — sexta ola (Bucket S)
**Estado**: Aceptada — supersedes [ADR-0006](0006-mobile-deferred-to-local-build.md)
**Decisores**: Daho Sandoval (product), Claude Code (assist)
**Relacionado**: `.github/workflows/mobile-release.yml`, `fastlane/Fastfile`, `fastlane/Appfile`, `Gemfile`, `docs/mobile-build-runbook.md`

---

## Context

ADR-0006 (Sprint 20) deferred mobile builds to local because we lacked a GHA
secrets workflow + Fastlane plumbing. Sprint 21 Ola 6 (Bucket S) adds:

- A real CI signing pipeline (`.github/workflows/mobile-release.yml`).
- Fastlane lanes for `internal`, `production`, and `build_only`
  (`fastlane/Fastfile`, `fastlane/Appfile`).
- `Gemfile` for reproducible Ruby toolchain installs.
- The runbook documenting the 5 GitHub Secrets + the one-time keystore
  generation flow.

With these in place the rationale that drove ADR-0006 (no secrets infra, no
Fastlane wiring) no longer holds for Android.

## Decision

Mobile (Android) builds now run on GitHub Actions via
`.github/workflows/mobile-release.yml` with Fastlane uploading signed AABs to
Play Store internal / production tracks.

iOS builds remain local-only until macOS GHA runner cost is justified
(typically after the first Play Store production release validates the
go-to-market). The same `Fastfile` will gain an `:ios` platform block when
that happens.

## Consequences

**Positive**
- Reproducible builds on every PR-trigger (`build_only` track validates
  compilation + signing without uploading).
- Auto-upload to internal track on `workflow_dispatch`.
- Auto-upload to production track on `mobile-v*` tag push.
- Secrets live in GitHub Secrets, never in the repo. Keystore is base64
  encoded at rest, decoded only inside the runner.
- ADR-0006 is now historical record only — its plan-Sprint-21+ section has
  been executed.

**Negative / Trade-offs**
- iOS path still requires a developer with macOS + Xcode; no parity with
  Android until justified.
- The CI workflow assumes `android/` has been generated and committed
  (one-time `npx cap add android` on a developer machine before the first
  pipeline run).
- Tag-trigger production uploads bypass manual approval. Mitigation: the
  `mobile-v*` tag namespace is restricted by repo permissions and any push
  to it produces a Play Console review queue entry (Google's own gate).

## Alternatives considered

1. **Codemagic / Bitrise** — viable, especially for iOS, but adds a third
   vendor surface beyond GHA. Revisit when activating iOS automation.
2. **Self-hosted macOS runner** — cheaper per-minute than `macos-latest` at
   scale but requires owning hardware and patching it. Not justified yet.
3. **Stay on ADR-0006 for one more sprint** — discarded; the secrets flow
   was already specified in ADR-0006 §Plan, blocking that work indefinitely
   adds no value.

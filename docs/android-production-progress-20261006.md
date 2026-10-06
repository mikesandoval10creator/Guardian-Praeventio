# Android production preparation: partial candidate

This branch is an implementation in progress, not a production release. It begins at GitHub main `a8a688663d615bcee28817862e1df7e4b5d0ada0`. Package identity and pricing tiers are unchanged; life-safety functionality remains free under ADR 0021.

## Verified preservation

The six local Vitest migration files were preserved as binary patches, exact file hashes, branch `backup/local-vitest-20261005`, commit `64fb2fc9fffa314beb7dc3ac1eeb2c81d397bf8b`, and a verified bundle in `D:\Guardian Praeventio\recovery\2026-10-05\repo`. Original branch `chore/vitest-5` remains at `75246a905a8d6c982d99ea2f6e32872397861979`. Other checkouts were not changed. Previous node_modules was retained in that recovery directory when it blocked dependency installation. Lockfile installation succeeded: 2,319 packages, Node 24.15.0/npm 11.12.1, lifecycle scripts disabled.

## Implemented release controls

- Fastlane uses the Android project directory, keeps signing passwords out of Gradle command arguments, and supports uploading an already-built candidate.
- Release Gradle tasks require native Firebase configuration for the existing package ID, signing inputs, production Capacitor assets and valid TLS pins.
- Pin validation accepts canonical padded/unpadded Base64 only when it decodes to exactly 32 bytes, requires distinct backup keys and rejects release cleartext/user CAs.
- Android 16 health permission uses the `android.permission.health` namespace.
- Mobile PR workflow compiles native debug source and runs native unit tests. Release workflow separates build from upload and records/checks the artifact SHA-256.
- Tags target internal testing; production requires manual dispatch and the `android-production` environment. **Required reviewers must be configured and verified in GitHub before this can serve as the owner's final approval gate. An environment name alone does not guarantee protection.**
- ELF64 inspection of AAB native libraries is included; generated APK zip alignment and actual device execution still need separate evidence.

## Checks performed

- `node --test scripts/__tests__/android-release.test.cjs`: 5 passed.
- `node node_modules/vitest/vitest.mjs run src/__tests__/mobile/androidBuildWiring.test.ts`: 44 passed.
- `node --check` on both release guard scripts: passed.
- `scripts/__tests__/test_android_16kb.py`: 4 passed against synthetic ELF64 fixtures. No actual AAB has been checked yet.
- Focused ESLint: no errors; scripts are excluded by the repository lint configuration. Pipeline smoke check passed structural checks; Ruby syntax and full YAML parsing are deferred to CI because those local dependencies are unavailable.
- Release guard against current checkout: correctly fails missing Firebase/signing, placeholder TLS pins and unsynced production assets. This is not a successful release build.

## Remaining work

SOS retry scheduling/concurrency, native ManDown queue/real lone-worker startup acknowledgement, purchases/receipts/ACK/renewal, unknown-country handling and ads consent are not complete. Preliminary regression tests and the vendor checkout remain local and are excluded from this initial PR. Full typecheck/lint/test sweep, emulator rules, signed AAB, hardware testing, Play listing/catalog/compliance and legal review remain required. No production upload was performed.

Missing external inputs include the genuine Firebase configuration, upload keystore/signing secrets, verified production and backup TLS keys, Play app/service-account/catalog setup, physical devices/testers and approved privacy/legal declarations. Never substitute sample values to pass release gates.

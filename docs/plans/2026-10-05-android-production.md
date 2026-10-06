# Guardian Android production implementation

Approved by the owner in this chat. Execute in `D:\Guardian Praeventio\development\repo` on `release/android-20261005` starting at `a8a688663d615bcee28817862e1df7e4b5d0ada0`.

## Constraints

Preserve `com.praeventio.guard`, current tiers and all free life-safety functions (ADR 0021). Preserve the six local Vitest changes separately; do not import them into this release. Do not modify the other 36 checkouts. Production submission requires the owner's final approval of a concrete candidate. Never fabricate credentials, compliance attestations, device results, certificates or release artifacts.

## Task 1: Backup and update

Save binary staged/unstaged patches, original file hashes and a snapshot branch `backup/local-vitest-20261005`, verify bundle and exact original files under `D:\Guardian Praeventio\recovery\2026-10-05\repo`. Fetch without pruning and create release branch at remote main. Install lockfile dependencies and record baseline.

## Task 2: Reliable safety alerts

SOS: durable enqueue before send, one drain, scheduled `nextRetryAt`, recover on startup/reconnect/resume, 15-second HTTP timeout. ManDown: shared queue lock, stable `clientEventId`, re-read storage after HTTP and remove/dead-letter by ID, durable work for concurrent arrivals. Lone worker: acknowledge actual foreground service start, explicit permission/config/startup failure and a 10-second timeout. Write behavioral regressions and preserve free access.

## Task 3: Purchases and entitlements

Vendor pinned `@capgo/native-purchases` 8.8.1 with MPL 2.0 source/license/patch notices. Exact Android base-plan and offer selection; no fallback or automatic acknowledgement. Normalize adapter SKU/base-plan/offer/token and query all 12 existing SKUs. Recover through Play purchase queries. Persist validation pending state and retry without repurchase; server-only validation, transactional entitlement plus durable acknowledgement job run every minute. Enforce receipt ownership. Parse RTDN RFC3339 dates and preserve valid canceled subscription access. Show Play prices/currencies and restore action. Add interrupted validation, wrong-offer, restore, renewal and valid-cancellation regressions.

## Task 4: Android release controls

Fix Fastlane Gradle project directory. Provision native Firebase and fail release if absent. Replace sample TLS pins only with verified real pins; accept valid Base64 that decodes to exactly 32 bytes. Require signing/config/native build before distribution, fix Android health permission, enforce manual production approval. Add meaningful guard regressions. Build the native candidate if SDK/signing/config are available, inspect native libraries for 16 KB compatibility.

## Task 5: International application behavior

Emergency resolvers accept unknown country and never default to Chile. Country must be confirmed before displaying verified national numbers; all consumers handle unknown country, preserve internal SOS and project contact, offer dialer without an assumed number. Unsupported UI language falls back to English. Label Chile-specific regulatory material. Gate ads on applicable consent. Identify legal drafts for counsel rather than claiming global compliance. Add unknown-country and consent regressions.

## Task 6: Verification and delivery

Run typecheck:ci, lint, complete test suite, Firebase emulator rules and release build. Review tenant isolation, authentication, account deletion, permissions and free safety access. Obtain a fresh whole-branch review and fix critical/high findings. Physical-device matrix covers minimum supported Android and 14-16, lock screen, battery saving, reboot, offline, FCM, ManDown, lone worker and BLE/Mesh; record Android force-stop limits. Prepare free Google Play listing with IAP, regions/catalog/app signing, privacy/account deletion/Data Safety/rating/permission declarations/video. Internal/closed tests and account requirements remain gates; 12 testers/14 continuous days applies when required. Link evidence to existing Notion tasks. Deliver backup, reviewed source, signed AAB if possible, exact results and concrete external blockers. Ask final approval only before production submission.

# Android / Google Play readiness — 2026-10-15

Status: **production blocked**. These are verified preparation results, not evidence of a published release.

Source baseline: `b048835642bbaf88a0e5d136972c1474384c8a01` (merged PR #1812).

## Verified repository and workstation state

| Check | Observed result | Remaining action |
| --- | --- | --- |
| GitHub repository environments | REST list returned `total_count: 0`; `android-production` GET returned 404 | Owner must provision a production environment with real required reviewers and confirm protection availability for the repository plan |
| Repository Actions secrets | `gh secret list --json name,updatedAt` returned `[]`; values were not read | Provision genuine Firebase, signing and Play inputs through approved secret storage; organization-level sources have not been established |
| Mobile release workflow history | Workflow run list returned `[]` | Build a reviewed signed candidate before distribution |
| Android release guard | Fails for absent native Firebase file, missing signing environment, placeholder TLS pins and absent synced production assets/config | Supply and validate real inputs, then rerun `node scripts/check-android-release.cjs` |
| Native target | `android/variables.gradle`: min SDK 26, compile/target SDK 36 | Validate a signed native build and native-library compatibility |
| Physical devices | SDK adb inventory contained 0 authorized and 0 unauthorized physical devices | Connect test devices and record the safety/device matrix |
| Play Console | Current browser session reached developer-account registration; the owner identified a different intended account and sign-in is pending | Verify access with the intended account, developer-account type, app existence and production eligibility |

No account was created, payment made, credential generated, release workflow dispatched or bundle uploaded during this verification.

## Production gate change

`scripts/check-android-production-environment.mjs` reads GitHub metadata and requires a nonempty `required_reviewers` rule with a real User/Team ID. Missing, denied, malformed or unavailable metadata fails closed. The workflow runs it in production preflight and again immediately before production upload. Internal testing and build-only paths remain independent of this production gate.

This proves reviewer configuration at each check, not approval of a particular run. Actual environment approval, self-review/administrator-bypass policy, branch restrictions and repository-plan support still require owner verification. See [GitHub environment API](https://docs.github.com/en/rest/deployments/environments#get-an-environment).

## Local evidence for this change

- New verifier and existing Android guard regressions: 15 passed.
- Android wiring/store configuration: 54 passed; release version-code tests: 3 passed.
- Mobile pipeline scaffold smoke: passed. Local Ruby syntax validation was skipped because Ruby is unavailable; workflow CI remains required. The new regression tests parse workflow YAML with `js-yaml`.
- Independent source review: no blocking findings. No live protected deployment was executed.

Exact pushed-commit CI is a separate gate; local results do not establish CI success.

## Remaining launch evidence

1. Verify the intended Play Console account and existing `com.praeventio.guard` application before creating another listing or account.
2. Provision Firebase, signing and verified production TLS pins without committing secret material. Build a signed AAB, retain its SHA-256, verify signing identity, SDK target and 16 KB native-library compatibility.
3. Validate SOS, ManDown, lone worker, offline recovery, push and BLE/Mesh on physical devices, including lock screen, battery restrictions and reboot. Record known Android force-stop limits.
4. Complete privacy/account deletion, Data Safety, content rating, permission declarations, store assets, free safety access and purchase/recovery validation from actual product behavior.
5. Upload a reviewed candidate to internal/closed testing and collect tester/device evidence. Confirm any account-specific production-access requirement in Console.
6. Require exact-SHA CI, protected environment approval and final owner approval before production submission.

Google's current [target API policy](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-EN) requires Android 16 / API 36 for new apps and updates after August 31, 2026. The source target matches this requirement; a built artifact has not yet been verified.

For personal accounts created after November 13, 2023, Google's [production-access testing policy](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB) requires at least 12 opted-in testers for 14 continuous days before applying for production access. Whether it applies here remains unknown until the intended account is inspected.

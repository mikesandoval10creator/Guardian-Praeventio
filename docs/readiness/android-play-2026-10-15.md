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
| Play Console | After owner sign-in, the Praeventio developer account is accessible and explicitly marked personal. Guardian Praeventio exists as a draft with package `com.praeventio.guard` | Use the existing listing; complete its pending setup and closed testing |
| Play setup | Dashboard shows 1 of 11 tasks complete (privacy policy), internal testing 0 of 3 tasks complete, and production access disabled | Complete the ten remaining setup tasks and prepare a signed internal candidate |
| Uploaded artifacts | Latest releases page shows no versions and no latest app bundles | Build and validate the first signed candidate before uploading it |
| Production eligibility | Console explicitly requires a closed release, at least 12 opted-in testers and at least 14 days of closed testing; currently 0 opted-in testers | Recruit testers with owner authorization and run the required closed test before applying for production access |

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

1. Continue with the verified existing Praeventio personal account and draft `com.praeventio.guard`; do not create a duplicate listing. The [app dashboard](https://play.google.com/console/u/1/developers/8659079969570845112/app/4973268316390662422/app-dashboard) is the observed source for setup and eligibility status.
2. Provision Firebase, signing and verified production TLS pins without committing secret material. Build a signed AAB, retain its SHA-256, verify signing identity, SDK target and 16 KB native-library compatibility.
3. Validate SOS, ManDown, lone worker, offline recovery, push and BLE/Mesh on physical devices, including lock screen, battery restrictions and reboot. Record known Android force-stop limits.
4. Complete privacy/account deletion, Data Safety, content rating, permission declarations, store assets, free safety access and purchase/recovery validation from actual product behavior.
5. Upload a reviewed candidate to internal/closed testing and collect tester/device evidence. This account requires at least 12 opted-in closed testers for at least 14 continuous days before applying for production access; Console currently reports 0 opted-in testers.
6. Require exact-SHA CI, protected environment approval and final owner approval before production submission.

Google's current [target API policy](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-EN) requires Android 16 / API 36 for new apps and updates after August 31, 2026. The source target matches this requirement; a built artifact has not yet been verified.

Google's [production-access testing policy](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB) describes the personal-account requirement. The live dashboard confirms that the 12-testers / 14-days requirement applies to this application; account creation date was not inferred.

The ten pending setup tasks shown by Console are app access/login instructions, ads, content rating, target audience, Data Safety, government apps, financial features, health, category/contact details and the store listing. A completed privacy-policy task does not independently establish that the policy is accurate or sufficient. No policy declarations were submitted during inspection.

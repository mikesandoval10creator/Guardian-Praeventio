# Mobile signing runbook — secrets, provisioning, triggers

**Sprint:** 30 — Bucket GG (iOS pipeline scaffold; Android shipped in Sprint 21 Ola 6).
**Companion:** [`mobile-build-runbook.md`](./mobile-build-runbook.md) §6 (Android keystore generation lives there and is NOT duplicated here).

This runbook is the operational counterpart to the Fastlane + GitHub Actions scaffold. It tells the release owner exactly which secrets to paste, where to paste them, and how to trigger a release. The scaffold is intentionally inert until the secrets are present — `mobile-release.yml` skips both platform jobs cleanly when their secrets are missing.

---

## 1. Secrets the user MUST paste

Configure under **Repo → Settings → Secrets and variables → Actions**.

### 1.1 Android (5 secrets — already documented in mobile-build-runbook §6.2)

| Secret | Source |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i release.keystore \| tr -d '\n'` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password from `keytool` |
| `KEY_ALIAS` | alias used in `keytool` (default `praeventio`) |
| `KEY_PASSWORD` | key password from `keytool` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` | `base64 -i play-service-account.json \| tr -d '\n'` |

### 1.2 iOS (8 secrets — new in Sprint 30)

| Secret | Source / how to obtain |
| --- | --- |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_TEAM_ID` | 10-char Team ID — Apple Developer portal → Membership |
| `APP_BUNDLE_ID` | `com.praeventio.guard` (matches `appId` in `capacitor.config.ts`) |
| `MATCH_GIT_URL` | Private git repo URL holding fastlane match-encrypted certs + profiles (e.g. `git@github.com:praeventio/ios-certs.git`) |
| `MATCH_PASSWORD` | Symmetric passphrase you choose when running `fastlane match init`. Used to encrypt/decrypt the cert repo. |
| `FASTLANE_USER` | Same as `APPLE_ID` (kept separate so service accounts can override) |
| `FASTLANE_PASSWORD` | App-specific password — Apple ID → Sign-in & Security → App-Specific Passwords. **NEVER the real Apple ID password.** |
| `APP_STORE_CONNECT_API_KEY_ID` *(preferred)* | Replaces `FASTLANE_PASSWORD` for token-based auth — App Store Connect → Users and Access → Keys. |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | Issuer UUID from the same Keys page |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | Base64-encode the downloaded `.p8` file: `base64 -i AuthKey_XXX.p8 \| tr -d '\n'` |

**Total:** 5 Android + 8 iOS = **13 secrets** for full dual-platform release. The pipeline runs single-platform if you only paste one set — the missing-secrets job is skipped, not failed.

---

## 2. iOS one-time bootstrap (macOS-only)

Performed once on a Mac with Xcode. After this, CI takes over.

```bash
# 2.1 Generate the iOS native folder (commits ios/App/ + ios/App.xcworkspace).
npm ci
npm run build
npx cap add ios
git add ios/
git commit -m "Bootstrap iOS native project (Sprint 30 GG)"

# 2.2 Initialize the certs repo. Pick a PRIVATE git repo URL — never public.
cd ios/App
fastlane match init
# Answer the prompts: storage_mode = git, git_url = <MATCH_GIT_URL value>.

# 2.3 Generate + encrypt distribution cert + App Store provisioning profile.
fastlane match appstore --app_identifier com.praeventio.guard

# 2.4 Set the Apple Team in Xcode (one-time):
# open ios/App/App.xcworkspace
# → Signing & Capabilities → Team: <your team>
# → Bundle Identifier: com.praeventio.guard
# Commit the resulting project.pbxproj changes.
```

After step 2.3, `MATCH_GIT_URL` contains the encrypted certs. Anyone with `MATCH_PASSWORD` (the GitHub secret) can decrypt them at CI time — that's how the macOS runner signs without needing a `.p12` file in the secrets.

---

## 3. Triggering a release

### 3.1 Manual dispatch

```bash
# From the repo root, with `gh auth login` completed:
gh workflow run mobile-release.yml --ref main -f track=internal
gh workflow run mobile-release.yml --ref main -f track=production
gh workflow run mobile-release.yml --ref main -f track=build_only
```

The `track` input maps to:

| `track` value | Android lane | iOS lane |
| --- | --- | --- |
| `internal` *(default)* | `internal` (Play Internal Testing) | `testflight` |
| `production` | `production` (Play Production) | `appstore` |
| `build_only` | `build_only` (no upload) | `build_only` (no upload) |

### 3.2 Tag-driven production

Pushing a tag matching `mobile-v*` triggers production on both platforms simultaneously:

```bash
git tag mobile-v1.0.0
git push origin mobile-v1.0.0
```

### 3.3 Local smoke test (before merging Fastfile changes)

```bash
# Android (Linux / macOS):
bundle install
export KEYSTORE_PATH="$(pwd)/release.keystore"
export ANDROID_KEYSTORE_PASSWORD="..."
export KEY_ALIAS="praeventio"
export KEY_PASSWORD="..."
bundle exec fastlane android build_only

# iOS (macOS only):
cd ios/App
bundle install
export APP_BUNDLE_ID="com.praeventio.guard"
export APPLE_TEAM_ID="..."
export MATCH_GIT_URL="..."
export MATCH_PASSWORD="..."
bundle exec fastlane ios build_only
```

---

## 4. Pipeline lint (no real builds)

```bash
bash scripts/test-mobile-pipeline.sh
```

Verifies that the scaffold files exist and have valid syntax. CI runs this in the `pipeline-lint` job of `mobile-release.yml`.

---

## 5. Troubleshooting the gates

- **`Android job: This job was skipped` on a fresh repo** — expected. Paste `ANDROID_KEYSTORE_BASE64` and re-run.
- **`iOS job: This job was skipped`** — expected until `MATCH_GIT_URL` is set.
- **`fastfile-lint` fails on iOS Fastfile** — probably means `ios/App/` was not committed yet (see §2.1).
- **`pipeline-lint` fails locally** — run `bash scripts/test-mobile-pipeline.sh` and read the per-step output; missing files are reported with a clear marker.

---

## 6. Cross-references

- Android keystore generation: [`mobile-build-runbook.md`](./mobile-build-runbook.md) §6.1.
- ADR for the iOS uplift: [`architecture-decisions/0009-mobile-ci-signing-supersedes-0006.md`](./architecture-decisions/0009-mobile-ci-signing-supersedes-0006.md).
- Fastlane workflow file: [`.github/workflows/mobile-release.yml`](../.github/workflows/mobile-release.yml).
- iOS Fastfile: [`ios/App/fastlane/Fastfile`](../ios/App/fastlane/Fastfile).
- Android Fastfile: [`fastlane/Fastfile`](../fastlane/Fastfile).

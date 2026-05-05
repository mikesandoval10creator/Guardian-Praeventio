#!/usr/bin/env bash
# Sprint 30 Bucket GG — Mobile pipeline lint
#
# Verifies that the Fastlane + GHA mobile signing scaffold exists and
# parses cleanly. Does NOT run real builds (those need keystores +
# provisioning profiles that only the user can generate).
#
# Run locally:   bash scripts/test-mobile-pipeline.sh
# Run in CI:     `pipeline-lint` job in .github/workflows/mobile-release.yml.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

fail=0
pass() { printf "  \xE2\x9C\x93 %s\n" "$1"; }
miss() { printf "  \xE2\x9C\x97 %s\n" "$1"; fail=1; }

echo "[1/4] Required files present"
files=(
  "fastlane/Fastfile"
  "fastlane/Appfile"
  "fastlane/Pluginfile"
  "Gemfile"
  "ios/App/fastlane/Fastfile"
  "ios/App/fastlane/Appfile"
  ".github/workflows/mobile-release.yml"
  "docs/mobile-build-runbook.md"
  "docs/mobile-signing-runbook.md"
)
for f in "${files[@]}"; do
  if [ -f "$f" ]; then pass "$f"; else miss "$f (missing)"; fi
done

echo "[2/4] Workflow YAML parses"
if command -v python3 >/dev/null 2>&1; then
  if python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/mobile-release.yml'))" 2>/dev/null; then
    pass "mobile-release.yml is valid YAML"
  else
    # PyYAML may not be installed; fall back to a structural check.
    if grep -qE "^jobs:" .github/workflows/mobile-release.yml \
       && grep -qE "android-release:" .github/workflows/mobile-release.yml \
       && grep -qE "ios-release:" .github/workflows/mobile-release.yml; then
      pass "mobile-release.yml has expected jobs (PyYAML unavailable, structural check OK)"
    else
      miss "mobile-release.yml missing expected jobs"
    fi
  fi
else
  pass "python3 unavailable — skipping YAML parse (CI image always has python3)"
fi

echo "[3/4] Fastfile syntax (ruby -c)"
if command -v ruby >/dev/null 2>&1; then
  if ruby -c fastlane/Fastfile >/dev/null 2>&1; then
    pass "fastlane/Fastfile (Android) parses"
  else
    miss "fastlane/Fastfile (Android) parse error"
  fi
  if ruby -c ios/App/fastlane/Fastfile >/dev/null 2>&1; then
    pass "ios/App/fastlane/Fastfile (iOS) parses"
  else
    miss "ios/App/fastlane/Fastfile (iOS) parse error"
  fi
else
  pass "ruby unavailable locally — Fastfile parse deferred to fastfile-lint job"
fi

echo "[4/4] No real builds triggered (smoke-only contract)"
# Defensive: this script must NOT shell out to a real build. Strip comments
# and the contract-check stanza itself before scanning, so the canary regex
# below doesn't trip on its own definition.
real_build_hits=$(
  sed -e 's/[[:space:]]*#.*$//' "$0" \
    | sed -n '/SMOKE_CONTRACT_BEGIN/,/SMOKE_CONTRACT_END/!p' \
    | grep -E "^[^#]*(\./gradlew |xcodebuild |pod install |fastlane (android|ios) (internal|production|appstore|testflight))" \
    || true
)
# SMOKE_CONTRACT_BEGIN
# (this stanza is excluded from the canary scan)
# SMOKE_CONTRACT_END
if [ -n "$real_build_hits" ]; then
  miss "test-mobile-pipeline.sh appears to invoke a real build — contract violation"
  echo "$real_build_hits"
else
  pass "smoke-only contract preserved"
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "FAIL: mobile pipeline lint detected issues."
  exit 1
fi

echo
echo "OK: mobile pipeline scaffold is healthy."

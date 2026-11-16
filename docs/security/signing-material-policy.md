# Local SDK and signing-material policy

Notion: `3dcaa66d-73fe-817a-af62-ead6eee99988`.

## Scope

Repository-level ignores cover canonical `local.properties`, `key.properties`, `keystore.properties`, `signing.properties` and `.jks`, `.keystore`, `.p12`, `.pfx` containers at any depth. Existing Android ignores remain intact. Container extensions are matched case-insensitively; the path guard also handles case variants of property filenames.

A path-only guard adds defense in depth:

```sh
node scripts/check-signing-material.cjs --staged  # default; local precommit
node scripts/check-signing-material.cjs --tracked # CI; whole tracked index/tree
node --test scripts/__tests__/signing-material-guard.test.cjs
```

- Rejects protected names even after force-add or rename. Git NUL-delimited paths are used; messages JSON-escape filenames and never read/print their contents.
- Deletions remain allowed so an existing tracked file can be removed. The CI mode catches protected tracked files even when the staged diff is empty.
- Unknown modes or Git inspection errors fail closed with exit 2; protected filenames exit 1; a clean inspected set exits 0.
- Safe non-sensitive `.example` templates, public certificate `.pem` files and ordinary source are not banned solely by this filename policy.
- `.husky/pre-commit` invokes the staged guard; the new `Signing material guard` CI job runs the integration tests and tracked scan without an npm install. The existing gitleaks job/action and allowlist remain unchanged.

## Evidence and limits

Tests use disposable Git repositories beneath the configured scratch/runner temp directory, synthetic dummy contents, force-add, commit/rename/delete and actual subprocess exit codes. No real signing key or password is needed. Fixture hooks/configuration are local to those disposable repositories; the user's shared Git configuration/index is not changed.

Behavioral RED was the missing ignore coverage and then missing hook/CI wiring; both were observed before their corresponding edits. The new CLI was initially absent during its test-first interface check; that missing-module result is not claimed as an existing behavioral scan failure. Final integration tests exercise the real guard, not a mocked classifier alone.

A passing filename scan is **not** proof of absence of all secrets, revocation, history cleanup, valid release signing or production readiness. Private contents disguised under unrelated names need content scanning/review; this does not replace or weaken gitleaks. No production signing asset is opened, imported, generated, rotated or deployed by this task.
